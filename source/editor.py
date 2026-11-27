"""Serialize device state and apply guarded editor operations on the USB worker."""

from utilities import tempo_values, utility_request

import hashlib
import json
import math
from queue import Empty, SimpleQueue
from time import monotonic as clock_seconds
import xml.etree.ElementTree as ET


def revision(state):
    raw = json.dumps(state, sort_keys=True, allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()[:24]


def integer(data, key, low, high):
    value = data.get(key)
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"Invalid {key}")
    return value


def scene_change(action, data):
    source = integer(data, "source", 0, 7)
    if action == "scene-style":
        label, color = data.get("label"), data.get("color")
        if label is not None and (not isinstance(label, str) or any(ord(c) < 32 for c in label)):
            raise ValueError("Invalid scene label")
        if color is not None and (not isinstance(color, str) or len(color) != 7 or color[0] != "#" or
                                  any(c not in "0123456789abcdef" for c in color[1:])):
            raise ValueError("Invalid scene color")
        return source, label, color
    target = integer(data, "target", 0, 7)
    swap = data.get("swap")
    if source == target or type(swap) is not bool:
        raise ValueError("Invalid scene destination")
    return source, target, swap


def scene_values(grid):
    for block in grid["blocks"]:
        if block["bypassAssigned"]:
            yield block["bypass"]
        for param in block["params"]:
            if param["assigned"]:
                yield param["values"]
    for lane in grid["lanes"]:
        for key in ("mute", "gate"):
            if len(lane.get(key, [])) == 8:
                yield lane[key]
        for params in lane["controls"].values():
            for param in params:
                if param["assigned"]:
                    yield param["values"]
    yield from (values for values in grid["tempo"] if len(values) == 8)


def lane_flags(models, model_id, index, invert=False):
    model = next((m for m in models if m.hash == model_id), None)
    if not model or index >= len(model.params):
        return []
    param = model.params[index]
    flags = [(v.float_value >= .5) != invert for v in param.param_values]
    return flags if param.scene_mode else flags[:1]


def expand_cabinet_models(root):
    from copy import deepcopy
    models = {m.get("id"): m for m in root.findall("Category/Model")}
    for model in models.values():
        base = models.get(model.get("clones"))
        if base is None or not any(p.get("name") == "ir selector" for p in base.findall("Parameter")):
            continue
        controls = [deepcopy(p) for p in base.findall("Parameter")]
        for control in controls:
            if control.get("name") == "ir selector":
                control.set("cabBase", base.get("id"))
        for override in model.findall("Parameter"):
            index = override.get("replaces")
            if index is None:
                controls.append(override)
            else:
                controls[int(index)].attrib.update(override.attrib)
            model.remove(override)
        model.extend(controls)


def model_params(block, model, metadata):
    params = []
    for spec in model.parameters if model else ():
        if spec.name == "ir selector" and spec.index < len(block.params):
            mic = block.params[spec.index]
            raw = [v.string_value for v in mic.param_values]
            if raw and raw[0]:
                spec_ui = metadata.get((model.id, spec.index), {})
                prefix = (spec_ui.get("defaultValue") or raw[0]).rpartition("_")[0]
                choices = list(mic.dynamic_steps)
                if not choices and prefix and spec_ui.get("cabBase") in ("12000", "32000"):
                    choices = [prefix + "_" + name for name in (
                        "Ribbon 160", "Ribbon 10", "Dynamic 57", "Dynamic 421", "Condenser 414", "Condenser 184"
                    )]
                if not choices:
                    for index in (1, 9):
                        default = metadata.get((model.id, index), {}).get("defaultValue")
                        if default:
                            choices.append(default)
                        if index < len(block.params):
                            choices.extend(v.string_value for v in block.params[index].param_values if v.string_value)
                choices = list(dict.fromkeys(choices + [v for v in raw if v]))
                params.append(dict(index=spec.index, pos=spec.index, name="MIC "+str(1 if spec.index==1 else 2),
                    type="comboBox", options=[v.rsplit("_",1)[-1] for v in choices], textOptions=choices,
                    values=[choices.index(v)/max(1,len(choices)-1) if v in choices else None for v in raw],
                    assigned=mic.scene_mode, steps=len(choices)))
            continue
        if spec.type not in (
            "float",
            "switch",
            "rotarySwitch",
            "comboBox",
            "toggleButton",
        ) or spec.index >= len(block.params):
            continue
        ui = metadata.get((model.id, spec.index), {})
        if ui.get("hidden", "false").lower() == "true":
            continue
        param = block.params[spec.index]
        values = [
            v
            if isinstance(v, float) and math.isfinite(v) and 0 <= v <= 1
            else None
            for v in (x.float_value if x.HasField("float_value") else None for x in param.param_values)
        ]
        if not values or values[0] is None:
            continue
        options = list(block.params[spec.index].dynamic_steps)
        if not options and ui.get("stepNames"):
            options = [x.strip() for x in ui["stepNames"].split(",")]
        skew = ui.get("skew", "LIN_SKEW")
        try:
            exponent = 1 / float(skew) if skew != "LIN_SKEW" else 1
        except (ValueError, ZeroDivisionError):
            exponent = None
        params.append(
            dict(
                index=spec.index,
                name=(("MIC 1 · " if spec.index < 8 else "MIC 2 · ") + spec.name.upper()
                      if model.category_id in (12, 21, 32, 33) and spec.index < 16 else spec.name),
                type=spec.type,
                values=values,
                assigned=param.scene_mode,
                expression=param.expression, expressionMin=param.expression_min, expressionMax=param.expression_max,
                min=spec.minimum,
                max=spec.maximum,
                unit=spec.units,
                normalized=spec.range_is_placeholder or exponent is None,
                exponent=exponent,
                integer=ui.get("showAsInteger") == "true",
                pos=int(ui.get("displayPos", spec.index)),
                toggleOn=ui.get("toggleOn"),
                toggleOff=ui.get("toggleOff"),
                options=options,
                steps=len(options) or spec.option_count,
            )
        )
    if model and model.category_id in (12, 21, 32, 33):
        return sorted(params, key=lambda p: p["index"])
    return sorted(params, key=lambda p: p["pos"])


