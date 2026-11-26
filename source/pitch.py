"""Read the Quad Cortex tuner meter over the existing HID connection."""
import math
from threading import Lock, Timer
from time import monotonic


def subscribe_gate_meters(client, enabled):
    from pyquadcortex.client import pa

    transport = client._t
    transport.send(pa.IOMeterMessage(request_id=transport.next_request_id(),
        **({} if enabled else {"action":pa.MessageAction.DELETE})))
    if enabled:
        transport.send(pa.IOSettingsMessage(action=pa.MessageAction.READ, request_id=transport.next_request_id()))
        for row in range(4):
            transport.send(pa.GridModelMeterMessage(
                request_id=transport.next_request_id(), row=row, column=-1))
    else:
        transport.send(pa.GridModelMeterMessage(action=pa.MessageAction.DELETE,
            request_id=transport.next_request_id(), row=-1, column=-1))


class LiveMeterFrames:
    """Keep the latest timestamped meter values without blocking USB edit requests."""
    def __init__(self, client):
        from pyquadcortex.client import pa
        self.transport = client._t
        self.lock = Lock()
        self.last_subscription = monotonic()
        self.gates = {}
        self.io = {}
        self.plugged = {}
        self.entries = [(pa.GridMessage, lambda m: m.HasField("update_type") and
                         m.update_type == pa.GridMessage.METER_UPDATE, self),
                        (pa.IOMeterMessage, None, self), (pa.IOSettingsMessage, None, self)]
        with self.transport._lock:
            self.transport._collectors.extend(self.entries)

    def append(self, msg):
        from pyquadcortex.client import pa
        stamp = monotonic()
        with self.lock:
            if isinstance(msg, pa.IOSettingsMessage):
                for ports, field, channels in (
                    (msg.settings.in_port, "input_port_id", {1:"input_1", 2:"input_2"}),
                    (msg.settings.out_port, "output_port_id", {4:"xlr_1", 5:"xlr_2", 6:"out_3", 7:"out_4"}),
                ):
                    for port in ports:
                        channel = channels.get(getattr(port, field))
                        if channel and port.HasField("plugged"):
                            self.plugged[channel] = bool(port.plugged)
            elif isinstance(msg, pa.IOMeterMessage):
                for field, value in msg.ListFields():
                    if field.name not in ("action", "request_id"):
                        self.io[field.name] = (stamp, value)
            else:
                for chain in msg.preset.chains:
                    for model in chain.input_control:
                        for param in model.params:
                            if param.index == 2 and param.param_values:
                                value = param.param_values[0]
                                if value.HasField("float_value") and 0 <= value.float_value <= 1:
                                    self.gates[chain.row] = (stamp, value.float_value)

    def needs_subscription(self):
        now = monotonic()
        with self.lock:
            if now - self.last_subscription < 4:
                return False
            last_gate = max((stamp for stamp, value in self.gates.values()), default=0)
            last_io = max((stamp for stamp, value in self.io.values()), default=0)
            if min(last_gate, last_io) >= now - 3:
                return False
            self.last_subscription = now
            return True

    def snapshot(self):
        cutoff = monotonic() - .5
        with self.lock:
            return {"plugged": dict(self.plugged), **{name: {k:v for k,(stamp,v) in source.items() if name == "io" or stamp >= cutoff}
                    for name, source in (("gates", self.gates), ("io", self.io))}}

    def close(self):
        with self.transport._lock:
            for entry in self.entries:
                self.transport._collectors.remove(entry)


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
