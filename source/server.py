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
from pi_settings import address, boot_proof, pi_request, read_config
PI_PATH = Path(os.environ["QC_PI_CONFIG"]) if os.getenv("QC_PI_CONFIG") else None
PI_CONFIG = json.loads(os.environ["QC_RUNNING_CONFIG"]) if "QC_RUNNING_CONFIG" in os.environ else (read_config(PI_PATH) if PI_PATH else {})
PORT = address(PI_CONFIG["url"])[1] if PI_CONFIG else 8765
TOKEN = PI_CONFIG.get("key") or os.environ.get("QC_WEB_KEY") or secrets.token_urlsafe(18)
USB = ThreadPoolExecutor(max_workers=1)
DIRECTORY = ThreadPoolExecutor(max_workers=1)
connection = None
tuner_meter = None
live_meters = None
DEMO = "--demo" in sys.argv
from plugin_sync import GUIDE, load_snapshot, read_controller, save_snapshot
from editor import Editor
from demo import Demo

editor = Demo() if DEMO else None
DLL_HANDLE = None
browse_only = "--browse" in sys.argv
warm_snapshot = None
preview_stamp = None
cache_dir = Path(os.environ.get("QC_DATA_DIR", ROOT)) / ".device-library"


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
    global connection, editor, tuner_meter, live_meters
    if connection is not None:
        client, connection, editor = connection, None, None
        frames, live_meters = live_meters, None
        if frames:
            frames.close()
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
    global connection, editor, browse_only, tuner_meter, live_meters, warm_snapshot, preview_stamp
    if warm_snapshot is not None:
        stamp, snapshot = warm_snapshot
        warm_snapshot = None
        if action == "live" and perf_counter() - stamp < .85:
            return snapshot
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
            if action in ("cpu", "tuner", "global-tempo", "io-settings"):
                path = cache_dir / (action + ".json")
                return json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
            if action in ("library", "captures", "presets", "capture-layout", "preset-directory"):
                target = cache_dir / (action + ".json")
                if not target.exists():
                    raise ValueError("저장된 목록이 없습니다. USB 연결 후 읽어 주세요.")
                entries = json.loads(target.read_text(encoding="utf8"))
                if action == "library":
                    entries.pop("access", None)
                    entries["owned"] = load_snapshot(entries.get("deviceKey"),cache_dir / "controller-plugins")
                return entries
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
            from pitch import LiveMeterFrames
            live_meters = LiveMeterFrames(connection)
            tuner_meter = TunerMeter(connection)
            subscribe_gate_meters(connection, True)
        try:
            result = editor.request(action, data)
            if action == "live" and not DEMO and not hasattr(editor, "directory_read"):
                start_directory_read(editor)
        except TimeoutError as exc:
            if action in ("device-settings","device-set","io-settings","io-set","cpu", "tuner", "global-tempo", "set-tempo", "master-volume", "master-state", "toolbar", "undo", "redo"):
                raise ValueError("본체에서 유틸리티 응답이 지연되었습니다.") from exc
            raise
        if not DEMO and isinstance(result, dict) and "rev" in result and "blocks" in result:
            stamp = (result["rev"], result["scene"], result["dirty"])
            if stamp != preview_stamp:
                store_library("preview", result)
                preview_stamp = stamp
        elif not DEMO and action == "live" and result.get("unchanged"):
            stamp = (data["known"], result["scene"], result["dirty"])
            if stamp != preview_stamp:
                store_library("preview", dict(editor.grid, rev=stamp[0], scene=stamp[1], dirty=stamp[2]))
                preview_stamp = stamp
        if action in ("cpu", "tuner", "global-tempo") and not DEMO:
            store_library(action, result)
        if action in ("io-settings", "io-set") and not DEMO:
            store_library("io-settings", result)
        if action == "library" and not DEMO:
            result["owned"] = load_snapshot(result.get("deviceKey"),cache_dir / "controller-plugins")
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
        if action in ("library", "captures", "presets", "capture-layout", "preset-directory") and not DEMO:
            store_library(action, result)
        return result
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Invalid editor request") from exc
    except ValueError:
        raise
    except Exception:
        disconnect()
        raise


def preload_preset():
    global warm_snapshot
    try:
        state = device_request("live", {})
        warm_snapshot = (perf_counter(), state)
    except Exception as exc:
        print(f"Initial preset read: {exc}", flush=True)


def renew_meters(frames):
    if live_meters is frames and connection is not None and not browse_only:
        from pitch import subscribe_gate_meters
        subscribe_gate_meters(connection, True)


def start_directory_read(current):
    pending = getattr(current, "directory_read", None)
    if pending is None or (pending.done() and pending.exception() is not None):
        def scan():
            folders = current.request("preset-directory", {})
            if current is editor:
                store_library("preset-directory", folders)
            return folders
        current.directory_read = DIRECTORY.submit(scan)
    return current.directory_read


def directory_data(action, data):
    current = editor
    if DEMO:
        folders = current.request("preset-directory", {})
    elif browse_only:
        path = cache_dir / "preset-directory.json"
        folders = json.loads(path.read_text(encoding="utf8")) if path.exists() else []
    elif current is not None:
        pending = getattr(current, "directory_read", None)
        if pending is None or (pending.done() and pending.exception() is not None):
            pending = USB.submit(start_directory_read, current).result()
        pending.result()
        if current is not editor:
            raise ValueError("USB 연결이 변경되었습니다.")
        folders = list(current.directory_folders.values())
    else:
        raise ValueError("USB 연결을 기다리는 중입니다.")
    if action == "directory-group":
        return [entry for f in folders if f["name"] == data.get("name") for entry in f["entries"]]
    return dict(folders=[{k:f[k] for k in ("name","local","key")} for f in folders],
                presets=[entry for f in folders if f["name"]=="My Presets" for entry in f["entries"]])


