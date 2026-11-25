"""In-memory editor for running the web interface without a USB device."""

from copy import deepcopy
from editor import revision

MODELS = [
    (1, "Optical Comp", "Compressor"),
    (2, "Studio Amp", "Amp"),
    (3, "Tape Echo", "Delay"),
    (4, "Room Reverb", "Reverb"),
    (5, "2×12 Demo Cab", "Cabsim Guitar (M)"),
]


def cabinet_params():
    params = []

    def add(name, value, kind="float", minimum=0, maximum=10, unit="", **extra):
        params.append(dict(index=len(params), name=name, type=kind, min=minimum, max=maximum,
                           unit=unit, normalized=False, assigned=False, values=[value]*8,
                           options=[], steps=2 if kind=="switch" else None) | extra)

    mics = ["Ribbon 160", "Ribbon 10", "Dynamic 57", "Dynamic 421", "Condenser 414", "Condenser 184"]
    for mic in range(2):
        prefix = f"MIC {mic+1}"
        add(prefix+" · BYPASS", 0, "switch")
        add(prefix, .4 if mic==0 else 0, "comboBox", options=mics, textOptions=mics, steps=len(mics))
        add(prefix+" · LEVEL", .5, minimum=-40, maximum=6, unit="dB", exponent=1/4.9594844)
        add(prefix+" · PAN", .5)
        add(prefix+" · DISTANCE", 0)
        add(prefix+" · POSITION", .4)
        add(prefix+" · PHI", 0, "switch")
        add(prefix+" · GRID MODE", 1, "switch")
    add("HPF", 0, minimum=20, maximum=500, unit="Hz", exponent=10/3)
    add("LPF", 1, minimum=500, maximum=20000, unit="Hz", exponent=10/3)
    add("OUTPUT VOLUME", .5595, minimum=-96, maximum=12, unit="dB", exponent=.20284)
    return params


def block(row, col, model):
    _, name, category = next(m for m in MODELS if m[0] == model)
    names = {
        1: ["LEVEL"],
        2: ["GAIN", "BASS", "MID", "TREBLE"],
        3: ["MIX", "FEEDBACK"],
        4: ["MIX"],
        5: [],
    }[model]
    return dict(
        row=row,
        col=col,
        model=model,
        name=name,
        category=category,
        bypass=[False] * 8,
        params=cabinet_params() if model == 5 else [
            dict(
                name=n,
                index=i,
                min=0,
                max=100,
                unit="%",
                normalized=False,
                values=[0.5] * 8,
                options=[],
                steps=None,
                assigned=False,
            )
            for i, n in enumerate(names)
        ],
    )


def demo_route_controls(row):
    def make(names, defaults):
        result = []
        for i, (name, v) in enumerate(zip(names, defaults)):
            options = {"TYPE": ["Balance", "A/B", "Crossover"], "STEREO": ["Normal", "Split"],
                       "MODE": ["Regular", "Invert"]}.get(name, [])
            switch = bool(options) or name in ("MUTE","SOLO","BYPASS","PHASE")
            result.append(dict(index=i,name=name,type="switch" if switch else "float",values=[v]*8,
                               assigned=False, min=0,max=100,unit="%",normalized=True,
                               options=options,steps=(len(options) or 2) if switch else None))
        return result
    controls = {"input":make(["NOISE REDUCTION","BYPASS","INPUT GAIN"],[.3,0,.5]),
                "output":make(["VOLUME","PAN","MUTE","SOLO"],[.77,.5,0,0])}
    if row in (0,2):
        controls["start"]=make(["TYPE","STEREO","BALANCE","LEVEL TO A","LEVEL TO B","FREQUENCY","MODE"],
                               [0,0,.5,.77,.77,.5,0])
        controls["end"]=make(["LEVEL A","PAN A","LEVEL B","PAN B","PHASE","MIXER LEVEL"],
                             [.77,.5,.77,.5,0,.77])
    return controls


def demo_io():
    v = {"xlr1_2_linked":True,"out3_4_linked":True,"hp_port.level":40/52,"hp_feed.19.level":46/52,
         "usb_port.dry_wet":0,"usb_port.level":1,"usb_port.hp_select":1,"midi_port.midi_thru":0,"eq.bypassed":True}
    for i in (1,2,4,5):
        prefix=f"in_port.{i}."
        v.update({prefix+"level":1/6,prefix+"ground_lift":0,prefix+"plugged":i==1})
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


