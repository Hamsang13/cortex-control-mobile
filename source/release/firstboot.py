"""One-time local hotspot enrollment; run as the service account."""
import html
import secrets
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from pi_settings import write_config

HOST = "10.42.0.1:8765"
URL = "http://" + HOST


def label(en, ko):
    return f'<span lang="en">{html.escape(en)}</span><span lang="ko">{html.escape(ko)}</span>'


PAGE_START = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cortex Remote</title>
<style>
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;min-height:100vh;min-height:100dvh;padding-bottom:calc(clamp(36px,6vh,64px) + env(safe-area-inset-bottom,0px));background:#0b0b0c;color:#eee;font:15px/1.5 system-ui,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;padding:10px clamp(16px,4vw,48px);border-bottom:1px solid #303032;background:#121213}
header strong{font-size:17px}header label{position:relative;display:grid;place-items:center;width:44px;height:44px;border-radius:8px;background:#222224}
header select{position:absolute;inset:0;width:100%;opacity:0;cursor:pointer}header label:focus-within{outline:2px solid #5ce477}
main{max-width:490px;margin:clamp(24px,8vh,80px) auto 0;padding:24px 24px 32px;background:#1a1a1c;border:1px solid #343436;border-radius:12px}
h1{font-size:22px;margin:0}p{color:#bcbcbf}form label{display:block;margin:16px 0}
input,button{font:inherit;width:100%;padding:10px 12px;border-radius:6px}input{display:block;margin-top:5px;background:#111113;color:#eee;border:1px solid #444}
input:focus-visible,button:focus-visible{outline:2px solid #5ce477}button{cursor:pointer;background:#65e882;border:0;color:#101713;font-weight:650}a{color:#65e882}
html[lang=en] span[lang=ko],html[lang=ko] span[lang=en]{display:none}
@media(max-width:540px){main{margin:20px 12px 0;padding:18px 18px 26px}}
</style><header><strong>Cortex Remote</strong><label title="Language / 언어">
<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>
<select aria-label="Language / 언어" id="language"><option value="en">English</option><option value="ko">한국어</option></select></label></header><main>"""

LANGUAGE_SCRIPT = """<script>
const menu=document.querySelector('#language');
function applyLanguage(lang){menu.value=lang;document.documentElement.lang=lang}
try{applyLanguage(localStorage.getItem('cortex.settings.language')==='ko'?'ko':'en')}catch{}
menu.onchange=()=>{applyLanguage(menu.value);try{localStorage.setItem('cortex.settings.language',menu.value)}catch{}};
</script></html>"""


def copy_controls(url):
    return f"""<label>{label("Remote address","리모트 주소")}
<input id="remoteUrl" readonly value="{html.escape(url, quote=True)}"></label>
<button type="button" id="copyUrl">{label("Copy remote address","리모트 주소 복사")}</button>
<p role="status" id="copyStatus"></p>
<script>
document.querySelector('#copyUrl').onclick=async()=>{{
 const input=document.querySelector('#remoteUrl');
 let copied=false;
 try{{if(navigator.clipboard){{await navigator.clipboard.writeText(input.value);copied=true}}}}catch{{}}
 if(!copied){{input.focus();input.select();input.setSelectionRange(0,input.value.length);
 try{{copied=document.execCommand('copy')}}catch{{}}}}
 document.querySelector('#copyStatus').textContent=document.documentElement.lang==='ko'?
 (copied?'복사했습니다.':'선택한 주소를 길게 눌러 복사하세요.'):(copied?'Copied.':'Touch and hold the selected address to copy.');
}};
</script>"""


class Setup(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def page(self, body, status=200):
        data = (PAGE_START + body + "</main>" + LANGUAGE_SCRIPT).encode()
        self.send_response(status)
        self.send_header("Content-Type","text/html; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/" or self.headers.get("Host") != HOST:
            return self.send_error(404)
        self.page(f"""<h1>{label("Initial setup","Cortex Remote 최초 설정")}</h1>
<p>{label("Keep your Wi-Fi name, password and access key. Saving will close the setup hotspot.","새 Wi-Fi 이름과 비밀번호, 접속 키를 보관하세요. 저장하면 설치용 Wi-Fi가 닫힙니다.")}</p>
<form method="post"><input type="hidden" name="proof" value="{self.server.nonce}">
<label>{label("Wi-Fi name","사용할 Wi-Fi 이름")}<input name="ssid" required maxlength="32" value="Cortex-Remote-{secrets.token_hex(2)}"></label>
<label>{label("Wi-Fi password","새 Wi-Fi 비밀번호")}<input name="wifi" required minlength="8" maxlength="63" value="{secrets.token_hex(8)}"></label>
<label>{label("Access key","접속 키")}<input name="key" required pattern="(?:[A-Za-z0-9_]|-){{16,128}}" value="{secrets.token_urlsafe(18)}"></label>
{copy_controls(URL+"/")}
<script>const setupKey=document.querySelector('[name=key]');function updateLink(){{document.querySelector('#remoteUrl').value=location.origin+'/#'+encodeURIComponent(setupKey.value)}}setupKey.oninput=updateLink;updateLink()</script>
<p>{label("On the new Wi-Fi, open the link shown after saving.", "새 Wi-Fi에 연결한 뒤 저장 완료 화면의 링크를 여세요.")}</p><button>{label("Save and start hotspot","저장하고 개인 핫스팟 시작")}</button></form>""")

    def do_POST(self):
        if self.path != "/" or self.headers.get("Host") != HOST or self.headers.get("Origin", URL) != URL:
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length",0))
            if not 0 < n < 2048:
                return self.send_error(400)
            values = parse_qs(self.rfile.read(n).decode(), strict_parsing=True)
            if values["proof"] != [self.server.nonce]:
                return self.send_error(403)
            cfg = {k:values[k][0] for k in ("ssid","wifi","key")}
            if cfg["ssid"] == "Cortex-Remote-Setup":
                raise ValueError("설치용 Wi-Fi와 다른 이름을 입력하세요.")
            cfg.update(url=URL, revision=secrets.token_hex(8))
            write_config(self.server.config, cfg)
        except (KeyError, ValueError):
            return self.page(label("Check the Wi-Fi name, password and access key, then go back and retry.", "Wi-Fi 이름, 비밀번호, 접속 키를 확인하고 뒤로 가서 다시 시도하세요."),400)
        ssid = cfg["ssid"]
        self.page(f'<h1>{label("Setup complete", "설정 완료")}</h1>'
                  f'<p>{label(f"Connect to {ssid}, then open and bookmark the remote.", f"{ssid}에 연결한 뒤 리모트를 열어 즐겨찾기에 추가하세요.")}</p>'
                  + copy_controls(URL+"/#"+cfg["key"]) + f'<a href="{URL}/#{cfg["key"]}">{label("Open Cortex Remote","Cortex Remote 열기")}</a>')


def enroll(path):
    with HTTPServer(("10.42.0.1",8765), Setup) as server:
        server.nonce = secrets.token_urlsafe(24)
        server.config = path
        while not path.exists():
            server.handle_request()


if __name__ == "__main__":
    enroll(Path(sys.argv[1]))
