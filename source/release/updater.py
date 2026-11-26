"""Unprivileged uploader and app supervisor. Network services stay running."""
import contextlib
import fcntl
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from package import LIMIT, unpack

RUNTIME = Path(__file__).resolve().parent
DATA = Path(os.environ["QC_DATA_DIR"])
STORE = DATA / "updates"
STATE = STORE / "state.json"


def state():
    if STATE.exists():
        return json.loads(STATE.read_bytes())
    return dict(active="base", status="idle")


@contextlib.contextmanager
def exclusive():
    STORE.mkdir(mode=0o700, exist_ok=True)
    with (STORE / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def record(s):
    tmp = STORE / "state.tmp"
    with tmp.open("w") as f:
        json.dump(s, f)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(STATE)
    fd = os.open(STORE, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def policy():
    path = RUNTIME / "policy.json"
    return json.loads(path.read_bytes())


def upload(stream, size, expected=None):
    if not 0 < size <= LIMIT:
        raise ValueError("업데이트 ZIP은 16 MiB 이하로 선택하세요.")
    with exclusive():
        current = state()
        if current["status"] in ("pending","starting"):
            raise ValueError("다른 업데이트를 적용하고 있습니다.")
        with tempfile.TemporaryDirectory(dir=STORE) as tmp:
            trust = policy()
            floor = max(current.get("sequence", 0), trust["baseSequence"])
            stage = Path(tmp)/"app"
            stage.mkdir()
            with tempfile.TemporaryFile(dir=STORE) as archive:
                remaining = size
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        raise ValueError("업로드가 중단되었습니다.")
                    archive.write(chunk)
                    remaining -= len(chunk)
                archive.seek(0)
                try:
                    digest = unpack(archive, stage, RUNTIME/"update-public.pem", trust["channel"])
                except Exception as exc:
                    raise ValueError("공식 업데이트 ZIP의 서명 또는 파일 검증에 실패했습니다.") from exc
            manifest = json.loads((stage/"manifest.json").read_bytes())
            sequence = manifest["sequence"]
            if sequence <= floor:
                raise ValueError("이미 설치한 빌드 또는 이전 빌드입니다.")
            if expected and (digest != expected["manifest"] or any(
                    manifest[k] != expected[k] for k in ("version","sequence","channel"))):
                raise ValueError("게시 정보와 패키지가 일치하지 않습니다.")
            dest = STORE / digest
            if not dest.exists():
                stage.rename(dest)
            else:
                # Only reuse immutable, previously verified payloads.
                if any((dest/f.name).read_bytes()!=f.read_bytes() for f in stage.iterdir()):
                    raise ValueError("기존 설치 파일 검증에 실패했습니다.")
            ticket = secrets.token_hex(12)
            record(dict(active=current["active"], sequence=floor, target=digest, targetSequence=sequence, ticket=ticket, status="pending"))
            return {"ticket":ticket}


def stop(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=4)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def supervise():
    with exclusive():
        s = state()
        if s["status"] == "starting":
            s["status"] = "rollback"
            record(s)
    config = json.loads(Path(os.environ["QC_PI_CONFIG"]).read_bytes())
    from urllib.parse import urlsplit
    port = urlsplit(config["url"]).port
    def start(which, nonce):
        target = DATA if which == "base" else STORE / which
        env = dict(os.environ, QC_HEALTH_ID=nonce, QC_RUNNING_CONFIG=json.dumps(config),
                   PYTHONPATH=str(RUNTIME), PYTHONDONTWRITEBYTECODE="1")
        return subprocess.Popen([sys.executable, str(target/"server.py")], cwd=DATA, env=env)
    child = start(s["active"], secrets.token_hex(16))
    try:
        while True:
            time.sleep(.5)
            with exclusive():
                s = state()
                if s["status"] != "pending":
                    if child.poll() is not None:
                        raise RuntimeError("App stopped")
                    continue
                s["status"] = "starting"
                record(s)
            stop(child)
            nonce = secrets.token_hex(16)
            child = start(s["target"], nonce)
            deadline = time.monotonic()+35
            healthy = 0
            while child.poll() is None and time.monotonic() < deadline and healthy < 3:
                time.sleep(.6)
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/app-health",timeout=1) as reply:
                        healthy = healthy+1 if reply.read(128).decode()==nonce else 0
                except (OSError, ValueError):
                    healthy = 0
            if healthy == 3 and child.poll() is None:
                s.update(active=s["target"], sequence=s["targetSequence"], status="applied")
            else:
                stop(child)
                child = start(s["active"], secrets.token_hex(16))
                s["status"] = "rollback"
            with exclusive():
                record(s)
                for folder in STORE.iterdir():
                    if folder.is_dir() and len(folder.name)==64 and folder.name!=s["active"]:
                        shutil.rmtree(folder)
    finally:
        stop(child)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    supervise()
