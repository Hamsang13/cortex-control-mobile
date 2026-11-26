"""One-time local hotspot enrollment; run as the service account."""
import html
import json
import secrets
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from pi_settings import write_config

HOST = "10.42.0.1:8765"
URL = "http://" + HOST


class Setup(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def page(self, body, status=200):
        data = ('<!doctype html><html lang="ko"><meta charset=utf-8><meta name="viewport" '
                'content="width=device-width,initial-scale=1"><title>Cortex Remote 설정</title>'
                '<style>body{background:#151515;color:#eee;font:16px system-ui;max-width:32rem;'
                'margin:8vh auto;padding:1rem}input,button{display:block;padding:.7rem;margin:.4rem 0 1rem;'
                'width:100%;box-sizing:border-box}a{color:#64ef83}</style>'+body).encode()
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
        self.page(f"""<h1>Cortex Remote 최초 설정</h1>
<p>새 Wi-Fi 이름과 비밀번호, 접속 키를 보관하세요. 저장하면 설치용 Wi-Fi가 닫힙니다.</p>
<form method="post"><input type="hidden" name="proof" value="{self.server.nonce}">
<label>사용할 Wi-Fi 이름<input name="ssid" required maxlength="32" value="Cortex-Remote-{secrets.token_hex(2)}"></label>
<label>새 Wi-Fi 비밀번호<input name="wifi" required minlength="8" maxlength="63" value="{secrets.token_hex(8)}"></label>
<label>접속 키<input name="key" required pattern="[A-Za-z0-9_-]{{16,128}}" value="{secrets.token_urlsafe(18)}"></label>
<p>새 Wi-Fi에서 {URL}/#접속키 로 접속하세요.</p><button>저장하고 개인 핫스팟 시작</button></form>""")

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
        except (KeyError, ValueError) as e:
            return self.page("입력값을 확인하고 뒤로 가세요. "+html.escape(str(e)),400)
        self.page(f'<h1>설정 완료</h1><p>{html.escape(cfg["ssid"])}에 다시 연결한 뒤 '
                  f'<a href="{URL}/#{cfg["key"]}">Cortex Remote 열기</a>를 누르세요. 이 링크를 북마크하세요.</p><p>업데이트·네트워크 설정용 관리자 키를 별도로 보관하세요. <code>{html.escape(cfg["adminKey"])}</code></p>')


def enroll(path):
    with HTTPServer(("10.42.0.1",8765), Setup) as server:
        server.nonce = secrets.token_urlsafe(24)
        server.config = path
        while not path.exists():
            server.handle_request()


if __name__ == "__main__":
    enroll(Path(sys.argv[1]))
