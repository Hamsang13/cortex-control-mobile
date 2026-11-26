"""Exercise the GitHub channel against a locally signed package without publishing."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import package

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pi_settings import online_update


class ChannelTest(unittest.TestCase):
    def test_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            private = Ed25519PrivateKey.generate()
            key = root/"key"
            key.write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                  serialization.NoEncryption()))
            public = root/"public"
            public.write_bytes(private.public_key().public_bytes(serialization.Encoding.PEM,
                                                                  serialization.PublicFormat.SubjectPublicKeyInfo))
            archive = root/"update.zip"
            package.build(ROOT, archive, key)
            blob = archive.read_bytes()
            with zipfile.ZipFile(archive) as z:
                manifest = hashlib.sha256(z.read("manifest.json")).hexdigest()
            info = dict(build="1"*40, version=package.VERSION, manifest=manifest, sha256=hashlib.sha256(blob).hexdigest())
            def upload(stream, length):
                self.assertEqual(length, len(blob))
                self.assertEqual(package.unpack(stream, root, public), manifest)
                return {"ticket":"test"}

            current = {"active":"base"}
            updater = SimpleNamespace(state=lambda:current, upload=upload)
            with patch.dict(sys.modules, updater=updater), patch("urllib.request.urlopen") as get:
                get.side_effect = lambda url, timeout: io.BytesIO(json.dumps(info).encode() if url.endswith(".json") else blob)
                self.assertFalse(online_update()["available"])
                current["active"] = "old"
                self.assertTrue(online_update()["available"])
                with self.assertRaises(ValueError):
                    online_update("2"*40, True)
                self.assertEqual(online_update(info["build"], True), {"ticket":"test"})
                blob = blob[:-1]
                with self.assertRaises(ValueError):
                    online_update(info["build"], True)
                get.side_effect = urllib.error.URLError("offline")
                with self.assertRaisesRegex(ValueError, "GitHub"):
                    online_update()


if __name__ == "__main__":
    unittest.main()