ROUTE_MODELS = {
    "input": ("input_control", 28000, "set_input_gate"),
    "output": ("output_control", 23000, "set_lane_output"),
    "start": ("combined_splitter", 10004, "set_splitter_param"),
    "end": ("mixer", 11000, "set_mixer_param"),
}


def route_params(chain, qc, metadata):
    result = {}
    for part, (field, mid, _) in ROUTE_MODELS.items():
        block = next((m for m in getattr(chain, field) if m.hash == mid), None)
        if block is None:
            continue
        params = model_params(block, qc.catalog[mid], metadata)
        for param in params:
            param["pan"] = param["name"].startswith("PAN")
            if part == "start" and param["name"] == "FREQUENCY":
                param.update(min=20, max=20000, normalized=False, integer=True)
            if param["name"].startswith("LEVEL") or param["name"] in ("MIXER LEVEL", "VOLUME"):
                param.update(min=-40, max=12, exponent=1, unit="dB", normalized=False, level=True)
        result[part] = [p for p in params if p["name"] != "SPLIT MODE"]
    return result


def read_grid(api, qc, metadata, preset=None):
    if preset is None:
        preset = qc.read_current_preset()
    blocks = []
    stomps = {(a.row, a.column): a.footswitch for a in api.stomp_assignments(preset)}
    lanes = []
    for row, chain in enumerate(preset.chains):
        lanes.append(dict(
            input=chain.in_portid, output=chain.out_portid,
            controls=route_params(chain, qc, metadata),
            gate=lane_flags(chain.input_control, qc.INPUT_GATE_CONTROL, 1, invert=True),
            mute=lane_flags(chain.output_control, qc.LANE_OUTPUT_CONTROL, 2),
        ))
        for col, block in enumerate(chain.models):
            if not block.hash:
                continue
            model = qc.catalog.get(block.hash)
            params = model_params(block, model, metadata)
            bypass = api.bypass_state(preset, row, col)
            capture_name = ""
            capture_key = ""
            if model and model.category_id == 14:
                for spec in model.parameters:
                    if spec.name == "file_name" and spec.index < len(block.params):
                        values = api.param_state(preset, row, col, spec.index).values
                        if values and isinstance(values[0], str):
                            capture_key, capture_name = values[0][:64], values[0][64:]
            be = next(iter(block.bypass_expression), None)
            info = next(iter(block.expression_bypass_info), None)
            expression_bypass = dict(pedal=be.expression if be else 0, mode=info.type if info else 0,
                                     invert=bool(info and info.invert), delay=info.delay_ms if info else 0,
                                     latch=bool(info and info.latch_emulation))
            blocks.append(
                dict(
                    row=row,
                    col=col,
                    model=block.hash,
                    name=capture_name or (model.name if model else str(block.hash)),
                    capture=capture_key,
                    category=model.category if model else "Other",
                    expressionBypass=expression_bypass,
                    stomp=stomps.get((row,col)),
                    momentary=(row,col) in stomps and bool(preset.stomp_is_momentary.get(stomps[row,col], False)),
                    params=params,
                    bypassAssigned=bypass.scene_mode,
                    bypass=list(bypass.scenes),
                )
            )
    return dict(
        tempo=tempo_values(preset),
        name=preset.name,
        identity=str(preset.hash),
        sceneInfo=[
            dict(
                label=preset.scene_labels[i].strip()
                if i < len(preset.scene_labels)
                else "",
                color=f"#{preset.scene_colors[i] & 0xFFFFFF:06x}"
                if i < len(preset.scene_colors) and preset.scene_colors[i]
                else None,
            )
            for i in range(8)
        ],
        defaultScene=int(preset.default_scene),
        blocks=blocks,
        lanes=lanes,
        splits=[
            dict(row=row, start=point.split, end=point.mix)
            for row, chain in enumerate(preset.chains) if row in (0, 2)
            for point in chain.split_control_points if point.split >= 0 or point.mix >= 0
        ],
    )


