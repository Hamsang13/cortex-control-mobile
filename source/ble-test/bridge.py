"""Temporary BlueZ peripheral for the standalone Cortex Remote web experiment."""
import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.request
from pathlib import Path
from remote_rpc import RemoteRPC
from urllib.parse import urlsplit

from dbus_next import BusType, DBusError, Variant
from dbus_next.aio import MessageBus
from dbus_next.constants import PropertyAccess
from dbus_next.service import ServiceInterface, dbus_property, method

ROOT = "/net/cortexremote/test"
SERVICE = ROOT + "/service0"
UUID = "c0de0001-9b67-47bf-8924-21400b9b8a72"
READ = PropertyAccess.READ


class Service(ServiceInterface):
    def __init__(self):
        super().__init__("org.bluez.GattService1")

    @dbus_property(access=READ)
    def UUID(self) -> 's':
        return UUID

    @dbus_property(access=READ)
    def Primary(self) -> 'b':
        return True


class Control(ServiceInterface):
    def __init__(self, config):
        super().__init__("org.bluez.GattCharacteristic1")
        self.key = config["key"].encode()
        self.base = "http://127.0.0.1:" + str(urlsplit(config["url"]).port)
        self.peers = {}

    @dbus_property(access=READ)
    def UUID(self) -> 's':
        return UUID.replace("0001-", "0002-")

    @dbus_property(access=READ)
    def Service(self) -> 'o':
        return SERVICE

    @dbus_property(access=READ)
    def Flags(self) -> 'as':
        return ["read", "write"]

    @method()
    def ReadValue(self, options: 'a{sv}') -> 'ay':
        peer = options["device"].value
        now = time.monotonic()
        self.peers = {k:v for k,v in self.peers.items() if v[0] > now}
        state = self.peers.pop(peer, None)
        if state and state[1].startswith(b"R"):
            return state[1]
        frame = b"C" + secrets.token_bytes(16)
        self.peers[peer] = (now+30, frame)
        return frame

    def execute(self, op):
        action, body = ("update-status", {}) if op == 0 else ("scene", {"target":op-1})
        req = urllib.request.Request(self.base+"/api/"+action,json.dumps(body).encode(),
                                     {"X-QC-Key":self.key.decode()})
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.load(response)
        if op and data.get("scene") != op-1:
            raise ValueError("Scene not confirmed")

    @method()
    async def WriteValue(self, value: 'ay', options: 'a{sv}'):
        peer = options["device"].value
        state = self.peers.pop(peer,None)
        if not state or state[0] < time.monotonic() or state[1][:1]!=b"C" or len(value)!=17:
            raise DBusError("org.bluez.Error.NotAuthorized","Challenge required")
        op = value[0]
        msg = state[1]+bytes([op])
        tag = hmac.digest(self.key,msg,hashlib.sha256)[:16]
        if op>8 or not hmac.compare_digest(tag,value[1:]):
            raise DBusError("org.bluez.Error.NotAuthorized","Invalid command or key")
        code = 0
        try:
            await asyncio.to_thread(self.execute,op)
        except (OSError,ValueError):
            code = 1
        result = b"R"+bytes([op,code])
        self.peers[peer]=(time.monotonic()+30,result+hmac.digest(self.key,msg+result,"sha256")[:16])


class RemoteCharacteristic(Control):
    def __init__(self, config):
        super().__init__(config)
        self.rpc = RemoteRPC(config, self.base)

    @dbus_property(access=READ)
    def UUID(self) -> 's':
        return UUID.replace("0001-", "0003-")

    @method()
    def ReadValue(self, options: 'a{sv}') -> 'ay':
        try:
            value = self.rpc.read(options["device"].value)
            offset = options.get("offset")
            return value[offset.value if offset else 0:]
        except KeyError:
            raise DBusError("org.bluez.Error.Failed", "Start a request")

    @method()
    async def WriteValue(self, value: 'ay', options: 'a{sv}'):
        try:
            self.rpc.write(options["device"].value, bytes(value))
        except Exception:
            raise DBusError("org.bluez.Error.Failed", "Invalid key or transfer")


class Advertisement(ServiceInterface):
    def __init__(self):
        super().__init__("org.bluez.LEAdvertisement1")

    @dbus_property(access=READ)
    def Type(self) -> 's':
        return "peripheral"

    @dbus_property(access=READ)
    def ServiceUUIDs(self) -> 'as':
        return [UUID]

    @dbus_property(access=READ)
    def LocalName(self) -> 's':
        return "Cortex Remote"

    @method()
    def Release(self):
        pass


async def main():
    config=json.loads(Path(os.environ["QC_PI_CONFIG"]).read_text())
    bus=await MessageBus(bus_type=BusType.SYSTEM).connect()
    adapter="/org/bluez/hci0"
    proxy=bus.get_proxy_object("org.bluez",adapter,await bus.introspect("org.bluez",adapter))
    bus.export(SERVICE,Service())
    bus.export(SERVICE+"/control",Control(config))
    bus.export(SERVICE+"/remote",RemoteCharacteristic(config))
    advert="/net/cortexremote/advert"
    bus.export(advert,Advertisement())
    await proxy.get_interface("org.bluez.GattManager1").call_register_application(ROOT,{})
    await proxy.get_interface("org.bluez.LEAdvertisingManager1").call_register_advertisement(advert,{})
    print("Cortex Remote BLE test ready",flush=True)
    await bus.wait_for_disconnect()


if __name__=="__main__":
    asyncio.run(main())
