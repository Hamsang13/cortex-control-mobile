"""Serialize device state and apply guarded editor operations on the USB worker."""

from utilities import tempo_values, utility_request

import hashlib
import json
import math
import xml.etree.ElementTree as ET


def revision(state):
    raw = json.dumps(state, sort_keys=True, allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()[:24]


def integer(data, key, low, high):
    value = data.get(key)
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"Invalid {key}")
    return value


def read_grid(api, qc, metadata):
    preset = qc.read_current_preset()
    blocks = []
    lanes = []
    for row, chain in enumerate(preset.chains):
        lanes.append(dict(input=chain.in_portid, output=chain.out_portid))
        for col, block in enumerate(chain.models):
            if not block.hash:
                continue
            model = qc.catalog.get(block.hash)
            params = []
            for spec in model.parameters if model else ():
                if spec.type not in (
                    "float",
                    "switch",
                    "rotarySwitch",
                    "comboBox",
                    "toggleButton",
                ) or spec.index >= len(block.params):
                    continue
                ui = metadata.get((block.hash, spec.index), {})
                if ui.get("hidden", "false").lower() == "true":
                    continue
                param = api.param_state(preset, row, col, spec.index)
                values = [
                    v
                    if isinstance(v, float) and math.isfinite(v) and 0 <= v <= 1
                    else None
                    for v in param.values
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
                        name=spec.name,
                        type=spec.type,
                        values=values,
                        assigned=param.scene_mode,
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
            bypass = api.bypass_state(preset, row, col)
            capture_name = ""
            capture_key = ""
            if model and model.category_id == 14:
                for spec in model.parameters:
                    if spec.name == "file_name" and spec.index < len(block.params):
                        values = api.param_state(preset, row, col, spec.index).values
                        if values and isinstance(values[0], str):
                            capture_key, capture_name = values[0][:64], values[0][64:]
            blocks.append(
                dict(
                    row=row,
                    col=col,
                    model=block.hash,
                    name=capture_name or (model.name if model else str(block.hash)),
                    capture=capture_key,
                    category=model.category if model else "Other",
                    params=sorted(params, key=lambda p: p["pos"]),
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
            dict(row=s.row, start=s.split_column, end=s.mix_column)
            for s in api.splits(preset)
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
        qc._catalog = parse_model_repo(payload)
        root = ET.fromstring(_extract_xml(payload))
        self.metadata = {
            (int(m.get("id")), i): p.attrib
            for m in root.findall("Category/Model")
            if m.get("id")
            for i, p in enumerate(m.findall("Parameter"))
        }
        self.grid = None
        self.slots = {}
        self.capture_entries = {}

    def snapshot(self):
        self.grid = read_grid(self.api, self.qc, self.metadata)
        return self.view()

    def view(self):
        return dict(
            **self.grid,
            rev=revision(self.grid),
            scene=int(self.qc.active_scene()),
            dirty=self.qc.preset_dirty(),
        )

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

    def library(self):
        return dict(
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

    def request(self, action, d):
        q, api = self.qc, self.api
        if action in ("cpu", "tuner", "global-tempo", "set-tempo"):
            return utility_request(self, action, d)
        if action == "live":
            state = self.snapshot()
            if d.get("known") == state["rev"]:
                return dict(unchanged=True, scene=state["scene"], dirty=state["dirty"])
            return state
        if action == "capture-layout":
            return self.read_capture_layout()
        if action == "captures":
            return self.captures()
        if action == "library":
            return self.library()
        if action == "presets":
            self.slots = {x.index: x.name for x in q.list_presets()}
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
            from pyquadcortex.client import pa

            q._t.send(
                pa.UndoRedoMessage(action=pa.MessageAction.UPDATE, **{action: True})
            )
        elif action == "recall":
            slot = integer(d, "slot", 0, 255)
            if slot not in self.slots or self.slots[slot] != d.get("name"):
                raise ValueError("Preset slot changed")
            if state["dirty"] and not d.get("discard"):
                raise ValueError("Unsaved changes")
            q.recall_preset(api.Setlist.USER, slot)
        elif action == "save":
            slot = integer(d, "slot", 0, 255)
            name = d.get("name")
            if not isinstance(name, str) or not name.strip() or len(name) > 64:
                raise ValueError("Invalid name")
            existing = next((x for x in q.list_presets() if x.index == slot), None)
            if (existing.name if existing else "") != d.get("previous"):
                raise ValueError("Save destination changed")
            q.save_current_preset(
                api.Setlist.USER,
                slot,
                name,
                instrument=existing.instrument if existing else 0,
            )
            self.slots = {x.index: x.name for x in q.list_presets()}
            if slot not in self.slots:
                raise ValueError("저장 슬롯에서 프리셋을 확인하지 못했습니다.")
        else:
            self.edit(state, action, d)
        result = self.snapshot()
        if action == "recall" and result["name"] != d["name"]:
            raise ValueError("요청한 프리셋과 본체 응답이 다릅니다.")
        if action in (
            "place",
            "delete",
            "move",
            "assign",
            "edit",
            "bypass",
            "input",
            "output",
            "split",
        ):
            verify_edit(action, d, state, result)
        if action == "save":
            if self.slots[slot] != result["name"] or result["dirty"]:
                raise ValueError(
                    "저장 후 슬롯과 현재 프리셋이 일치하지 않습니다. 목록에서 확인하세요."
                )
            result["savedName"] = self.slots[slot]
        return result

    def edit(self, state, action, d):
        q, api = self.qc, self.api
        row = integer(d, "row", 0, 3)
        if action in ("input", "output"):
            ports = api.Input if action == "input" else api.Output
            port = ports(d["value"])
            (q.set_chain_input if action == "input" else q.set_chain_output)(
                row, int(port)
            )
            return
        if action == "split":
            if row not in (0, 2):
                raise ValueError("Invalid split lane")
            start = integer(d, "start", -1, 7)
            end = integer(d, "end", -1, 7)
            if start < 0:
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
        elif action == "bypass":
            q.set_bypass(row, col, not block["bypass"][state["scene"]])
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
                q.set_param(row, col, param_index=param["index"], value=value)
        else:
            raise ValueError("Unknown action")


def verify_edit(action, data, before, after):
    """A completed HID write alone cannot confirm that the device accepted it."""
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
    elif action == "split":
        split = next((s for s in after["splits"] if s["row"] == row), None)
        success = (
            split is None
            if data["start"] == -1
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
    elif action == "bypass" and current:
        scene = after["scene"]
        success = current["bypass"][scene] != previous["bypass"][scene]
    elif current and action in ("edit", "assign"):
        param = next(p for p in current["params"] if p["index"] == data["index"])
        if action == "assign":
            old = next(p for p in previous["params"] if p["index"] == data["index"])
            success = param["assigned"] != old["assigned"]
        else:
            value = param["values"][after["scene"] if param["assigned"] else 0]
            success = value is not None and abs(value - data["value"]) < 0.002
    if not success:
        raise ValueError("편집 요청과 본체에서 다시 읽은 결과가 다릅니다.")
