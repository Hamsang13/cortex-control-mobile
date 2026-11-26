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
            public = root/"update-public.pem"
            public.write_bytes(private.public_key().public_bytes(serialization.Encoding.PEM,
                                                                  serialization.PublicFormat.SubjectPublicKeyInfo))
            archive = root/"update.zip"
            package.build(ROOT, archive, key, sequence=10)
            blob = archive.read_bytes()
            with zipfile.ZipFile(archive) as z:
                manifest = hashlib.sha256(z.read("manifest.json")).hexdigest()
            info = package.sign_metadata(archive,key,"1"*40)
            def upload(stream, length, expected):
                self.assertEqual(length, len(blob))
                self.assertEqual(expected["manifest"],manifest)
                self.assertEqual(package.unpack(stream, root, public), manifest)
                return {"ticket":"test"}

            current = {"active":"base","sequence":10}
            updater = SimpleNamespace(state=lambda:current, upload=upload, RUNTIME=root,
                                      policy=lambda:dict(channel="preview",baseSequence=1))
            with patch.dict(sys.modules, updater=updater), patch("urllib.request.urlopen") as get:
                get.side_effect = lambda url, timeout: io.BytesIO(json.dumps(info).encode() if url.endswith(".json") else blob)
                self.assertFalse(online_update()["available"])
                current["sequence"] = 9
                self.assertTrue(online_update()["available"])
                with self.assertRaises(ValueError):
                    online_update("2"*40, True)
                self.assertEqual(online_update(info["build"], True), {"ticket":"test"})
                info["sequence"] = 11
                with self.assertRaises(ValueError): online_update()
                info["sequence"] = 10
                blob = blob[:-1]
                with self.assertRaises(ValueError):
                    online_update(info["build"], True)
                get.side_effect = urllib.error.URLError("offline")
                with self.assertRaises(ValueError):
                    online_update()


    @unittest.skipIf(sys.platform=="win32","supervisor uses Linux file locks")
    def test_offline_floor(self):
        import os
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, QC_DATA_DIR=folder):
            import updater
            root=Path(folder)
            key=root/"private"
            signer=Ed25519PrivateKey.generate()
            key.write_bytes(signer.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
            (root/"update-public.pem").write_bytes(signer.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))
            (root/"policy.json").write_text('{"channel":"preview","baseSequence":8}')
            store=root/"updates"
            with patch.multiple(updater,RUNTIME=root,STORE=store,STATE=store/"state.json"):
                for sequence in (7,8,9):
                    archive=root/"update.zip"
                    package.build(ROOT,archive,key,sequence)
                    buf=archive.read_bytes()
                    if sequence<9:
                        with self.assertRaises(ValueError): updater.upload(io.BytesIO(buf),len(buf))
                    else:
                        updater.upload(io.BytesIO(buf),len(buf))
                        self.assertEqual(updater.state()["targetSequence"],9)
                        updater.record(dict(status="applied",active="test",sequence=9))
                        with self.assertRaises(ValueError): updater.upload(io.BytesIO(buf),len(buf))
                (root/"policy.json").write_text('{"channel":"stable","baseSequence":0}')
                with self.assertRaises(ValueError): updater.upload(io.BytesIO(buf),len(buf))


if __name__ == "__main__":
    unittest.main()
