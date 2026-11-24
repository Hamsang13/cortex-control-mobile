import inspect
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
DEMO = "--demo" in sys.argv
demo_blocks = [
    dict(row=0, col=0, model=1, name="Optical Comp", knobs={"LEVEL": 0.45}),
    dict(row=0, col=2, model=2, name="Studio Amp", knobs={"GAIN": 0.35, "BASS": 0.5, "MID": 0.57, "TREBLE": 0.62}),
    dict(row=0, col=4, model=3, name="Tape Echo", knobs={"MIX": 0.24, "FEEDBACK": 0.4}),
    dict(row=1, col=6, model=4, name="Room Reverb", knobs={"MIX": 0.18}),
]
DLL_HANDLE = None


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


KNOBS = {"GAIN", "DRIVE", "BASS", "MID", "MIDDLE", "TREBLE", "PRESENCE", "MIX", "MASTER", "LEVEL", "DEPTH", "FEEDBACK"}


def snapshot(qc):
    preset = qc.read_current_preset()
    blocks = []
    for row, chain in enumerate(preset.chains):
        for col, block in enumerate(chain.models):
            if not block.hash:
                continue
            try:
                model = qc.catalog[block.hash]
            except (IndexError, KeyError):
                model = None
            knobs = {}
            if model:
                for spec, param in zip(model.parameters, block.params):
                    name = spec.name
                    if name.upper() not in KNOBS or param.scene_mode or not param.param_values:
                        continue
                    value = param.param_values[0]
                    if not any(f.name == "float_value" for f, _ in value.ListFields()):
                        continue
                    if 0 <= value.float_value <= 1:
                        knobs[name] = value.float_value
            blocks.append(dict(row=row, col=col, model=int(block.hash),
                               name=model.name if model else str(block.hash), knobs=knobs))
    return dict(name=preset.name, blocks=blocks)


def validate_edit(state, data):
    if state["name"] != data.get("preset"):
        raise ValueError("본체 프리셋이 바뀌었습니다. 다시 읽어 주세요.")
    value = data.get("value")
    if type(value) not in (float, int) or not 0 <= value <= 1:
        raise ValueError("노브 범위가 올바르지 않습니다.")
    for block in state["blocks"]:
        if all(block[k] == data.get(k) for k in ("row", "col", "model")):
            old = block["knobs"].get(data.get("param"))
            if old is not None and old == data.get("previous"):
                return
    raise ValueError("본체 블록이나 값이 바뀌었습니다. 다시 읽어 주세요.")


def operate(action, data):
    if action not in ("live", "edit"):
        raise ValueError("지원하지 않는 요청입니다.")
    return USB.submit(device_request, action, data).result()


def disconnect():
    global connection
    if connection is not None:
        client, connection = connection, None
        client.close()


def device_request(action, data):
    global connection
    if DEMO:
        state = dict(name="Demo · Clean", blocks=demo_blocks)
        if action == "edit":
            validate_edit(state, data)
            target = next(b for b in demo_blocks if (b["row"], b["col"]) == (data["row"], data["col"]))
            target["knobs"][data["param"]] = data["value"]
        return state
    try:
        if connection is None:
            options = inspect.signature(api.connect).parameters
            connection = api.connect(initial_file_listing=False) if "initial_file_listing" in options else api.connect()
        state = snapshot(connection)
        if action == "edit":
            validate_edit(state, data)
            connection.set_param(row=data["row"], column=data["col"], param=data["param"],
                                 model=data["model"], value=data["value"])
            return snapshot(connection)
        return state
    except ValueError:
        raise
    except Exception:
        disconnect()
        raise


class Handler(BaseHTTPRequestHandler):
    def send(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
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
