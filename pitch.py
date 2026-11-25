"""Read the Quad Cortex tuner meter over the existing HID connection."""
import math
from contextlib import ExitStack
import re
import threading
import time
from threading import Lock, Timer
from time import monotonic


class TunerMeter:
    def __init__(self, client):
        from pyquadcortex.client import pa

        self.client = client
        self.transport = client._t
        self.pa = pa
        self.lock = Lock()
        self.users = {}
        self.mode = "off"
        self.timer = None
        self.closed = False

    def _sync(self):
        modes = [mode for mode, _ in self.users.values()]
        mode = "panel" if "panel" in modes else "footer" if modes else "off"
        if mode == self.mode:
            return
        # Cortex Control sends ShowTuner, then the independent meter switch.
        # Footer-only pitch must not engage the panel's mute-while-tuning mode.
        pa, t = self.pa, self.transport
        self.mode = None
        t.send(pa.ShowTunerMessage(action=pa.MessageAction.UPDATE,
                                   request_id=t.next_request_id(), show=mode == "panel"))
        t.send(pa.TunerMessage(action=pa.MessageAction.UPDATE,
                               request_id=t.next_request_id(), enable_meter=mode != "off"))
        if mode != "off":
            t.send(pa.TunerMessage(action=pa.MessageAction.READ))
        self.mode = mode

    def _schedule(self):
        if self.timer is None and self.users:
            wait = max(.05, min(end for _, end in self.users.values()) - monotonic())
            self.timer = Timer(wait, self._expire)
            self.timer.daemon = True
            self.timer.start()

    def _expire(self):
        with self.lock:
            self.timer = None
            if self.closed:
                return
            now = monotonic()
            self.users = {k: v for k, v in self.users.items() if v[1] > now}
            try:
                self._sync()
            finally:
                self._schedule()

    def stop(self, owner):
        with self.lock:
            if not self.closed:
                self.users.pop(owner, None)
                self._sync()

    def set_control(self, owner, field, value):
        if field == "input_port_id" and (type(value) != int or value not in (1, 2, 3, 4, 5, 8, 9)):
            raise ValueError("Invalid tuner input")
        if field == "mute" and type(value) != bool:
            raise ValueError("Invalid tuner mute")
        if field not in ("input_port_id", "mute"):
            raise ValueError("Unknown tuner control")
        with self.lock:
            if self.closed or self.users.get(owner, (None,))[0] != "panel":
                raise ValueError("튜너를 연 상태에서 설정을 변경하세요.")
            self.transport.send(self.pa.TunerMessage(
                action=self.pa.MessageAction.UPDATE,
                request_id=self.transport.next_request_id(), **{field: value}))
            actual = self.client.tuner(timeout=1)
            if getattr(actual, field) != value:
                raise ValueError("본체에서 튜너 설정 변경을 확인하지 못했습니다.")
            return dict(input=actual.input_port_id, reference=440 + actual.frequency, mute=actual.mute)

    def close(self):
        with self.lock:
            self.closed = True
            if self.timer:
                self.timer.cancel()
            self.users.clear()
            self._sync()

    def read(self, owner, mode):
        if mode not in ("panel", "footer"):
            raise ValueError("Invalid tuner mode")
        with self.lock:
            if self.closed:
                return {"hz": None}
            self.users[owner] = (mode, monotonic() + 2)
            self._schedule()
            self._sync()
        try:
            msg = self.transport.await_broadcast(
                self.pa.TunerMessage, lambda: None, timeout=.20,
                match=lambda m: m.HasField("meter"),
            )
        except TimeoutError:
            return {"hz": None}
        hz = msg.meter
        return {"hz": hz if math.isfinite(hz) and hz > 0 else None}


lock = Lock()
worker = None
meter_until = 0
levels = {}


def endpoints(sd, channels):
    devices = [(i, d) for i, d in enumerate(sd.query_devices())
               if "quad cortex" in d["name"].lower() and d["max_input_channels"] > 0]
    multichannel = next(((i, d) for i, d in devices if d["max_input_channels"] >= 8), None)
    if multichannel:
        i, device = multichannel
        return [(i, device, range(8))]
    result = []
    for start in range(0, 8, 2):
        if not channels.intersection((start, start + 1)):
            continue
        pair = rf"\(\s*{start + 1}\s*\+\s*{start + 2}\s*\)"
        match = next(((i, d) for i, d in devices if d["max_input_channels"] >= 2
                      and re.search(pair, d["name"])), None)
        if match:
            i, device = match
            result.append((i, device, range(start, start + 2)))
    return result


def capture(channels):
    import numpy as np

    def callback(frames, count, timing, status):
        now = time.monotonic()
        peaks = np.max(np.abs(frames), axis=0)
        with lock:
            for channel, peak in zip(channels, peaks):
                peak = float(peak)
                db = max(-60, min(0, 20 * math.log10(max(peak, .001))))
                previous, clipped, updated = levels.get(channel, (-60, 0, now))
                levels[channel] = (max(db, previous - 75 * (now - updated)),
                                   now + .8 if peak >= .9999 else clipped, now)

    return callback


def listen():
    global worker
    try:
        import sounddevice as sd
        with ExitStack() as streams:
            for i, device, channels in endpoints(sd, set(range(4))):
                rate = int(device["default_samplerate"])
                try:
                    streams.enter_context(sd.InputStream(device=i, samplerate=rate,
                        channels=len(channels), dtype="float32", blocksize=1024,
                        callback=capture(channels)))
                except sd.PortAudioError:
                    continue
            while time.monotonic() < meter_until:
                time.sleep(.1)
    finally:
        with lock:
            levels.clear()
            worker = None


def read_meters():
    global meter_until, worker
    with lock:
        now = time.monotonic()
        meter_until = now + .75
        if worker is None:
            worker = threading.Thread(target=listen, daemon=True)
            worker.start()
        return {"channels": [
            {"db": round(db, 1), "clip": clip > now}
            if now - updated < .35 else None
            for db, clip, updated in (levels.get(i, (-60, 0, -math.inf)) for i in range(4))
        ]}