class Demo:
    def __init__(self):
        self.io = demo_io()
        self.global_tempo = [0.4,0,1,.613137,0,.5,.1,0,0,0]
        self.grid = dict(
            tempo=[[v] for v in self.global_tempo],
            name="Demo · Clean",
            identity="demo-0",
            lanes=[dict(input=1, output=19, mute=[False], controls=demo_route_controls(row)) for row in range(4)],
            blocks=[block(0, 0, 1), block(0, 2, 2), block(0, 4, 3), block(0, 6, 5)],
            splits=[],
        )
        self.saved = {
            0: deepcopy(self.grid),
            1: dict(deepcopy(self.grid), name="Demo · Drive", identity="demo-1"),
        }
        self.scene = 0
        self.volume = .5
        self.knob_volume = self.volume
        self.tuner_mute = False
        self.dirty = False
        self.undo = []
        self.redo = []

    def request(self, a, d):
        g = self.grid
        if a == "io-settings":
            return self.io.copy()
        if a == "io-set":
            key = d["key"]
            if self.io[key] != d["previous"]:
                raise ValueError("I/O setting changed")
            self.io[key] = d["value"]
            return self.io.copy()
        if a == "toolbar":
            return dict(volume=self.volume,engaged=self.volume==self.knob_volume,undo=bool(self.undo),redo=bool(self.redo))
        if a == "master-state":
            return dict(volume=self.volume,engaged=self.volume==self.knob_volume)
        if a == "master-volume":
            v=d.get("value")
            if type(v) not in (int,float) or not 0 <= v <= 1:
                raise ValueError("Invalid master volume")
            self.volume=v
            return dict(volume=v,engaged=v==self.knob_volume)
        if a == "cpu":
            return {}
        if a == "tuner-mute":
            if type(d.get("mute")) != bool:
                raise ValueError("Invalid tuner mute")
            self.tuner_mute = d["mute"]
        if a in ("tuner", "tuner-mute"):
            return dict(reference=440, mute=self.tuner_mute)
        if a == "global-tempo":
            return self.global_tempo
        if a == "set-tempo":
            if self.scene != d.get("scene") or g["identity"] != d.get("identity"):
                raise ValueError("State changed")
            if d.get("global") and d["index"] != 1:
                self.global_tempo[d["index"]] = d["value"]
                return self.global_tempo
            g["tempo"][d["index"]] = [d["value"]]
            self.dirty = True
            return g["tempo"]
        if a == "library":
            return dict(
                deviceName="Quad Cortex (Demo)",
                models=[dict(model=i, name=n, category=c) for i, n, c in MODELS],
                inputs={1: "INPUT_1", 2: "INPUT_2"},
                outputs={19: "MULTIPLE", 1: "XLR_1_2"},
            )
        if a == "preset-directory":
            return [dict(key="demo", name="My Presets", local=True, entries=[dict(slot=i,name=v["name"]) for i,v in self.saved.items()])]
        if a == "presets":
            return [dict(slot=i, name=v["name"]) for i, v in self.saved.items()]
        if a == "scene":
            self.scene = d["target"]
            return dict(scene=self.scene)
        if a != "live":
            if revision(g) != d.get("rev") or self.scene != d.get("scene"):
                raise ValueError("State changed")
            if a in ("undo", "redo"):
                source, dest = (
                    (self.undo, self.redo) if a == "undo" else (self.redo, self.undo)
                )
                if source:
                    dest.append((deepcopy(g), self.dirty))
                    self.grid, self.dirty = source.pop()
            elif a == "recall":
                if self.dirty and not d.get("discard"):
                    raise ValueError("Unsaved changes")
                self.undo.clear()
                self.redo.clear()
                self.grid = deepcopy(self.saved[d["slot"]])
                self.scene = 0
                self.dirty = False
            elif a == "save":
                slot = next(i for i,v in self.saved.items() if v["identity"] == g["identity"])
                self.saved[slot] = deepcopy(g)
                self.dirty = False
            else:
                self.undo.append((deepcopy(g), self.dirty))
                self.redo.clear()
                row, col = d["row"], d.get("col")
                b = next(
                    (x for x in g["blocks"] if (x["row"], x["col"]) == (row, col)), None
                )
                if a in ("input", "output"):
                    g["lanes"][row][a] = d["value"]
                elif a in ("route-edit", "route-assign"):
                    lane=g["lanes"][row]
                    p=next(p for p in lane["controls"][d["part"]] if p["index"]==d["index"])
                    if a=="route-assign":
                        p.update(values=[p["values"][self.scene if p["assigned"] else 0]]*8,
                                 assigned=not p["assigned"])
                    else:
                        p["values"][self.scene if p["assigned"] else 0]=d["value"]
                    if p["name"]=="MUTE":
                        lane["mute"]=[v>=.5 for v in (p["values"] if p["assigned"] else p["values"][:1])]
                elif a == "lane-mute":
                    g["lanes"][row]["mute"] = [d["mute"]]
                elif a == "split":
                    g["splits"] = [s for s in g["splits"] if s["row"] != row]
                    if d["start"] >= 0 or d["end"] >= 0:
                        g["splits"].append(
                            dict(row=row, start=d["start"], end=d["end"])
                        )
                elif a == "place":
                    if b:
                        g["blocks"].remove(b)
                    g["blocks"].append(block(row, col, d["model"]))
                elif a == "delete":
                    g["blocks"].remove(b)
                elif a == "move":
                    other = next(
                        (
                            x
                            for x in g["blocks"]
                            if (x["row"], x["col"]) == (d["toRow"], d["toCol"])
                        ),
                        None,
                    )
                    if other:
                        raise ValueError("Destination occupied")
                    b.update(row=d["toRow"], col=d["toCol"])
                elif a == "bypass":
                    b["bypass"][self.scene] = not b["bypass"][self.scene]
                elif a == "expression-bypass":
                    b["expressionBypass"] = {k:d[k] for k in ("pedal","mode","delay","invert","latch")}
                elif a == "expression":
                    p = next(p for p in b["params"] if p["index"] == d["index"])
                    p.update(expression=d["pedal"], expressionMin=d.get("expressionMin", p.get("expressionMin", 0)),
                             expressionMax=d.get("expressionMax", p.get("expressionMax", 1)))
                elif a == "stomp":
                    b["stomp"] = None if d["switch"] == -1 else d["switch"]
                elif a == "momentary":
                    b["momentary"] = d["value"]
                elif a in ("assign", "edit"):
                    p = b["params"][d["index"]]
                    if a == "assign":
                        value = p["values"][self.scene if p["assigned"] else 0]
                        p.update(assigned=not p["assigned"], values=[value] * 8)
                    else:
                        p["values"][self.scene if p["assigned"] else 0] = d["value"]
                else:
                    raise ValueError("Unknown action")
                self.dirty = True
        return dict(
            **self.grid, rev=revision(self.grid), scene=self.scene, dirty=self.dirty
        )
