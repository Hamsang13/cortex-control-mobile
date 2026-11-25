"""Footer controls for the connected Quad Cortex."""
import math


def tempo_values(preset):
    if not preset.tempoProgramData:
        return []
    return [
        [v.float_value for v in param.param_values if v.HasField("float_value")][
            :8 if param.scene_mode else 1
        ]
        for param in preset.tempoProgramData[0].params[:10]
    ]


def utility_request(editor, action, data):
    from pyquadcortex.client import pa

    q = editor.qc
    if action == "cpu":
        if not hasattr(editor, "module_cost"):
            try:
                m = q._t.request(pa.CPULoadMessage(action=pa.MessageAction.READ), .18)
                if m.HasField("cpu_total_load"):
                    return dict(total=m.cpu_total_load, columns=[
                        [c.cpu_load for c in row.columns] for row in m.chains
                    ], estimated=False)
            except TimeoutError:
                pass
            m = q._t.request(pa.ModuleStatsMessage(action=pa.MessageAction.READ), 2)
            editor.module_cost = {s.id: s.cpu_percent for s in m.stats}
            editor.capacity = sum(s.cpu_percent for s in m.core_stats)
        preset = q.read_current_preset()
        columns = [[editor.module_cost.get(b.hash) for b in row.models] for row in preset.chains]
        total = sum(x for row in columns for x in row if x is not None)
        return dict(identity=str(preset.hash), columns=columns, estimated=True,
                    total=100 * total / editor.capacity if editor.capacity else None)
    if action == "tuner":
        m = q.tuner(timeout=1)
        return dict(input=m.input_port_id, reference=440 + m.frequency, mute=m.mute)
    if action == "global-tempo":
        m = q._read_state(pa.GlobalTempoMessage, lambda m: bool(m.params), 1)
        return {p.index: p.param_values[0].float_value for p in m.params if p.param_values}
    index, value = data.get("index"), data.get("value")
    if type(index) != int or index not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9):
        raise ValueError("Unknown tempo control")
    if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Invalid tempo value")
    p = q.read_current_preset()
    scene = int(q.active_scene())
    if str(p.hash) != data.get("identity") or scene != data.get("scene"):
        raise ValueError("프리셋 또는 씬이 변경되었습니다.")
    if data.get("global") or index == 1:
        raise ValueError("글로벌 템포 모드는 본체에서 설정하세요.")
    params = p.tempoProgramData[0].params
    if params[index].scene_mode:
        m = pa.GridMessage(action=pa.MessageAction.UPDATE)
        target = m.preset.tempoProgramData.add(hash=q.TEMPO_CONTROL).params.add(index=index)
        for i, item in enumerate(params[index].param_values):
            v = target.param_values.add()
            v.CopyFrom(item)
            if i == scene:
                v.float_value = value
        q._t.send(m)
    else:
        q.set_tempo_param(index, value=value)
    actual = tempo_values(q.read_current_preset())
    values = actual[index]
    if abs(values[scene if len(values) > 1 else 0] - value) > .003:
        raise ValueError("본체에서 템포 변경을 확인하지 못했습니다.")
    return actual
