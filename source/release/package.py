"""Build and verify the fixed application payload for offline updates."""
import base64
import tempfile
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

VERSION = "0.5.2"
FILES = tuple("""server.py editor.py demo.py device_settings.py pi_settings.py
io_settings.py plugin_sync.py utilities.py pitch.py index.html app.js plugin-names.json""".split())
LIMIT = 16 * 1024 * 1024


def openssl(*args):
    subprocess.run([os.environ.get("OPENSSL", "openssl"), *args], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode()


def verify_bytes(data, signature, public):
    with tempfile.TemporaryDirectory() as temp:
        message, sig = Path(temp)/"data", Path(temp)/"sig"
        message.write_bytes(data)
        sig.write_bytes(signature)
        openssl("pkeyutl","-verify","-rawin","-pubin","-inkey",str(public),
                "-sigfile",str(sig),"-in",str(message))


def build(root, out, private, sequence=None, channel="preview"):
    if sequence is None:
        sequence = int(subprocess.check_output(["git","rev-list","--first-parent","--count","HEAD"],cwd=root))
    if type(sequence) is not int or sequence < 1 or channel not in ("preview","stable"):
        raise ValueError("Invalid update sequence or channel")
    if channel == "stable" and VERSION.startswith("0."):
        raise ValueError("Stable releases start at 1.0.0")
    contents = {name: (root / name).read_bytes() for name in FILES}
    manifest = dict(format=1, product="cortex-remote", version=VERSION,sequence=sequence,channel=channel,
                    files={k: hashlib.sha256(v).hexdigest() for k,v in contents.items()})
    contents["manifest.json"] = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    signing_key = load_pem_private_key(private.read_bytes(), password=None)
    contents["manifest.sig"] = signing_key.sign(contents["manifest.json"])
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as z:
        for name, value in sorted(contents.items()):
            info = zipfile.ZipInfo(name)
            z.writestr(info, value, compress_type=zipfile.ZIP_DEFLATED)


def unpack(archive, target, public, channel="preview"):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        allowed = {*FILES,"manifest.json","manifest.sig"}
        if (len(entries) != len(allowed) or {i.filename for i in entries} != allowed
                or sum(i.file_size for i in entries) > LIMIT or z.getinfo("manifest.json").file_size > 8192):
            raise ValueError("업데이트 ZIP 구성이 올바르지 않습니다.")
        for name in ("manifest.json","manifest.sig"):
            (target/name).write_bytes(z.read(name))
        openssl("pkeyutl","-verify","-rawin","-pubin","-inkey",str(public),
                "-sigfile",str(target/"manifest.sig"),"-in",str(target/"manifest.json"))
        manifest = json.loads((target/"manifest.json").read_bytes())
        if (manifest.get("channel") != channel or type(manifest.get("sequence")) is not int or manifest["sequence"] < 1 or
                manifest["product"] != "cortex-remote" or manifest["format"] != 1 or
                not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+",manifest["version"]) or set(manifest["files"]) != set(FILES)):
            raise ValueError("호환되지 않는 업데이트입니다.")
        for name in FILES:
            payload = z.read(name)
            if hashlib.sha256(payload).hexdigest() != manifest["files"][name]:
                raise ValueError("업데이트 파일이 손상되었습니다.")
            (target/name).write_bytes(payload)
    return hashlib.sha256((target/"manifest.json").read_bytes()).hexdigest()


def sign_metadata(archive, private, build_id):
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    with zipfile.ZipFile(archive) as z:
        raw = z.read("manifest.json")
        manifest = json.loads(raw)
    meta = {k:manifest[k] for k in ("version","channel","sequence")}
    meta.update(build=build_id,manifest=hashlib.sha256(raw).hexdigest(),
                sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
    signer = load_pem_private_key(private.read_bytes(),password=None)
    meta["signature"] = base64.b64encode(signer.sign(canonical(meta))).decode("ascii")
    return meta


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python release/package.py PRIVATE.pem OUTPUT.zip")
    build(Path(__file__).resolve().parents[1], Path(sys.argv[2]), Path(sys.argv[1]), channel=os.getenv("QC_CHANNEL","preview"))
