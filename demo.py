"""In-memory editor for running the web interface without a USB device."""

from copy import deepcopy
from editor import revision

MODELS = [
    (1, "Optical Comp", "Compressor"),
    (2, "Studio Amp", "Amp"),
    (3, "Tape Echo", "Delay"),
    (4, "Room Reverb", "Reverb"),
]


def block(row, col, model):
    _, name, category = next(m for m in MODELS if m[0] == model)
    names = {
        1: ["LEVEL"],
        2: ["GAIN", "BASS", "MID", "TREBLE"],
        3: ["MIX", "FEEDBACK"],
        4: ["MIX"],
    }[model]
    return dict(
        row=row,
        col=col,
        model=model,
        name=name,
        category=category,
        bypass=[False] * 8,
        params=[
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


class Demo:
    def __init__(self):
        self.global_tempo = [0.4,0,1,.613137,0,.5,.1,0,0,0]
        self.grid = dict(
            tempo=[[v] for v in self.global_tempo],
            name="Demo · Clean",
            identity="demo-0",
            lanes=[dict(input=1, output=19, mute=[False]) for _ in range(4)],
            blocks=[block(0, 0, 1), block(0, 2, 2), block(0, 4, 3)],
            splits=[],
        )
        self.saved = {
            0: deepcopy(self.grid),
            1: dict(deepcopy(self.grid), name="Demo · Drive", identity="demo-1"),
        }
        self.scene = 0
        self.tuner_mute = False
        self.dirty = False
        self.undo = []
        self.redo = []

    def request(self, a, d):
        g = self.grid
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
                models=[dict(model=i, name=n, category=c) for i, n, c in MODELS],
                inputs={1: "INPUT_1", 2: "INPUT_2"},
                outputs={19: "MULTIPLE", 1: "XLR_1_2"},
            )
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
                g["name"] = d["name"]
                self.saved[d["slot"]] = deepcopy(g)
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
