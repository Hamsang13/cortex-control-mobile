"""Local privileged NetworkManager helper. Only the configured app UID may issue requests."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import socket
import struct
import subprocess
import sys
import time
import uuid

AP = "QC-Pedalboard"
SLOTS = ("cortex-phone-a", "cortex-phone-b")
PROFILES = Path("/etc/NetworkManager/system-connections")
SAVED = Path("/var/lib/cortex-network/preferred")
PENDING = SAVED.with_name("transition")
LAST_AP = SAVED.with_name("ap-uuid")
SOCKET = Path("/run/cortex-network/control.sock")


def nm(*args):
    return subprocess.run(["/usr/bin/nmcli", "--wait", "20", *args], check=True,
                          capture_output=True, text=True, timeout=25).stdout.strip()


def profile(slot, ssid, password):
    if not isinstance(ssid, str) or not ssid.isprintable() or not 1 <= len(ssid.encode()) <= 32:
        raise ValueError("Invalid SSID")
    if not isinstance(password, str) or not password.isascii() or not password.isprintable() or not 8 <= len(password) <= 63:
        raise ValueError("Expected an 8–63 character WPA2 password")
    # Encode the SSID as NetworkManager's byte list. No user text becomes keyfile syntax.
    octets = "".join(f"{byte};" for byte in ssid.encode())
    key = hashlib.pbkdf2_hmac("sha1", password.encode(), ssid.encode(), 4096, 32).hex()
    path = PROFILES / (slot + ".nmconnection")
    tmp = path.with_suffix(".tmp")
    tmp.write_text(f"""[connection]
id={slot}
uuid={uuid.uuid5(uuid.NAMESPACE_DNS, slot)}
type=wifi
interface-name=wlan0
autoconnect=false
[wifi]
mode=infrastructure
ssid={octets}
[wifi-security]
key-mgmt=wpa-psk
psk={key}
[ipv4]
method=auto
[ipv6]
method=auto
""")
    tmp.replace(path)
    nm("connection", "load", str(path))


class Network:
    def __init__(self):
        self.saved = SAVED.read_text().strip() if SAVED.exists() else ""
        if self.saved not in SLOTS:
            self.saved = ""
        self.phase = "idle"
        self.target = ""
        self.ticket = ""
        self.deadline = 0
        if PENDING.exists():
            self.phase = "recovering"
        elif self.saved:
            self.schedule(self.saved)

    def schedule(self, slot):
        PENDING.touch()
        self.phase = "scheduled"
        self.target = slot
        self.ticket = secrets.token_urlsafe(24)
        self.deadline = time.monotonic() + 4

    def fallback(self):
        # Keep retrying if the radio is temporarily unavailable.
        self.phase = "recovering"
        self.deadline = time.monotonic() + 5
        if LAST_AP.exists():
            try:
                nm("connection", "up", "uuid", LAST_AP.read_text().strip(), "ifname", "wlan0")
            except subprocess.CalledProcessError:
                nm("connection", "up", "id", AP, "ifname", "wlan0")
        else:
            nm("connection", "up", "id", AP, "ifname", "wlan0")
        PENDING.unlink(missing_ok=True)
        self.phase = "idle"
        self.ticket = ""

    def tick(self):
        if self.phase == "connected":
            if time.monotonic() >= self.deadline:
                self.deadline = time.monotonic() + 5
                if nm("-g","GENERAL.CONNECTION","device","show","wlan0") != self.target:
                    self.fallback()
            return
        if time.monotonic() < self.deadline:
            return
        if self.phase == "scheduled":
            self.phase = "recovering"
            # Single-radio devices cannot reliably discover stations while serving an AP.
            nm("device", "disconnect", "wlan0")
            nm("-g","SSID","device","wifi","list","ifname","wlan0","--rescan","yes")
            nm("connection", "up", "id", self.target, "ifname", "wlan0")
            self.phase = "trial"
            self.deadline = time.monotonic() + 90
        elif self.phase in ("trial", "recovering"):
            self.fallback()

    def request(self, data):
        action = data.get("action")
        if action == "status":
            return dict(version=1, phase=self.phase, host=socket.gethostname()+".local", ticket=self.ticket)
        if action == "scan":
            names = nm("-e","no","-g","SSID","device","wifi","list","ifname","wlan0","--rescan","auto")
            return dict(ssids=list(dict.fromkeys(filter(None, names.splitlines()))))
        if action == "forget":
            SAVED.unlink(missing_ok=True)
            self.saved = ""
            self.fallback()
            for slot in SLOTS:
                if (PROFILES/(slot+".nmconnection")).exists():
                    nm("connection","delete","id",slot)
            return {}
        if action == "join" and self.phase in ("idle","connected"):
            if self.phase == "idle":
                current = nm("-g","GENERAL.CON-UUID","device","show","wlan0")
                if current and current != "--" and nm("-g","802-11-wireless.mode","connection","show","uuid",current) == "ap":
                    LAST_AP.write_text(str(uuid.UUID(current)))
            slot = next(s for s in SLOTS if s != self.saved)
            profile(slot, data.get("ssid"), data.get("password"))
            self.schedule(slot)
            return self.request({"action":"status"})
        if action == "confirm" and self.phase == "trial" and data.get("ticket") == self.ticket:
            if nm("-g","GENERAL.CONNECTION","device","show","wlan0") != self.target:
                raise ValueError("Phone hotspot is not active")
            tmp = SAVED.with_suffix(".tmp")
            tmp.write_text(self.target)
            tmp.replace(SAVED)
            PENDING.unlink(missing_ok=True)
            self.saved = self.target
            self.phase = "connected"
            self.deadline = time.monotonic()+5
            return {}
        raise ValueError("Unsupported action or invalid transition")


def serve(account):
    os.umask(0o077)
    user = pwd.getpwnam(account)
    network = Network()
    SOCKET.unlink(missing_ok=True)
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(SOCKET))
        os.chown(SOCKET, 0, user.pw_gid)
        SOCKET.chmod(0o660)
        listener.listen(4)
        listener.settimeout(1)
        while True:
            try:
                network.tick()
            except (OSError, subprocess.SubprocessError):
                print("Network transition failed; retrying recovery" if network.phase == "recovering"
                      else "Network status check failed", file=sys.stderr, flush=True)
            try:
                conn, _ = listener.accept()
            except TimeoutError:
                continue
            with conn:
                uid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
                if uid != user.pw_uid:
                    continue
                conn.settimeout(2)
                try:
                    with conn.makefile("rb") as reader:
                        line = reader.readline(2049)
                    if len(line)>2048 or not line.endswith(b"\n"):
                        raise ValueError("Invalid request")
                    result = network.request(json.loads(line))
                except (ValueError, AttributeError, OSError, subprocess.SubprocessError):
                    result = {"error":"Network request failed"}
                try:
                    conn.sendall(json.dumps(result).encode()+b"\n")
                except OSError:
                    pass


if __name__ == "__main__":
    serve(sys.argv[1])