def capture_layout(folders, pinned=None, recent=None, favorites=None):
    """Build the capture tree using folder keys and capture hashes from File READ."""
    root = "local_nc_root"
    by_key = {folder.key: folder for folder in folders}
    if root not in by_key:
        raise ValueError("본체의 캡처 폴더 목록을 읽지 못했습니다.")
    known = {item.key for item in by_key[root].files}
    tree = []
    parents = [root]
    seen = {root}
    while parents:
        parent = parents.pop()
        for f in folders:
            if f.parent_key != parent or f.key in seen:
                continue
            seen.add(f.key)
            parents.append(f.key)
            tree.append(
                dict(
                    key=f.key,
                    parent=parent,
                    name=f.name,
                    members=[item.key for item in f.files if item.key in known],
                )
            )
    downloads = {
        item.key
        for f in folders
        if f.is_downloads
        for item in f.files
        if item.key in known
    }
    for key, name, members in [
        ("downloads", "Downloads", sorted(downloads)),
        ("recent", "Recent", recent),
        ("favorites", "Favorites", favorites),
    ]:
        tree.append(dict(key=key, parent=root, name=name, members=members))
    return dict(folders=tree, pinned=pinned)


class Editor:
    def __init__(self, api, qc):
        from pyquadcortex.catalog import _extract_xml, parse_model_repo

        self.api, self.qc = api, qc
        # The public catalog omits the display curve, option labels and visibility.
        # Read the unit's repository once for both the UI and the library.
        payload = qc._fetch_model_repo()
        root = ET.fromstring(_extract_xml(payload))
        expand_cabinet_models(root)
        qc._catalog = parse_model_repo(ET.tostring(root, encoding="utf-8"))
        self.metadata = {
            (int(m.get("id")), i): p.attrib
            for m in root.findall("Category/Model")
            if m.get("id")
            for i, p in enumerate(m.findall("Parameter"))
        }
        self.edit_history = {"undo": [], "redo": []}
        self.history_frames = None
        self.grid = None
        self.slots = {}
        self.slots_valid_until = 0
        self.capture_entries = {}
        self.identity_retry_at = 0
        self.device_name = None
        self.device_key = None

    def read_history_frames(self):
        from pyquadcortex.client import pa
        msg = self.qc._t.request(pa.UndoRedoMessage(action=pa.MessageAction.READ), timeout=.7)
        return tuple(msg.undo_frames), tuple(msg.redo_frames)

    def clear_edit_history(self):
        self.edit_history = {"undo": [], "redo": []}
        self.history_frames = None

    def history_available(self, action, rev, frames):
        records = self.edit_history[action]
        return bool(records and self.history_frames == frames and
                    records[-1][1 if action == "undo" else 0] == rev and
                    frames[0 if action == "undo" else 1])

    def snapshot(self, preset=None):
        grid = read_grid(self.api, self.qc, self.metadata, preset)
        if self.grid and self.grid["identity"] != grid["identity"]:
            self.clear_edit_history()
        self.grid = grid
        return self.view()

    def view(self):
        self.read_device_identity()
        return dict(
            deviceName=self.device_name,
            **self.grid,
            rev=revision(self.grid),
            scene=int(self.qc.active_scene()),
            dirty=self.qc.preset_dirty(),
        )

    def cached_presets(self):
        if clock_seconds() < self.slots_valid_until:
            return [dict(slot=i, name=n) for i, n in self.slots.items()]
        return None

    def captures(self):
        entries = self.qc.captures()
        self.capture_entries = {e.key: e for e in entries}
        return [
            dict(
                capture=e.key,
                name=e.name,
                model=14001 if e.version == 2 else 14000,
                category="Neural Capture",
                author=e.author,
                version=e.version,
                device=e.device,
                instrument=e.instrument,
                gain=e.gain,
                date=e.date_ms_since_epoch,
            )
            for e in entries
        ]

    def read_capture_layout(self):
        from pyquadcortex.client import pa

        q = self.qc
        messages = q._t.collect(
            pa.FileMessage,
            lambda: q._t.send(pa.FileMessage(action=pa.MessageAction.READ)),
            18,
            match=lambda m: bool(m.folder.key),
        )
        folders = {m.folder.key: m.folder for m in messages}
        if q.CAPTURES_LIBRARY not in folders:
            raise ValueError("캡처 폴더 조회에 실패했습니다. 다시 시도하세요.")
        entries = folders[q.CAPTURES_LIBRARY].files

        def membership(reader):
            try:
                items = reader()
            except TimeoutError:
                return None
            paths = {
                f.key
                for f in folders.values()
                if any(e.key in self.capture_entries for e in f.files)
            }
            names = {x.name for x in items if x.folder_key in paths}
            return [e.key for e in entries if e.name in names or e.key in names]

        try:
            p = q._read_state(pa.PinnedModelsMessage, lambda m: True, 2)
            pinned = list(p.captures)
        except TimeoutError:
            pinned = None
        self.capture_entries = {e.key: e for e in entries}
        return capture_layout(
            list(folders.values()),
            pinned,
            membership(lambda: q.recents(timeout=2)),
            membership(lambda: q.favorites(timeout=2, attempts=1)),
        )

    def read_device_identity(self):
        if self.device_name or clock_seconds() < self.identity_retry_at:
            return
        from plugin_sync import device_key
        self.identity_retry_at = clock_seconds() + 5
        try:
            version = self.qc.version(timeout=1)
        except TimeoutError:
            return
        if version.HasField("custom_name") or version.device_serial_number:
            self.device_name = version.custom_name.strip() or "Quad Cortex"
            self.device_key = device_key(version.device_serial_number)

    def library(self):
        self.read_device_identity()
        return dict(
            deviceName=self.device_name or "Quad Cortex",
            deviceKey=self.device_key,
            models=[
                dict(
                    model=m.id,
                    name=m.name,
                    category=m.category,
                    plugin=m.plugin_id or None,
                )
                for m in self.qc.catalog
                if not m.hidden and not m.internal
            ],
            inputs={int(v): v.name for v in self.api.Input},
            outputs={int(v): v.name for v in self.api.Output},
        )

    def scan_directory(self, on_user_ready=None):
        from pyquadcortex.client import pa

        transport = self.qc._t
        api = self.api
        user_key = str(api.Setlist.USER).rstrip("/")
        inbox = SimpleQueue()
        # Transport calls append on each collector outside its registry lock.
        class Inbox:
            append = staticmethod(inbox.put)
        entry = (pa.FileMessage, lambda m: m.type == 0 and bool(m.folder.key), Inbox())
        with transport._lock:
            transport._collectors.append(entry)
        folders = {}
        try:
            transport.send(pa.FileMessage(action=pa.MessageAction.READ))
            deadline = clock_seconds() + 12
            while True:
                try:
                    message = inbox.get(timeout=max(0, deadline-clock_seconds()))
                except Empty:
                    break
                f = message.folder
                key = f.key.rstrip("/")
                factory = key == str(api.Setlist.FACTORY).rstrip("/")
                if f.is_plugin or not (factory or key.startswith("/media/p4/Presets/") or f.is_downloads or f.is_cloud):
                    continue
                group = "Factory Presets" if factory else "Downloads" if f.is_downloads else "Cloud Presets" if f.is_cloud else f.name
                entries = [dict(slot=x.index,name=x.name,author=x.author,instrument=x.instrument,folder=key) for x in f.files if x.name]
                empty_slots = [x.index for x in f.files if x.HasField("index") and not x.name and 0 <= x.index < 256] if not (f.is_downloads or f.is_cloud) else []
                if key not in folders or len(entries)+len(empty_slots)>len(folders[key]["entries"])+len(folders[key]["emptySlots"]) or (on_user_ready and key == user_key and len(f.files)):
                    folders = dict(folders)
                    folders[key] = dict(key=key,name=group,entries=entries,emptySlots=empty_slots,local=factory or key.startswith("/media/p4/Presets/"))
                    self.directory_folders = folders
                    if key == user_key and len(f.files):
                        self.slots = {p["slot"]: p["name"] for p in entries}
                        self.slots_valid_until = clock_seconds() + 60
                        if on_user_ready:
                            on_user_ready()
                            on_user_ready = None
        finally:
            with transport._lock:
                transport._collectors.remove(entry)
        if user_key not in folders:
            raise ValueError("본체 세트리스트 응답이 지연되었습니다. 다시 열어 주세요.")
        return list(folders.values())

    def request(self, action, d):
        q, api = self.qc, self.api
        if action in ("device-settings", "device-set"):
            from device_settings import device_settings
            return device_settings(q, action, d)
        if action in ("io-settings", "io-set"):
            from io_settings import io_request
            return io_request(q, action, d)
        if action in ("toolbar", "master-volume", "master-state"):
            from pyquadcortex.client import pa
            from time import monotonic, sleep
            def volume_state():
                msg = q.master_volume(timeout=.7)
                return dict(volume=msg.volume, engaged=msg.engaged if msg.HasField("engaged") else None)

            if action == "master-state":
                return volume_state()
            if action == "master-volume":
                target = d.get("value")
                if type(target) not in (int, float) or not 0 <= target <= 1:
                    raise ValueError("Invalid master volume")
                q.set_master_volume(target)
                deadline = monotonic() + .9
                while True:
                    actual = volume_state()
                    if abs(actual["volume"] - target) <= .005:
                        return actual
                    if monotonic() >= deadline:
                        raise ValueError("본체에서 마스터 볼륨 변경을 확인하지 못했습니다.")
                    sleep(.045)
            frames = self.read_history_frames()
            rev = revision(self.grid) if self.grid else None
            return dict(**volume_state(),
                        **{a:self.history_available(a, rev, frames) for a in ("undo","redo")})
        if action in ("cpu", "tuner", "global-tempo", "set-tempo"):
            return utility_request(self, action, d)
        if action == "live":
            state = self.snapshot()
            if d.get("known") == state["rev"]:
                return dict(unchanged=True, deviceName=self.device_name, scene=state["scene"], dirty=state["dirty"])
            return state
        if action == "capture-layout":
            return self.read_capture_layout()
        if action == "captures":
            return self.captures()
        if action == "library":
            return self.library()
        if action == "preset-directory":
            return self.scan_directory()
        if action == "presets":
            if clock_seconds() >= self.slots_valid_until:
                self.slots = {x.index: x.name for x in q.list_presets()}
                self.slots_valid_until = clock_seconds() + 60
            return [dict(slot=i, name=n) for i, n in self.slots.items()]
        if action == "scene":
            target = integer(d, "target", 0, 7)
            if "identity" in d and str(q.read_current_preset().hash) != d["identity"]:
                raise ValueError("씬 전환 전에 프리셋이 바뀌었습니다.")
            q.switch_scene(target)
            scene = int(q.active_scene())
            if scene != target:
                raise ValueError("Scene change was not confirmed")
            return dict(scene=scene)
        state = self.snapshot()
        if state["rev"] != d.get("rev") or state["scene"] != d.get("scene"):
            raise ValueError("본체 상태가 변경되었습니다. 다시 읽은 뒤 시도하세요.")
        if action in ("undo", "redo"):
            from time import sleep, monotonic
            from pyquadcortex.client import pa
            previous_frames = self.read_history_frames()
            if not self.history_available(action, state["rev"], previous_frames):
                raise ValueError("현재 프리셋에서 되돌릴 편집 기록이 없습니다.")

            q._t.send(
                pa.UndoRedoMessage(action=pa.MessageAction.UPDATE, **{action: True})
            )
            until = monotonic() + .7
            while True:
                current = self.read_history_frames()
                if current != previous_frames:
                    break
                if monotonic() >= until:
                    raise ValueError("본체에서 편집 기록 변경을 확인하지 못했습니다.")
                sleep(.035)
        elif action == "recall":
            slot = integer(d, "slot", 0, 255)
            folder = d.get("folder", api.Setlist.USER)
            slots = self.slots
            if "folder" in d:
                listing = getattr(self,"directory_folders",{}).get(folder)
                if not listing or not listing["local"]:
                    raise ValueError("본체 세트리스트를 다시 열어 주세요.")
                slots = {x["slot"]:x["name"] for x in listing["entries"]}
            empty = d.get("empty") is True
            if empty:
                if "folder" not in d or slot not in listing["emptySlots"] or slot in slots:
                    raise ValueError("Preset slot changed")
            elif slot not in slots or slots[slot] != d.get("name"):
                raise ValueError("Preset slot changed")
            if state["dirty"] and not d.get("discard"):
                raise ValueError("Unsaved changes")
            self.clear_edit_history()
            path = api.Setlist.FACTORY if folder==str(api.Setlist.FACTORY).rstrip("/") else folder
            if empty:
                # The device names a blank grid independently of its directory label.
                # Wait for the reply correlated to this exact slot recall.
                return self.snapshot(q.read_preset(path, slot))
            q.recall_preset(path, slot)
        elif action == "save":
            # The device records the containing folder in its current Recents entry.
            recent = next(iter(q.recents().items), None)
            if recent is None or recent.name != state["name"] or recent.is_factory or not recent.folder_key.startswith("/media/p4/Presets/"):
                raise ValueError("현재 프리셋의 쓰기 가능한 저장 위치를 확인할 수 없습니다.")
            folder = recent.folder_key
            matches = [x for x in q.list_presets(folder) if x.name == state["name"]]
            if len(matches) != 1 or matches[0].is_readonly:
                raise ValueError("현재 프리셋의 저장 슬롯을 확인할 수 없습니다.")
            existing = matches[0]
            slot = existing.index
            if str(q.read_current_preset().hash) != state["identity"]:
                raise ValueError("저장 전에 프리셋이 변경되었습니다.")
            self.clear_edit_history()
            # File CREATE may never get a direct reply. The slot readback below
            # and the device's dirty flag confirm completion independently.
            from pyquadcortex.client import pa
            write = pa.FileMessage(type=0)
            write.folder.key = folder
            write.folder.is_factory = False
            write.folder.files.add(index=slot, name=existing.name, instrument=existing.instrument)
            q._file_operation(write, timeout=.15)
            saved = {x.index: x.name for x in q.list_presets(folder)}
            if folder.rstrip("/") == api.Setlist.USER.rstrip("/"):
                self.slots = saved
                self.slots_valid_until = clock_seconds() + 60
            if saved.get(slot) != existing.name:
                raise ValueError("저장 슬롯에서 프리셋을 확인하지 못했습니다.")
        else:
            try:
                before_frames = self.read_history_frames()
            except TimeoutError:
                before_frames = None
            self.edit(state, action, d)
        result = self.snapshot()
        if action in ("undo", "redo"):
            stack = self.edit_history[action]
            expected = stack[-1][0 if action == "undo" else 1] if stack else None
            deadline = monotonic() + .8
            while (expected and result["rev"] != expected and result["identity"] == state["identity"]
                   and monotonic() < deadline):
                sleep(.04)
                result = self.snapshot()
            if not expected or result["rev"] != expected:
                self.clear_edit_history()
                raise ValueError("편집 기록이 변경되어 현재 프리셋 상태를 다시 읽었습니다.")
            self.edit_history["redo" if action=="undo" else "undo"].append(stack.pop())
            self.history_frames = self.read_history_frames()
        if action == "recall" and result["name"] != d["name"]:
            raise ValueError("요청한 프리셋과 본체 응답이 다릅니다.")
        if action in (
            "scene-style", "scene-transfer", "expression", "expression-bypass", "stomp", "momentary",
            "place",
            "delete",
            "move",
            "assign",
            "edit",
            "bypass", "bypass-assign",
            "input",
            "output",
            "route-edit",
            "route-assign",
            "lane-mute",
            "split",
        ):
            verify_edit(action, d, state, result)
            try:
                after_frames = self.read_history_frames()
            except TimeoutError:
                after_frames = None
            if self.history_frames != before_frames or (self.edit_history["undo"] and
                    self.edit_history["undo"][-1][1] != state["rev"]):
                self.clear_edit_history()
            if state["rev"] != result["rev"]:
                # A full native stack can have the same type codes before and after
                # a parameter write. Only accept that case for a known grid edit.
                if (before_frames is None or not after_frames or not after_frames[0] or
                        (before_frames == after_frames and (len(after_frames[0]) < 20 or after_frames[0][-1] != 0))):
                    self.clear_edit_history()
                else:
                    self.edit_history["undo"].append((state["rev"],result["rev"]))
                    self.edit_history["undo"] = self.edit_history["undo"][-len(after_frames[0]):]
                    self.edit_history["redo"].clear()
                    self.history_frames = after_frames
        if action == "save":
            if result["dirty"] and result["name"] == saved[slot]:
                from time import sleep
                deadline = clock_seconds() + 4
                while clock_seconds() < deadline and q.preset_dirty():
                    sleep(.1)
                result = self.snapshot()
            if saved[slot] != result["name"] or result["dirty"]:
                raise ValueError(
                    "저장 후 슬롯과 현재 프리셋이 일치하지 않습니다. 목록에서 확인하세요."
                )
            result["savedName"] = saved[slot]
        return result

    def edit(self, state, action, d):
        q, api = self.qc, self.api
        if action in ("scene-style", "scene-transfer"):
            if state["identity"] != d.get("identity"):
                raise ValueError("Preset changed")
            source, value, option = scene_change(action, d)
            if action == "scene-transfer":
                q.copy_scene(source, value, swap=option)
            else:
                if value is not None:
                    q.set_scene_label(source, value.strip() or None)
                if option is not None:
                    q.set_scene_color(source, 0xff000000 | int(option[1:], 16))
            return
        row = integer(d, "row", 0, 3)
        if action in ("input", "output"):
            ports = api.Input if action == "input" else api.Output
            port = ports(d["value"])
            (q.set_chain_input if action == "input" else q.set_chain_output)(
                row, int(port)
            )
            return
        if action in ("route-edit","route-assign"):
            part = d.get("part")
            controls = state["lanes"][row]["controls"].get(part, [])
            param = next((p for p in controls if p["index"] == d.get("index")), None)
            value = d.get("value")
            if not param:
                raise ValueError("Invalid routing parameter")
            if action == "route-assign":
                field,mid,_ = ROUTE_MODELS[part]
                enabled = not param["assigned"]
                if part == "start":
                    q._t.send(q._combined_splitter_message(row,param["index"],scene_mode=enabled))
                else:
                    q._sub_param_scene_mode(field,mid,row,param["index"],enabled)
                return
            if type(value) not in (int, float) or not 0 <= value <= 1:
                raise ValueError("Invalid routing parameter")
            getattr(q, ROUTE_MODELS[part][2])(row, param["index"], value=value)
            return
        if action == "lane-mute":
            if type(d.get("mute")) != bool or not state["lanes"][row]["mute"]:
                raise ValueError("Invalid lane mute")
            q.set_lane_output(row, "MUTE", value=float(d["mute"]))
            return
        if action == "split":
            if row not in (0, 2):
                raise ValueError("Invalid split lane")
            start = integer(d, "start", -1, 7)
            end = integer(d, "end", -1, 7)
            if start == end == -1:
                q.clear_split(row)
            elif end == -1 or end >= start:
                q.set_split(row, start, end)
            else:
                raise ValueError("Merge precedes split")
            return
        col = integer(d, "col", 0, 7)
        block = next(
            (b for b in state["blocks"] if (b["row"], b["col"]) == (row, col)), None
        )
        if action == "place":
            model = q.catalog.get(d["model"])
            if not model or model.hidden or model.internal:
                raise ValueError("Unknown model")
            if d.get("capture"):
                if not self.capture_entries:
                    self.captures()
                entry = self.capture_entries.get(d["capture"])
                if not entry or model.id != (14001 if entry.version == 2 else 14000):
                    raise ValueError("Capture library changed")
                q.set_capture(row, col, entry, model=model.id)
            else:
                q.set_block(row, col, model)
            return
        if not block:
            raise ValueError("Empty slot")
        if action == "move":
            q.move_block(row, col, integer(d, "toRow", 0, 3), integer(d, "toCol", 0, 7))
        elif action == "delete":
            q.remove_block(row, col)
        elif action == "bypass-assign":
            from pyquadcortex.client import preset
            update = preset.BinaryPreset()
            entry = update.bypass.add(row=row).colBypass.add(column=col)
            entry.sceneMode = not block["bypassAssigned"]
            q.write_preset(update)
        elif action == "bypass":
            q.set_bypass(row, col, not block["bypass"][state["scene"]])
        elif action == "expression-bypass":
            pedal = integer(d, "pedal", 0, 2)
            mode = integer(d, "mode", 0, 2)
            delay = integer(d, "delay", 0, 5000)
            if type(d.get("invert")) != bool or type(d.get("latch")) != bool:
                raise ValueError("Invalid expression bypass settings")
            q.set_expression_bypass(row,col,pedal,mode,d["invert"],delay,d["latch"])
        elif action == "stomp":
            switch = integer(d, "switch", -1, 7)
            if switch == -1:
                q.clear_stomp_assignment(row, col)
            else:
                q.set_stomp_assignment(row, col, switch)
        elif action == "momentary":
            switch = block["stomp"]
            if switch is None or sum(b["stomp"] == switch for b in state["blocks"]) != 1 or type(d.get("value")) != bool:
                raise ValueError("Footswitch mode unavailable")
            q.set_stomp_momentary(switch, d["value"])
        elif action == "expression":
            pedal = integer(d, "pedal", 0, 2)
            p = next((p for p in block["params"] if p["index"] == d.get("index") and "expression" in p), None)
            if not p:
                raise ValueError("Unknown expression parameter")
            limits = [d.get(k, p[k] if p["expression"] else default)
                      for k, default in (("expressionMin", 0), ("expressionMax", 1))]
            if any(type(x) not in (int, float) or not 0 <= x <= 1 for x in limits):
                raise ValueError("Invalid expression range")
            q.set_expression(row, col, p["index"], pedal, *limits)
        elif action in ("edit", "assign"):
            param = next(
                (p for p in block["params"] if p["index"] == d.get("index")), None
            )
            if not param:
                raise ValueError("Unknown parameter")
            if action == "assign":
                q.set_param_scene_mode(row, col, param["index"], not param["assigned"])
            else:
                value = d.get("value")
                if type(value) not in (int, float) or not 0 <= value <= 1:
                    raise ValueError("Invalid value")
                if "textOptions" in param:
                    options = param["textOptions"]
                    q.set_param(row, col, param_index=param["index"], text=options[round(value*(len(options)-1))])
                else:
                    q.set_param(row, col, param_index=param["index"], value=value)
        else:
            raise ValueError("Unknown action")


