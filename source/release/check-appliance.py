"""Run in a disposable boot of the image with simulated radios, never on a user's Pi."""
import io
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

DATA = Path("/var/lib/cortex-remote")
CONFIG = DATA/"pi-settings.json"
BASE = "http://10.42.0.1:8765"
LOG = Path("/boot/firmware/cortex-test.log")


def log(line):
    with LOG.open("a") as f:
        print(line, file=f, flush=True)
        os.fsync(f.fileno())


def wait(fn, seconds=180):
    until = time.monotonic()+seconds
    while time.monotonic()<until:
        try:
            result = fn()
            if result: return result
        except (OSError, ValueError, subprocess.CalledProcessError):
            pass
        time.sleep(.5)
    raise TimeoutError(fn)


def get(path):
    return urllib.request.urlopen(BASE+path, timeout=3).read()


def check_phone_wifi():
    # Run with the same UID and socket protocol as a future signed app update.
    client = """import json,socket,sys
with socket.socket(socket.AF_UNIX) as s:
    s.settimeout(40)
    s.connect('/run/cortex-network/control.sock')
    s.sendall(sys.stdin.buffer.read()+bytes([10]))
    print(s.makefile().readline())
"""
    def call(action, **kwargs):
        out = subprocess.check_output(["runuser","-u","cortex-remote","--","python3","-c",client],
                                     input=json.dumps(dict(action=action, **kwargs)),text=True)
        return json.loads(out)
    assert call("status")["phase"]=="idle"
    assert "error" in call("join",ssid="bad",password="short")
    # Put the second radio and its DHCP server in a separate network stack.
    # Two interfaces on the same Linux host cannot model an independent phone router.
    def run(*args):
        subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
    def phone(*args):
        run("ip","netns","exec","qa-phone",*args)
    run("nmcli","device","set","wlan1","managed","no")
    phy=Path("/sys/class/net/wlan1/phy80211").resolve().name
    run("ip","netns","add","qa-phone")
    run("iw","phy",phy,"set","netns","name","qa-phone")
    phone("ip","link","set","lo","up")
    phone("ip","addr","add","192.168.43.1/24","dev","wlan1")
    phone("ip","link","set","wlan1","up")
    conf=Path("/tmp/qa-phone.conf")
    conf.write_text("ctrl_interface=/tmp/qa-phone-ctrl\nnetwork={\n"
                    'ssid="QA-Phone"\nmode=2\nfrequency=2437\nkey_mgmt=WPA-PSK\n'
                    'proto=RSN\npairwise=CCMP\ngroup=CCMP\npsk="testphone123"\n}\n')
    phone("wpa_supplicant","-B","-Dnl80211","-iwlan1","-c",str(conf))
    phone("dnsmasq","--conf-file=/dev/null","--port=0","--interface=wlan1",
          "--dhcp-range=192.168.43.20,192.168.43.50,1h","--pid-file=/tmp/qa-dns.pid",
          "--dhcp-leasefile=/tmp/qa-phone.leases")
    assert "ssids" in call("scan")
    first=call("join",ssid="QA-Phone",password="testphone123")
    wait(lambda:call("status")["phase"]=="trial")
    assert "error" in call("confirm",ticket="wrong")
    assert call("confirm",ticket=first["ticket"])=={}
    assert call("status")["phase"]=="connected"
    log("PASS signed app UID can switch to WPA2 hotspot and confirm")
    phone("wpa_cli","-p","/tmp/qa-phone-ctrl","-iwlan1","disable_network","0")
    wait(lambda:call("status")["phase"]=="idle")
    assert "ssid Cortex-QA" in subprocess.check_output(["iw","dev","wlan0","info"],text=True)
    phone("wpa_cli","-p","/tmp/qa-phone-ctrl","-iwlan1","enable_network","0")
    second=call("join",ssid="QA-Phone",password="testphone123")
    assert second["ticket"] != first["ticket"]
    wait(lambda:call("status")["phase"]=="trial")
    wait(lambda:call("status")["phase"]=="idle")
    assert "ssid Cortex-QA" in subprocess.check_output(["iw","dev","wlan0","info"],text=True)
    # A supervisor restart in the middle of a new attempt must cancel the trial.
    log("PASS phone loss and unconfirmed client both restore original private AP")
    assert "ticket" in call("join",ssid="QA-Phone",password="testphone123")
    wait(lambda:call("status")["phase"]=="trial")
    subprocess.run(["systemctl","restart","cortex-network"],check=True)
    wait(lambda:call("status")["phase"]=="idle")
    assert "ssid Cortex-QA" in subprocess.check_output(["iw","dev","wlan0","info"],text=True)
    assert call("forget")=={}
    log("PASS interrupted switch recovers after service restart; remembered profile removed")


