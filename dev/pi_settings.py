"""Persistent settings for the installer-managed Raspberry Pi hotspot."""
import hmac
import ipaddress
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

LOCK = Lock()
PROFILE = "QC-Pedalboard"


def address(url):
    parsed = urlsplit(url)
    ip = ipaddress.IPv4Address(parsed.hostname)
    networks = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
    if (parsed.scheme != "http" or parsed.username is not None or parsed.password is not None
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or not any(ip in ipaddress.ip_network(n) for n in networks)
            or int(ip) % 256 in (0, 255) or not 1024 <= (parsed.port or 0) <= 65535):
        raise ValueError("사설 IPv4 주소와 포트를 입력하세요. 예: http://10.42.0.1:8765")
    return str(ip), parsed.port


def validate(config):
    ssid, wifi, key = (config[k] for k in ("ssid", "wifi", "key"))
    if not ssid.strip() or not ssid.isprintable() or len(ssid.encode()) > 32:
        raise ValueError("Wi-Fi 이름은 1~32바이트로 입력하세요.")
    if not re.fullmatch(r"[ -~]{8,63}", wifi):
        raise ValueError("Wi-Fi 비밀번호는 영문·숫자·기호 8~63자로 입력하세요.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{16,128}", key):
        raise ValueError("접속 키는 영문·숫자·밑줄·하이픈 16~128자로 입력하세요.")
    address(config["url"])
    return config


def write_config(path, config):
    validate(config)
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf8", delete=False) as f:
        tmp = Path(f.name)
        try:
            json.dump(config, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def read_config(path):
    return validate(json.loads(path.read_text(encoding="utf8")))


def boot_proof(config):
    return hmac.digest(config["key"].encode(), ("reconnect:" + config["revision"]).encode(), "sha256").hex()


def pi_request(path, data, save):
    if path is None:
        return {"available": False}
    with LOCK:
        config = read_config(path)
        if save:
            if data.get("revision") != config["revision"]:
                raise ValueError("다른 화면에서 접속 설정이 바뀌었습니다. 다시 열어 주세요.")
            for field in ("ssid", "url", "wifi", "key"):
                value = data.get(field)
                if not isinstance(value, str):
                    raise ValueError("접속 설정을 확인하세요.")
                if value or field in ("ssid", "url"):
                    config[field] = value
            config["revision"] = secrets.token_hex(8)
            write_config(path, config)
        result = {k: config[k] for k in ("ssid", "url", "revision")} | {"available": True}
        if save:
            result["reconnect"] = {"url": config["url"].rstrip("/") + "/#" + config["key"],
                                   "proof": boot_proof(config)}
        return result


def apply_network(config):
    ip, _ = address(config["url"])
    run = lambda args, **kw: subprocess.run(["/usr/bin/nmcli", *args], check=True,
                                            stderr=subprocess.DEVNULL, **kw)
    run(["connection", "modify", PROFILE,
         "802-11-wireless.ssid", config["ssid"],
         "802-11-wireless-security.psk", config["wifi"],
         "ipv4.addresses", ip + "/24"], stdout=subprocess.DEVNULL)
    # Re-activate on boot so NetworkManager uses the stored credentials.
    # A live upgrade over a different Wi-Fi connection can finish in place.
    active = run(["-g", "GENERAL.CONNECTION", "device", "show", "wlan0"],
                 stdout=subprocess.PIPE, text=True).stdout.strip()
    if active in ("", "--", PROFILE):
        run(["connection", "up", PROFILE], stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    command, filename = sys.argv[1:]
    path = Path(filename)
    if command == "init" and not path.exists():
        def original(name, default):
            file = path.parent / name
            return file.read_text().strip() if file.is_file() else default
        write_config(path, dict(ssid=PROFILE, wifi=original("wifi", secrets.token_hex(8)),
                                key=original("key", secrets.token_urlsafe(18)), url="http://10.42.0.1:8765",
                                revision=secrets.token_hex(8)))
    elif command == "show":
        c = read_config(path)
        print(f"Wi-Fi: {c['ssid']}\nPassword: {c['wifi']}\nRemote: {c['url']}/#{c['key']}")
    elif command == "apply":
        try:
            apply_network(read_config(path))
        except subprocess.CalledProcessError:
            sys.exit("NetworkManager could not apply the Cortex Remote hotspot profile.")

