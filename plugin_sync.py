"""Import the plugin list displayed by Cortex Control for one USB device."""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

GUIDE = "플러그인이 바뀌면 PC에 본체를 연결하고 Cortex Control의 Plugins에서 Refresh를 누른 뒤 Owned Plugins와 All Plugins를 펼쳐 주세요."
NAMES = json.loads(Path(__file__).with_name("plugin-names.json").read_text(encoding="utf8"))


def device_key(serial):
    return hashlib.sha256(str(serial).encode()).hexdigest() if serial else None


def read_controller():
    if os.name != "nt":
        raise ValueError(GUIDE)
    from server import setup
    setup()
    import hid
    from pyquadcortex import hid_ids
    from pyquadcortex.client import pa
    from pyquadcortex.session import open_device
    from pyquadcortex.transport import Transport
    if len(hid.enumerate(hid_ids.VENDOR_ID, hid_ids.PRODUCT_ID)) != 1:
        raise ValueError("Quad Cortex 한 대를 PC에 연결해 주세요.")
    script = """
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
$p=@(Get-Process -Name 'Cortex Control' -ErrorAction SilentlyContinue | Where-Object MainWindowHandle)
if($p.Count -ne 1){exit 1}
$r=[Windows.Automation.AutomationElement]::FromHandle($p[0].MainWindowHandle)
$c=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text)
$n=@($r.FindAll([Windows.Automation.TreeScope]::Descendants,$c) | ForEach-Object {$_.Current.Name})
ConvertTo-Json -InputObject $n -Compress
"""
    try:
        # Read only the version on a separate HID handle. No session handshake or keepalive.
        dev = open_device()
        transport = Transport(dev)
        transport._running = True
        transport._rx.start()
        try:
            def serial():
                return transport.request(pa.VersionMessage(action=pa.MessageAction.READ),timeout=2).device_serial_number
            key = device_key(serial())
            result = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                capture_output=True, check=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
            if not key or key != device_key(serial()):
                raise ValueError(GUIDE)
        finally:
            transport.stop()
            dev.close()
        labels = [n.strip().casefold() for n in json.loads(result.stdout.decode("utf-8-sig"))]
        start, end = labels.index("owned plugins"), labels.index("all plugins")
        if start >= end:
            raise ValueError(GUIDE)
        owned = [i for i,name in NAMES.items() if name.casefold() in labels[start+1:end]]
        locked = [i for i,name in NAMES.items() if name.casefold() in labels[end+1:]]
        if not (owned or locked) or set(owned).intersection(locked):
            raise ValueError(GUIDE)
        return {"deviceKey":key,"owned":owned}
    except Exception as exc:
        raise ValueError(GUIDE) from exc


def save_snapshot(data, directory):
    import tempfile
    key, owned = data.get("deviceKey"), data.get("owned")
    if not isinstance(key,str) or not re.fullmatch("[a-f0-9]{64}",key) or not isinstance(owned,list) or any(not isinstance(i,str) or i not in NAMES for i in owned):
        raise ValueError("잘못된 플러그인 목록입니다.")
    directory.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w",encoding="utf8",dir=directory,delete=False) as f:
        json.dump(sorted(set(owned)),f)
    Path(f.name).replace(directory / (key+".json"))
    return {"deviceKey":key,"owned":owned}


def load_snapshot(key,directory):
    if not isinstance(key,str) or not re.fullmatch("[a-f0-9]{64}",key):
        return None
    path=directory / (key+".json")
    return json.loads(path.read_text(encoding="utf8")) if path.is_file() else None


if __name__ == "__main__":
    from getpass import getpass
    from urllib.parse import urlsplit
    from urllib.request import Request,urlopen
    try:
        snapshot=read_controller()
        dest=urlsplit(getpass("Pi Cortex Remote URL (including #key): ").strip())
        if dest.scheme not in ("http","https") or not dest.hostname or not dest.fragment:
            raise ValueError("Pi Cortex Remote의 키 포함 주소를 입력하세요.")
        request=Request(dest._replace(path="/api/plugin-import",query="",fragment="").geturl(),
            json.dumps(snapshot).encode(),{"X-QC-Key":dest.fragment,"Content-Type":"application/json"})
        with urlopen(request,timeout=8) as response:
            if json.load(response).get("deviceKey") != snapshot["deviceKey"]:
                raise ValueError("Pi 저장 응답을 확인할 수 없습니다.")
        print("Synced:",", ".join(NAMES[i] for i in snapshot["owned"]) or "(none)")
    except Exception as exc:
        sys.exit(str(exc))