def main():
    assert not CONFIG.exists(), "Only for an unclaimed, disposable image"
    setup = wait(lambda:get("/")).decode()
    nonce = re.search('name="proof" value="([^"]+)"',setup)[1]
    status = subprocess.check_output(["nmcli","-g","GENERAL.STATE","device","show","wlan0"],text=True)
    assert status.startswith("100"), status
    assert subprocess.check_output(["iw","dev","wlan0","info"],text=True).find("ssid Cortex-Remote-Setup")>=0
    log("PASS clean boot: NetworkManager wlan0 AP and enrollment portal")
    key = secrets.token_urlsafe(18)
    form = urllib.parse.urlencode(dict(proof=nonce,ssid="Cortex-QA",wifi=secrets.token_hex(8),key=key)).encode()
    assert key.encode() in urllib.request.urlopen(BASE+"/",form,timeout=5).read()
    def api(path, content=b"{}"):
        req=urllib.request.Request(BASE+"/api/"+path,content,{"X-QC-Key":key})
        return json.load(urllib.request.urlopen(req,timeout=30))
    wait(lambda:api("update-status")["available"])
    assert "ssid Cortex-QA" in subprocess.check_output(["iw","dev","wlan0","info"],text=True)
    assert b'Cortec Remote' in get("/app.js")
    log("PASS private AP, authenticated app, offline first boot")
    saved=CONFIG.read_bytes()
    cache=DATA/".device-library"/"qa-sentinel"
    cache.parent.mkdir(exist_ok=True)
    cache.write_bytes(os.urandom(24))
    sentinel=cache.read_bytes()
    bundle=Path("/tmp/cortex-test.zip").read_bytes()
    def invalid(blob):
        try: api("update-zip",blob)
        except urllib.error.HTTPError as e: assert e.code==400, e
        else: raise AssertionError("Invalid update accepted")
        assert api("update-status")["available"]
    invalid(bundle[:-40])
    with zipfile.ZipFile(io.BytesIO(bundle)) as z:
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,"w") as bad:
            for name in z.namelist():
                bad.writestr(name,b"wrong" if name=="server.py" else z.read(name))
        invalid(buf.getvalue())
    log("PASS truncated and tampered ZIP rejected; original app still responds")
    entry=api("update-zip",bundle)
    def applied():
        state=api("update-status")
        return state["ticket"]==entry["ticket"] and state["status"]=="applied"
    wait(applied)
    assert CONFIG.read_bytes()==saved and cache.read_bytes()==sentinel
    assert subprocess.check_output(["iw","dev","wlan0","info"],text=True).find("ssid Cortex-QA")>=0
    log("PASS signed ZIP activated; Wi-Fi, key, URL and cache preserved")
    # Simulate a launch failure after staging (disk error), using the supervisor's journal.
    # The user upload endpoint still requires a valid release signature.
    sys.path.insert(0,"/usr/local/lib/qc-desk")
    os.environ["QC_DATA_DIR"]=str(DATA)
    import updater
    failed="f"*64
    with updater.exclusive():
        current=updater.state()
        original=current["active"]
        (updater.STORE/failed).mkdir()
        owner = DATA.stat()
        os.chown(updater.STORE/failed, owner.st_uid, owner.st_gid)
        (updater.STORE/failed/"server.py").write_text("raise SystemExit(3)")
        updater.record(dict(active=original,target=failed,ticket="qa-failure",status="pending"))
    wait(lambda:api("update-status")["status"]=="rollback")
    assert updater.state()["active"]==original and CONFIG.read_bytes()==saved and cache.read_bytes()==sentinel
    assert b'Cortec Remote' in get("/app.js")
    log("PASS failed startup rolled back to healthy app")
    check_phone_wifi()
    log("COMPLETE")


if __name__=="__main__":
    try:
        main()
    except BaseException:
        import traceback
        for unit in ("qc-desk-hotspot", "qc-desk", "cortex-network"):
            status = subprocess.run(["systemctl","show",unit,"-p","ActiveState","-p","SubState","-p","Result"],
                                    capture_output=True, text=True)
            log(unit+" "+status.stdout.strip().replace("\n"," "))
        diag = subprocess.run(["journalctl","-b","-u","NetworkManager","-u","cortex-network",
                               "-n","35","--no-pager"],capture_output=True,text=True)
        log(diag.stdout)
        log(traceback.format_exc())
        raise
