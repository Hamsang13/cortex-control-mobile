"""Encrypted, paged transport for the existing local JSON API."""
import asyncio
import gzip
import hashlib
import json
import re
import secrets
import time
import urllib.error
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class RemoteRPC:
    def __init__(self, config, base):
        self.key = config["key"]
        self.base = base
        self.cipher = AESGCM(hashlib.sha256(self.key.encode()).digest())
        self.peers = {}

    def call(self, request):
        action, data = request["action"], request["body"]
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,48}", action) or not isinstance(data, dict) or action == "update-zip":
            raise ValueError("Invalid JSON API request")
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
        req = urllib.request.Request(self.base + "/api/" + action, body,
                                     {"X-QC-Key": self.key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            raise ValueError(json.load(exc).get("error", str(exc))) from exc

    async def finish(self, state, request):
        try:
            data = await asyncio.to_thread(self.call, request)
            result = b"O" + data
        except Exception as exc:
            result = b"E" + str(exc).encode()
        if request.get("gzip") and len(result) > 512:
            result = b"Z" + gzip.compress(result, compresslevel=1)
        state["reply"] = self.cipher.encrypt(bytes([state["nonce"][0] | 128]) + state["nonce"][1:], result, b"remote-reply")
        state["seen"] = time.monotonic()

    def write(self, peer, packet):
        now = time.monotonic()
        self.peers = {k: s for k,s in self.peers.items() if now-s["seen"] < 180}
        if packet == b"N":
            if len(self.peers) >= 16 and peer not in self.peers:
                raise ValueError("Busy")
            self.peers[peer] = dict(nonce=bytes([secrets.randbelow(128)]) + secrets.token_bytes(11), buf=bytearray(), seen=now)
            return
        state = self.peers[peer]
        state["seen"] = now
        if packet[:1] == b"D" and "buf" in state and len(state["buf"])+len(packet)-1 <= 4096:
            state["buf"].extend(packet[1:])
        elif packet == b"X" and "buf" in state:
            raw = self.cipher.decrypt(state["nonce"], bytes(state.pop("buf")), b"remote-request")
            request = json.loads(raw)
            state["offset"] = 0
            state["task"] = asyncio.create_task(self.finish(state, request))
        elif len(packet) == 5 and packet[:1] == b"P" and "reply" in state:
            state["offset"] = int.from_bytes(packet[1:], "big")
        else:
            raise ValueError("Invalid transfer")

    def read(self, peer):
        state = self.peers[peer]
        state["seen"] = time.monotonic()
        if "buf" in state:
            return b"C" + state["nonce"]
        if "reply" not in state:
            return b"W"
        reply = state["reply"]
        offset = state["offset"]
        return b"R" + len(reply).to_bytes(4,"big") + reply[offset:offset+507]
