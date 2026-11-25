import json
import os
import secrets
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from time import perf_counter

ROOT = Path(__file__).resolve().parent
TOKEN = os.environ.get("QC_WEB_KEY") or secrets.token_urlsafe(18)
USB = ThreadPoolExecutor(max_workers=1)
connection = None
tuner_meter = None
DEMO = "--demo" in sys.argv
from editor import Editor
from demo import Demo

editor = Demo() if DEMO else None
DLL_HANDLE = None
browse_only = "--browse" in sys.argv
cache_dir = ROOT / ".device-library"


def store_library(action, entries):
    cache_dir.mkdir(exist_ok=True)
    target = cache_dir / (action + ".json")
    pending = target.with_suffix(".tmp")
    pending.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf8")
    pending.replace(target)
    return entries


def setup():
    global DLL_HANDLE
    if os.name == "nt":
        root = Path(sys.prefix) / "hidapi"
        candidates = [p.parent for p in root.rglob("hidapi.dll") if "x64" in p.parts]
        if os.getenv("QC_HID_DIR"):
            candidates.insert(0, Path(os.environ["QC_HID_DIR"]))
        for folder in candidates:
            if (folder / "hidapi.dll").is_file():
                DLL_HANDLE = os.add_dll_directory(str(folder.resolve()))
                break
    import pyquadcortex

    return pyquadcortex


def disconnect():
    global connection, editor, tuner_meter
    if connection is not None:
        client, connection, editor = connection, None, None
        meter, tuner_meter = tuner_meter, None
        try:
            if meter is not None:
                from pitch import subscribe_gate_meters
                try:
                    subscribe_gate_meters(client, False)
                finally:
                    meter.close()
        finally:
            client.close()


def device_request(action, data):
    global connection, editor, browse_only, tuner_meter
    try:
        if action == "release":
            if DEMO:
                return {"paused": False}
            if editor is not None:
                store_library("preview", editor.snapshot())
            disconnect()
            browse_only = True
            return {"paused": True}
        if action == "connect":
            try:
                browse_only = False
                return device_request("live", {})
            except Exception:
                browse_only = True
                disconnect()
                raise
        if browse_only:
            if action in ("cpu", "tuner", "global-tempo"):
                path = cache_dir / (action + ".json")
                return json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
            if action in ("library", "captures", "presets", "capture-layout"):
                target = cache_dir / (action + ".json")
                if not target.exists():
                    raise ValueError("저장된 목록이 없습니다. USB 연결 후 읽어 주세요.")
                return json.loads(target.read_text(encoding="utf8"))
            if action == "live":
                target = cache_dir / "preview.json"
                return {
                    "paused": True,
                    "preview": json.loads(target.read_text(encoding="utf8"))
                    if target.exists() and not data.get("knownPreview")
                    else None,
                }
            raise ValueError("USB 연결 후 편집할 수 있습니다.")
        if action == "capture-layout" and not data.get("refresh"):
            cached = cache_dir / "capture-layout.json"
            if cached.exists():
                return json.loads(cached.read_text(encoding="utf8"))
        if editor is None:
            connection = api.connect()
            editor = Editor(api, connection)
            from pitch import TunerMeter, subscribe_gate_meters
            tuner_meter = TunerMeter(connection)
            subscribe_gate_meters(connection, True)
        try:
            result = editor.request(action, data)
        except TimeoutError as exc:
            if action in ("cpu", "tuner", "global-tempo", "set-tempo", "master-volume", "master-state", "toolbar", "undo", "redo"):
                raise ValueError("본체에서 유틸리티 응답이 지연되었습니다.") from exc
            raise
        if action in ("cpu", "tuner", "global-tempo") and not DEMO:
            store_library(action, result)
        if action == "library" and not DEMO:
            access = cache_dir / "plugin-access.json"
            if access.exists():
                result["access"] = json.loads(access.read_text(encoding="utf8"))
        if action == "capture-layout":
            cached = cache_dir / "capture-layout.json"
            if cached.exists():
                old = json.loads(cached.read_text(encoding="utf8"))
                if result["pinned"] is None:
                    result["pinned"] = old.get("pinned")
                for f in result["folders"]:
                    if f["members"] is None:
                        previous = next(
                            (x for x in old["folders"] if x["key"] == f["key"]), None
                        )
                        if previous:
                            f["members"] = previous["members"]
        if action in ("library", "captures", "presets", "capture-layout") and not DEMO:
            store_library(action, result)
        return result
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Invalid editor request") from exc
    except ValueError:
        raise
    except Exception:
        disconnect()
        raise


def operate(action, data):
    if action == "beat":
        client = connection
        if client is None or browse_only or DEMO:
            return {}
        from pyquadcortex.client import pa
        try:
            msg = client._t.await_broadcast(
                pa.GlobalTempoMessage, lambda: None, timeout=.24,
                match=lambda m: m.HasField("metronome_status"),
            )
            return {"beat": msg.metronome_status.current_beat}
        except TimeoutError:
            return {}
    if action == "gate-meter":
        client = connection
        if client is None or DEMO or browse_only:
            return {"value": None}
        from pitch import read_gate_meter
        return read_gate_meter(client, data.get("row"))
    if action == "meters":
        if browse_only or DEMO or connection is None:
            return {}
        import pitch
        return pitch.read_meters()
    if action in ("pitch", "tuner-stop", "tuner-input", "tuner-mute"):
        meter = tuner_meter
        if DEMO and action == "tuner-mute":
            return USB.submit(device_request, action, data).result()
        if (meter is None or browse_only) and action in ("tuner-mute", "tuner-input") and not DEMO:
            raise ValueError("본체가 연결된 상태에서 변경할 수 있습니다.")
        if meter is None or browse_only or DEMO:
            return {}
        owner = data.get("owner")
        if not isinstance(owner, str) or not 1 <= len(owner) <= 80:
            raise ValueError("Invalid tuner session")
        if action == "pitch":
            return meter.read(owner, data.get("mode"))
        if action == "tuner-input":
            return meter.set_control(owner, "input_port_id", data.get("input"))
        if action == "tuner-mute":
            return meter.set_control(owner, "mute", data.get("mute"))
        meter.stop(owner)
        return {}
    return USB.submit(device_request, action, data).result()


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        if self.path not in ("/api/meters", "/api/gate-meter", "/api/master-state") or code != 200:
            super().log_request(code, size)

    def send(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/app.js":
            return self.send(200, (ROOT / "app.js").read_bytes(), "text/javascript")
        if self.path != "/":
            return self.send_error(404)
        self.send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")

    def do_POST(self):
        if self.headers.get("X-QC-Key", "") != TOKEN:
            return self.send_error(403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError("잘못된 요청 크기입니다.")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("잘못된 요청입니다.")
            started = perf_counter()
            result = operate(self.path.removeprefix("/api/"), data)
            if self.path not in ("/api/meters", "/api/gate-meter", "/api/master-state"):
                print(f"{self.path} {perf_counter() - started:.2f}s", flush=True)
            status = 200
        except Exception as exc:
            status = 400 if isinstance(exc, ValueError) else 503
            result = dict(error=str(exc) or type(exc).__name__)
        self.send(status, json.dumps(result).encode(), "application/json")


if __name__ == "__main__":
    if not DEMO:
        api = setup()
    server = ThreadingHTTPServer(("0.0.0.0", 8765), Handler)
    ips = set(socket.gethostbyname_ex(socket.gethostname())[2]) | {"127.0.0.1"}
    for ip in sorted(ips):
        print(f"http://{ip}:8765/#{TOKEN}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        USB.submit(disconnect).result()
        USB.shutdown()
