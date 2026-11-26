"""Local GATT stand-in using the actual bridge transport and demo HTTP handler."""
import asyncio
import contextlib
import json
from pathlib import Path
import sys
from threading import Thread

from remote_rpc import RemoteRPC

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.argv.append("--demo")
import server


async def main():
    server.TOKEN = "local-fixture"
    http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    Thread(target=http.serve_forever, daemon=True).start()
    rpc = RemoteRPC({"key":server.TOKEN}, f"http://127.0.0.1:{http.server_port}")
    stdout = sys.stdout
    with contextlib.redirect_stdout(sys.stderr):
        while line := await asyncio.to_thread(sys.stdin.readline):
            try:
                packet = json.loads(line)
                if packet is None:
                    result = list(rpc.read("ipad"))
                else:
                    rpc.write("ipad", bytes(packet))
                    result = True
                print(json.dumps(result), file=stdout, flush=True)
            except Exception as error:
                print(json.dumps({"error":type(error).__name__}), file=stdout, flush=True)
    http.shutdown()


asyncio.run(main())
