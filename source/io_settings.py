"""Global I/O Settings, addressed by physical port rather than grid row."""
import math
from time import monotonic, sleep

IN = {1, 2, 4, 5}
OUT = {1, 2, 4, 5, 6, 7, 8, 9}


def io_defaults():
    v = {"xlr1_2_linked":True,"out3_4_linked":True,"hp_port.level":40/52,"hp_feed.19.level":46/52,
         "usb_port.dry_wet":0,"usb_port.level":1,"usb_port.hp_select":1,"midi_port.midi_thru":0,"eq.bypassed":True}
    for i in (1,2,4,5):
        prefix=f"in_port.{i}."
        v.update({prefix+"level":1/6,prefix+"ground_lift":0,prefix+"plugged":False})
        if i in (1,2):
            v.update({prefix+"input_type":0,prefix+"input_zmode":7/8})
    for i in (1,2,4,5,6,7,8,9):
        prefix=f"out_port.{i}."
        v[prefix+"level"]=40/52
        if i<8: v[prefix+"mute"]=False
        if i in (1,4,5): v[prefix+"ground_lift"]=0
    for i in (1,2):
        v.update({f"exp_port.{i}.level":0,f"exp_port.{i}.calibrating":False})
    for i, freq in enumerate((50,125,1000,4000,7000)):
        for j,val in enumerate((.5,((freq-20)/19980)**.3,.0613,(1,0,0,0,.75)[i],1)):
            v[f"eq.{5*i+j}"]=val
    v.update({"eq.25":.5,"eq.26":0,"eq.27":0})
    return v


def flatten_io(io, eq):
    values = {}
    for group, id_field in (("in_port","input_port_id"), ("out_port","output_port_id"), ("exp_port","exp_port_id")):
        for port in io["settings"].get(group, []):
            for field, value in port.items():
                if field != id_field:
                    values[f"{group}.{port[id_field]}.{field}"] = value
    for group in ("usb_port", "midi_port", "hp_port"):
        for field, value in io["settings"].get(group, {}).items():
            if field == "hp_feed":
                for feed in value:
                    values[f"hp_feed.{feed['output_port_id']}.level"] = feed.get("level", 0)
            else:
                values[f"{group}.{field}"] = value
    for field in ("xlr1_2_linked","out3_4_linked"):
        if field in io:
            values[field] = io[field]
    if eq:
        values["eq.bypassed"] = eq.get("bypassed", False)
        for p in eq.get("parameters", []):
            values[f"eq.{p.get('parameter_index', 0)}"] = p.get("value", 0)
    return values


def read_io(q):
    from pyquadcortex.client import pa
    from google.protobuf.json_format import MessageToDict
    def read(cls, match):
        try:
            msg = q._t.request(cls(action=pa.MessageAction.READ), timeout=3)
            if match(msg):
                return MessageToDict(msg, preserving_proto_field_name=True)
        except TimeoutError:
            pass
        msg = q._read_state(cls, match, 10)
        return MessageToDict(msg, preserving_proto_field_name=True)
    return flatten_io(read(pa.IOSettingsMessage, lambda m: bool(m.settings.in_port)),
                      read(pa.GlobalEQMessage, lambda m: bool(m.parameters)))


def apply_io(q, key, value):
    from pyquadcortex.client import pa
    if type(value) not in (float,int,bool) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Invalid I/O value")
    parts = key.split(".")
    if key == "eq.bypassed":
        return q.set_global_eq_bypassed(bool(value))
    if parts[0] == "eq" and len(parts)==2 and parts[1].isdigit() and int(parts[1]) < 28:
        return q.set_global_eq_band(int(parts[1]), value)
    msg = pa.IOSettingsMessage(action=pa.MessageAction.UPDATE)
    if key in ("xlr1_2_linked","out3_4_linked"):
        setattr(msg,key,bool(value))
    elif len(parts)==3 and parts[1].isdigit():
        group, pid, field = parts[0], int(parts[1]), parts[2]
        if group=="in_port" and pid in IN and field in (("level","input_type","input_zmode","ground_lift") if pid<=2 else ("level","ground_lift")):
            return q.set_input_port(pid, **{{"input_zmode":"impedance"}.get(field,field):value})
        if group=="out_port" and pid in OUT and field in ("level","ground_lift","mute"):
            return q.set_output_port(pid, **{field:bool(value) if field=="mute" else value})
        if group=="exp_port" and pid in (1,2) and field=="calibrating":
            port=msg.settings.exp_port.add(exp_port_id=pid);port.calibrating=bool(value)
        elif group=="hp_feed" and field=="level":
            msg.settings.hp_port.hp_feed.add(output_port_id=pid,level=value)
        else:
            raise ValueError("Unsupported port setting")
    elif key=="hp_port.level":
        msg.settings.hp_port.level=value
    elif key in ("usb_port.level","usb_port.hp_select","usb_port.dry_wet"):
        return q.set_usb_port(**{parts[-1]:value})
    elif key=="midi_port.midi_thru":
        return q.set_midi_thru(bool(value))
    else:
        raise ValueError("Unsupported I/O setting")
    q._t.send(msg)


def io_request(q, action, data):
    values = read_io(q)
    if action == "io-settings":
        return values
    key, value = data.get("key"), data.get("value")
    if key not in values or abs(values[key]-data["previous"]) > .0001:
        raise ValueError("본체의 I/O 설정이 변경되었습니다. 다시 선택하세요.")
    apply_io(q,key,value)
    deadline = monotonic()+4
    while True:
        values = read_io(q)
        if abs(values.get(key, -1)-value)<.0001:
            return values
        if monotonic()>=deadline:
            raise ValueError("본체에서 I/O 설정 변경을 확인하지 못했습니다.")
        sleep(.08)