def verify_edit(action, data, before, after):
    """A completed HID write alone cannot confirm that the device accepted it."""
    if action in ("scene-style", "scene-transfer"):
        src, value, option = scene_change(action, data)
        ok = before["identity"] == after["identity"]
        if action == "scene-style":
            meta = after["sceneInfo"][src]
            ok &= (value is None or meta["label"] == value.strip()) and (option is None or meta["color"] == option)
        else:
            def contents(grid, i):
                return [grid["sceneInfo"][i], *(v[i] for v in scene_values(grid))]
            ok &= contents(after, value) == contents(before, src)
            if option:
                ok &= contents(after, src) == contents(before, value)
        if not ok:
            raise ValueError("본체에서 씬 변경 결과를 확인하지 못했습니다.")
        return
    row, col = data["row"], data.get("col")

    def cell(state, r, c):
        return next(
            (b for b in state["blocks"] if b["row"] == r and b["col"] == c), None
        )

    previous, current = cell(before, row, col), cell(after, row, col)
    success = False
    if before["identity"] != after["identity"] or before["scene"] != after["scene"]:
        raise ValueError("편집 중 프리셋 또는 씬이 바뀌었습니다.")
    if action in ("input", "output"):
        success = after["lanes"][row][action] == data["value"]
    elif action in ("route-edit","route-assign"):
        param = next(p for p in after["lanes"][row]["controls"][data["part"]] if p["index"] == data["index"])
        actual = param["values"][after["scene"] if param["assigned"] else 0]
        if action == "route-assign":
            old = next(p for p in before["lanes"][row]["controls"][data["part"]] if p["index"] == data["index"])
            success = old["assigned"] != param["assigned"]
        else:
            success = actual is not None and abs(actual - data["value"]) < .002
    elif action == "lane-mute":
        flags = after["lanes"][row]["mute"]
        success = bool(flags) and flags[after["scene"] if len(flags) > 1 else 0] == data["mute"]
    elif action == "split":
        split = next((s for s in after["splits"] if s["row"] == row), None)
        success = (
            split is None
            if data["start"] == data["end"] == -1
            else split == dict(row=row, start=data["start"], end=data["end"])
        )
    elif action == "move":
        dest = cell(after, data["toRow"], data["toCol"])
        success = dest and dest["model"] == previous["model"]
    elif action == "place":
        success = (
            current
            and current["model"] == data["model"]
            and (not data.get("capture") or current["capture"] == data["capture"])
        )
    elif action == "delete":
        success = current is None
    elif action == "bypass-assign" and current:
        if current["bypassAssigned"] == previous["bypassAssigned"]:
            raise ValueError("본체에서 블록의 씬 할당 변경을 확인하지 못했습니다.")
        success = True
    elif action == "bypass" and current:
        scene = after["scene"]
        success = current["bypass"][scene] != previous["bypass"][scene]
    elif current and action == "expression-bypass":
        success = all(data[k] == v for k,v in current["expressionBypass"].items())
    elif current and action == "expression":
        p = next(p for p in current["params"] if p["index"] == data["index"])
        success = p["expression"] == data["pedal"] and all(
            abs(p[k] - data[k]) < .002 for k in ("expressionMin","expressionMax") if k in data)
    elif current and action == "stomp":
        success = current["stomp"] == (None if data["switch"] == -1 else data["switch"])
    elif current and action == "momentary":
        success = current["momentary"] == data["value"]
    elif current and action in ("edit", "assign"):
        param = next(p for p in current["params"] if p["index"] == data["index"])
        if action == "assign":
            old = next(p for p in previous["params"] if p["index"] == data["index"])
            success = param["assigned"] != old["assigned"]
        else:
            value = param["values"][after["scene"] if param["assigned"] else 0]
            if param.get("textOptions") and value is not None:
                old = next(p for p in previous["params"] if p["index"] == data["index"])
                wanted = old["textOptions"][round(data["value"]*(len(old["textOptions"])-1))]
                success = param["textOptions"][round(value*(len(param["textOptions"])-1))] == wanted
            else:
                success = value is not None and abs(value - data["value"]) < 0.002
    if not success:
        raise ValueError("편집 요청과 본체에서 다시 읽은 결과가 다릅니다.")
