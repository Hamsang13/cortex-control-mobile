"""Hotspot-only HTTP entry point for iPad Wi-Fi discovery."""
import hashlib
import json
import re
import socket
import sys
import time
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from pi_settings import known_browser
from firstboot import Setup, label, copy_controls

STATE = Path("/var/lib/cortex-welcome")
PROBE = "captive.apple.com"
SUCCESS = "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"


def hotspot_ip():
    try:
        pid = int(Path("/run/nm-dnsmasq-wlan0.pid").read_text())
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return next(a.decode().split("=", 1)[1] for a in args if a.startswith(b"--listen-address="))
    except (OSError, ValueError, StopIteration):
        return None


class Welcome(Setup):
    def preference(self):
        for line in Path("/proc/net/arp").read_text().splitlines()[1:]:
            ip, _, flags, mac, _, interface = line.split()
            if (ip == self.client_address[0] and interface == "wlan0" and int(flags, 16) & 2
                    and re.fullmatch(r"[0-9a-f:]{17}", mac)):
                return STATE / hashlib.sha256(mac.encode()).hexdigest()
        return None

    def redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        ip = self.server.server_address[0]
        host = self.headers.get("Host", "").lower().removesuffix(":80")
        pref = self.preference()
        if host == PROBE:
            if pref and pref.exists():
                data = SUCCESS.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.redirect(f"http://{ip}/")
            return
        if host != ip or self.path != "/":
            return self.send_error(404)
        if not self.server.config.exists():
            return self.redirect(f"http://{ip}:8765/")
        config = json.loads(self.server.config.read_text())
        port = urlsplit(config["url"]).port
        base = f"http://{ip}:{port}/"
        saved = known_browser(self.headers.get("Cookie"), config["key"])
        link = base + ("#" + config["key"] if saved else "")
        key_field = "" if saved else (f'<label>{label("Access key","접속 키")}'
                                      '<input id="key" type="password" autocomplete="current-password" required minlength="16"></label>')
        checked = "checked" if pref and pref.exists() else ""
        self.page(f"""<h1>{label("Open Cortex Remote","Cortex Remote 열기")}</h1>
{key_field}
{copy_controls(link)}
<p><a id="open" href="{link}">{label("Open remote","리모트 열기")}</a></p>
<label><input style="display:inline;width:auto" type="checkbox" id="skip" {checked}>
{label("Skip this screen on future connections","다음 연결부터 이 기기에서 표시하지 않기")}</label>
<p role="status" id="prefStatus"></p>
<script>
const key=document.querySelector('#key'),openLink=document.querySelector('#open');
if(key) openLink.onclick=e=>{{if(!key.reportValidity())e.preventDefault()}};
if(key) key.oninput=()=>{{openLink.href={json.dumps(base)}+(key.value?'#'+encodeURIComponent(key.value.trim()):'');document.querySelector('#remoteUrl').value=openLink.href}};
const skip=document.querySelector('#skip');
skip.onchange=async()=>{{
  skip.disabled=true;
  try{{const r=await fetch('/preference',{{method:'POST',headers:{{'X-Cortex-Welcome':'1'}},body:skip.checked?'hide':'show'}});
    if(!r.ok)throw Error();prefStatus.textContent=menu.value==='ko'?'저장했습니다.':'Saved.';
  }}catch{{skip.checked=!skip.checked;prefStatus.textContent=menu.value==='ko'?'다시 시도하세요.':'Please try again.'}}
  finally{{skip.disabled=false}}
}};
</script>""")

    def do_POST(self):
        ip = self.server.server_address[0]
        if (self.path != "/preference" or self.headers.get("Host") not in (ip, ip+":80")
                or self.headers.get("Origin") != "http://"+ip or self.headers.get("X-Cortex-Welcome") != "1"):
            return self.send_error(403)
        pref = self.preference()
        if pref is None:
            return self.send_error(409)
        if self.headers.get("Content-Length") != "4":
            return self.send_error(400)
        value = self.rfile.read(4)
        if value == b"hide":
            pref.touch(mode=0o600)
        elif value == b"show":
            pref.unlink(missing_ok=True)
        else:
            return self.send_error(400)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    while True:
        ip = hotspot_ip()
        if not ip:
            time.sleep(2)
            continue
        with ThreadingHTTPServer((ip,80), Welcome, bind_and_activate=False) as server:
            server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, b"wlan0\0")
            server.server_bind()
            server.server_activate()
            server.config = Path(sys.argv[1])
            server.timeout = 2
            while hotspot_ip() == ip:
                server.handle_request()