def operate(action, data):
    if action == "external-wifi":
        from pi_settings import external_wifi
        return external_wifi(PI_CONFIG, data)
    if action in ("online-check","online-install"):
        if not os.environ.get("QC_HEALTH_ID"):
            raise ValueError("리모트 디바이스 설치 환경이 필요합니다.")
        from pi_settings import online_update
        return online_update(data.get("build"), action == "online-install")
    if action == "update-status":
        if not os.environ.get("QC_HEALTH_ID"):
            return {"available": False}
        from updater import state
        current = state()
        return {"available": True, "status": current["status"], "ticket": current.get("ticket")}
    if action in ("pi-settings", "pi-set"):
        return pi_request(PI_PATH, data, action == "pi-set")
    if action in ("directory-index", "directory-group"):
        return directory_data(action, data)
    if action == "presets" and not DEMO and not browse_only:
        current = editor
        if current is not None:
            entries = current.cached_presets()
            if entries is not None:
                return entries
    snapshots = cache_dir / "controller-plugins"
    if action == "plugin-import":
        return save_snapshot(data,snapshots)
    if action == "plugin-refresh":
        if os.name == "nt" and not DEMO:
            return save_snapshot(read_controller(),snapshots)
        key = USB.submit(device_request,"library",{}).result().get("deviceKey")
        return {"deviceKey":key,"owned":load_snapshot(key,snapshots),"guide":GUIDE + " PC에서 python plugin_sync.py를 실행해 이 리모트 디바이스로 목록을 보내세요."}
    if action == "preview":
        cached = {}
        if not DEMO:
            for entry in ("preview", "library", "presets"):
                try:
                    cached[entry] = json.loads((cache_dir / (entry + ".json")).read_text(encoding="utf8"))
                    if entry == "library":
                        cached[entry].pop("access", None)
                        cached[entry].pop("owned", None)
                except (OSError, ValueError):
                    pass
        return cached
    if action == "io-meter":
        frames = live_meters
        return frames.snapshot()["io"] if frames and not browse_only else {}
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
        row = data.get("row")
        if type(row) is not int or not 0 <= row < 4:
            raise ValueError("Invalid input gate row")
        frames = live_meters
        return {"value": frames.snapshot()["gates"].get(row) if frames and not browse_only else None}
    if action == "meters":
        if browse_only or DEMO or connection is None:
            return {}
        frames = live_meters
        if frames and frames.needs_subscription():
            USB.submit(renew_meters, frames)
        return frames.snapshot() if frames else {}
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
        if self.path not in ("/api/meters", "/api/io-meter", "/api/gate-meter", "/api/master-state") or code != 200:
            super().log_request(code, size)

    def send(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/app-health" and os.environ.get("QC_HEALTH_ID") and self.client_address[0] == "127.0.0.1":
            return self.send(200, os.environ["QC_HEALTH_ID"].encode(), "text/plain")
        if self.path.startswith("/wifi-ready/") and PI_CONFIG:
            from pi_settings import external_wifi
            try:
                network = external_wifi(PI_CONFIG, {"action":"status"})
            except (OSError, ValueError):
                network = {}
            if network.get("phase") != "trial" or network.get("ticket") != self.path.split("/")[-1]:
                return self.send_error(404)
            self.path = "/pi-ready"
        if self.path == "/pi-ready" and PI_CONFIG:
            self.send_response(200)
            data = boot_proof(PI_CONFIG).encode("ascii")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/app.js":
            return self.send(200, (ROOT / "app.js").read_bytes(), "text/javascript")
        if self.path.partition("?")[0] != "/":
            return self.send_error(404)
        self.send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")

    def do_POST(self):
        if self.headers.get("X-QC-Key", "") != TOKEN:
            return self.send_error(403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.path == "/api/update-zip":
                if not os.environ.get("QC_HEALTH_ID"):
                    raise ValueError("업데이트 설치 환경이 필요합니다.")
                from updater import upload
                self.connection.settimeout(30)
                result = upload(self.rfile, length)
                return self.send(202, json.dumps(result).encode(), "application/json")
            if not 0 < length <= 1024:
                raise ValueError("잘못된 요청 크기입니다.")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("잘못된 요청입니다.")
            action = self.path.removeprefix("/api/")
            started = perf_counter()
            result = operate(self.path.removeprefix("/api/"), data)
            if self.path not in ("/api/meters", "/api/io-meter", "/api/gate-meter", "/api/master-state"):
                print(f"{self.path} {perf_counter() - started:.2f}s", flush=True)
            status = 200
        except Exception as exc:
            status = 400 if isinstance(exc, ValueError) else 503
            result = dict(error=str(exc) or type(exc).__name__)
        self.send(status, json.dumps(result).encode(), "application/json")


if __name__ == "__main__":
    if not DEMO:
        api = setup()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        ips = set(socket.gethostbyname_ex(socket.gethostname())[2]) | {"127.0.0.1"}
    except OSError:
        ips = {"127.0.0.1"}
    for ip in sorted(ips):
        print(f"http://{ip}:{PORT}/" + ("" if PI_CONFIG else f"#{TOKEN}"), flush=True)
    if not DEMO and not browse_only:
        USB.submit(preload_preset)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        USB.submit(disconnect).result()
        USB.shutdown()
        DIRECTORY.shutdown()
