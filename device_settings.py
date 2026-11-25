"""Device Settings exposed by Cortex Remote."""
RANGES = {
    "screen_brightness": 100, "led_brightness": 100, "dimmed_led_brightness": 100,
    "scene_block_bypass": 2, "hold_timing": 5, "midi_clock_out": 3, "midi_channel": 16,
}
SWITCHES = """enable_preset_dimmed enable_scene_dimmed enable_stomp_dimmed stomp_mode_auto_assign
gig_view_stomp_access_enabled swap_tempo_tuner_access enable_dynamic_delay_compensation
midi_over_usb ignore_duplicate_pc midi_clock_in_enabled""".split()
OUTPUTS = ("out12", "out34", "send12", "headphones")
GROUPS = {"master_volume_assignment": OUTPUTS,
          "global_bypass_cab": tuple(f"row{i}" for i in range(1, 5)),
          "global_bypass_ir": tuple(f"row{i}" for i in range(1, 5))}


def demo_settings():
    values = dict.fromkeys(RANGES, 0) | dict.fromkeys(SWITCHES, False)
    for group, fields in GROUPS.items():
        values.update({f"{group}.{key}": group == "master_volume_assignment" for key in fields})
    return dict(values, midi_channel=1, midi_thru=False, screen_brightness=50, led_brightness=50,
                dimmed_led_brightness=10, hold_timing=3)


def read_settings(q):
    msg = q.settings()
    values = {key: getattr(msg, key) for key in [*RANGES, *SWITCHES] if msg.HasField(key)}
    for group, fields in GROUPS.items():
        if msg.HasField(group):
            values.update({f"{group}.{key}": getattr(getattr(msg, group), key) for key in fields})
    port = q.io_settings().settings.midi_port
    if port.HasField("midi_thru"):
        values["midi_thru"] = bool(port.midi_thru)
    return values


def validate_edit(values, data):
    key, value = data.get("key"), data.get("value")
    if key not in values or values[key] != data.get("previous"):
        raise ValueError("설정이 변경되었습니다. 다시 읽어 주세요.")
    if key in RANGES:
        minimum = 1 if key == "midi_channel" else 0
        if type(value) is not int or not minimum <= value <= RANGES[key]:
            raise ValueError("설정 범위를 확인하세요.")
    elif type(value) is not bool:
        raise ValueError("On 또는 Off를 선택하세요.")
    return key, value


def device_settings(q, action, data):
    values = read_settings(q)
    if action == "device-settings":
        return values
    key, value = validate_edit(values, data)
    if key.startswith("master_volume_assignment."):
        q.set_master_volume_assignment(**{key.split(".")[1]: value})
    elif key.startswith("global_bypass_"):
        group, field = key.split(".")
        rows = [value if name == field else values[f"{group}.{name}"] for name in GROUPS[group]]
        q.set_global_bypass(**{group.rsplit("_", 1)[1]: rows})
    elif key == "midi_thru":
        q.set_midi_thru(value)
    else:
        q.update_settings(**{key: value})
    result = read_settings(q)
    if key not in ("screen_brightness", "led_brightness", "dimmed_led_brightness") and result.get(key) != value:
        raise ValueError("본체에서 설정 변경을 확인하지 못했습니다.")
    return result
