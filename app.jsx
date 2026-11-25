import {meterReading, MeterTrack} from "./SignalTrack";
import DeviceToolbar from "./DeviceToolbar";
import {GridRouting, Port, portLabel} from "./GridRouting";
import ChoiceParameter, {SceneMark} from "./ChoiceParameter";
import FooterTools from "./FooterTools";
import icons from "./cortex-icons.json";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

const letters = "ABCDEFGH",
  slotName = (i) => Math.floor(i / 8) + 1 + letters[i % 8];
const styles = [
  [/comp/i, "∿", "#46ef65"],
  [/amp/i, "▭", "#d9433f"],
  [/cab|irloader/i, "◉", "#7863ee"],
  [/capture/i, "▤", "#c5c5c5"],
  [/equalizer/i, "☷", "#287db0"],
  [/modulation/i, "∿", "#6949d4"],
  [/drive|dist|fuzz/i, "∿", "#f49a32"],
  [/delay/i, "〽", "#00dfcd"],
  [/reverb/i, "◇", "#00dfcd"],
  [/pitch/i, "♯", "#f8ca4c"],
  [/filter|wah/i, "≋", "#5a98d8"],
];
function style(category) {
  return styles.find((s) => s[0].test(category)) || [null, "≋", "#aaa"];
}
function family(name = "") {
  if (/amplifier/i.test(name)) return "Amp";
  if (/cabsim/i.test(name)) return "Cab";
  if (/overdrive/i.test(name)) return "Overdrive";
  return name;
}
const pluginNames = {
  1: "Fortin Nameless Suite X",
  3: "Archetype: Plini X",
  4: "Parallax X",
  5: "Archetype: Nolly X",
  9: "Archetype: Cory Wong X",
  10: "Archetype: Gojira X",
  11: "Soldano SLO-100 X",
  12: "Archetype: Tim Henson X",
  13: "Archetype: Petrucci X",
  15: "Archetype: Rabea X",
  20: "Archetype: Misha Mansoor X",
  21: "Archetype: John Mayer X",
};
function Icon({ category, name = "", plugin, rail = false, selected = false }) {
  const map = {
    plugins: "plugin",
    "neural capture": "capture",
    equalizer: "eq",
    irloaders: "ir",
    "fx loop": "fxLoop",
    loopers: "looper",
  };
  const cat = family(category).toLowerCase();
  const special = /doubler/i.test(name)
    ? "doubler"
    : /multivoicer/i.test(name)
      ? "multivoicer"
      : /bit crush/i.test(name)
        ? "bitcrusher"
        : null;
  const key = special || map[cat] || cat;
  const source =
    icons[key + (rail ? "Rail" : plugin ? "Plugin" : "")] ||
    icons[key] ||
    icons.utility;
  const iconSource = React.useMemo(() => {
    const prefix = "data:image/svg+xml;base64,";
    if (!selected || !source.startsWith(prefix)) return source;
    const svg = new DOMParser().parseFromString(atob(source.slice(prefix.length)), "image/svg+xml");
    const frame = svg.documentElement.querySelector("rect[stroke]");
    if (!frame) return source;
    frame.setAttribute("stroke-width", "6");
    return prefix + btoa(new XMLSerializer().serializeToString(svg.documentElement));
  }, [source, selected]);
  return (
    <img
      className="icon"
      draggable={false}
      src={iconSource}
      alt=""
      style={{ "--c": style(category)[2] }}
    />
  );
}
function placement(model) {
  return {
    model: model.model,
    ...(model.capture ? { capture: model.capture } : {}),
  };
}
async function api(action, body = {}) {
  const response = await fetch("/api/" + action, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-QC-Key": location.hash.slice(1),
    },
    body: JSON.stringify(body),
  });
  if (response.status === 403)
    throw Error("설치 시 표시된 키 포함 주소로 여세요.");
  const data = await response.json();
  if (!response.ok) {
    if (["connect", "live"].includes(action) && /no RecallPresetMessage broadcast within/i.test(data.error)) {
      throw Error("본체에서 현재 프리셋 응답이 없습니다. Cortex Control이 열려 있으면 종료한 뒤 USB 연결을 누르세요. 이미 닫았다면 USB 케이블을 확인하세요.");
    }
    throw Error(data.error);
  }
  return data;
}
function SignalMeters({ active, publish }) {
  const [channels, setChannels] = useState([]);
  useEffect(() => {
    let current = true, timer;
    function update(values) {
      setChannels(values);
      publish(values);
    }
    async function refresh() {
      let values = [];
      try {
        if (!document.hidden) values = (await api("meters")).channels ?? [];
      } catch {
        // Clear stale readings while USB or the network is unavailable.
      }
      if (!current) return;
      update(values);
      timer = setTimeout(refresh, document.hidden ? 500 : 100);
    }
    if (active) refresh();
    else update([]);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, publish]);

  return <div className="signal-meters" aria-label="Quad Cortex USB signal levels">
    {[["IN", meterReading(channels[0], channels[1]), "USB 1/2 DI"],
      ["OUT", meterReading(channels[2], channels[3]), "USB 3/4 Wet"]].map(([label, reading, source]) => (
      <div className="signal-line" key={label} title={source}>
        <span>{label}</span>
        <MeterTrack reading={reading} />
        <span className={reading?.clip ? "signal-clip" : ""}>
          {reading?.clip ? "CLIP" : reading && reading.db > -60 ? reading.db.toFixed(1) + " dBFS" : "-"}
        </span>
      </div>
    ))}
  </div>;
}
function Modal({ title, close, children }) {
  return (
    <div className="shade" onClick={close}>
      <section
        className="dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        <div className="actions">
          <button onClick={close}>닫기</button>
        </div>
      </section>
    </div>
  );
}
function Knob({ p, scene, commit, assign, busy, disabled, readOnly }) {
  const current = p.values[p.assigned ? scene : 0];
  const [preview, setPreview] = useState(null),
    gesture = useRef(null);
  useEffect(() => () => clearTimeout(gesture.current?.timer), []);
  const value = preview ?? current ?? 0;
  function start(e) {
    if (busy || readOnly || !e.isPrimary || e.button!==0 || current == null || gesture.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = {
      y: e.clientY,
      dragThreshold: e.pointerType === "touch" ? 9 : 4,
      base: current,
      value: current,
      id: e.pointerId,
      last: performance.now(),
    };
    gesture.current = g;
    g.timer = setTimeout(() => {
      g.held = true;
      assign();
    }, 550);
  }
  function move(e) {
    const g = gesture.current;
    if (!g || g.held || g.id !== e.pointerId) return;
    const delta = g.y - e.clientY;
    if (Math.abs(delta) < g.dragThreshold && !g.moved) return;
    clearTimeout(g.timer);
    g.moved = true;
    g.value = Math.max(0, Math.min(1, g.base + delta / 150));
    if (p.steps > 1)
      g.value = Math.round(g.value * (p.steps - 1)) / (p.steps - 1);
    setPreview(g.value);
    if (performance.now() - g.last >= 55) {
      g.last = performance.now();
      commit(g.value);
    }
  }
  async function end(cancel) {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (!cancel && !g.held) {
      if (g.moved) await commit(g.value);
      else if (p.steps === 2) await commit(value > 0.5 ? 0 : 1);
    }
    if (!gesture.current) setPreview(null);
  }
  const real = p.normalized
    ? value * 100
    : p.min + (p.max - p.min) * Math.pow(value, p.exponent ?? 1);
  const formatted = p.pan ? (Math.abs(value-.5)<.005?"C":(value<.5?"L ":"R ")+Math.round(Math.abs(value-.5)*200)) : p.level && value < .01 ? "Off" :
    p.options[Math.round(value * (p.options.length - 1))] ??
    (p.steps > 1
      ? String(Math.round(value * (p.steps - 1)) + 1)
      : real.toFixed(p.integer ? 0 : 1) + " " + (p.normalized ? "%" : p.unit));
  return (
    <button
      className="param"
      style={{"--sweep":value*270+"deg"}}
      disabled={disabled || readOnly}
      aria-label={p.name + " " + formatted}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={() => end(false)}
      onPointerCancel={() => end(true)}
      onKeyDown={(e) => {
        if (busy || readOnly) return;
        if (e.key === "Enter" && !e.repeat) assign();
        if (["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          commit(
            Math.max(
              0,
              Math.min(
                1,
                value +
                  (e.key === "ArrowUp" ? 1 : -1) /
                    (p.steps > 1 ? p.steps - 1 : 100),
              ),
            ),
          );
        }
      }}
    >
      <small>
        {p.name}{p.assigned && <SceneMark scene={scene}/>}
      </small>
      <i className="dial" style={{ "--angle": value * 270 - 135 + "deg" }} />
      <output>{current == null ? "—" : formatted}</output>
    </button>
  );
}
function BlockParameter(props) {
  const { p } = props;
  if (["comboBox", "switch", "toggleButton"].includes(p.type) ||
      (!p.type && (p.steps === 2 || p.options?.length > 2))) {
    return <ChoiceParameter {...props} />;
  }
  return <Knob {...props} />;
}
function isInactive(p, params, scene) {
  const trigger = p.toggleOn ?? p.toggleOff;
  if (trigger == null) return false;
  const control = params.find((x) => x.index === Number(trigger));
  if (!control) return false;
  const on = control.values[control.assigned ? scene : 0] >= 0.5;
  return p.toggleOn != null ? !on : on;
}
const gigColors = [
  "#ff2727",
  "#0a74e0",
  "#ffd236",
  "#ff02c2",
  "#45f862",
  "#ff7000",
  "#6954ff",
  "#00ffdd",
];
const gigPalette = { "#ff02c2": "#e44a5d" };
const gigShades = {
  "#ff2727": "#2a1414",
  "#0a74e0": "#111c26",
  "#ffd236": "#2a1b10",
  "#45f862": "#17291a",
  "#ff7000": "#2a2515",
  "#6954ff": "#1b182a",
  "#00ffdd": "#102a26",
};
const nativeOrder = [
  "Plugins",
  "Amp",
  "Neural Capture",
  "Cab",
  "Overdrive",
  "Delay",
  "Reverb",
  "Compressor",
  "Pitch",
  "Modulation",
  "Morph",
  "Synth",
  "Filter",
  "Equalizer",
  "IRLoaders",
  "Wah",
  "FX Loop",
  "Loopers",
  "Utility",
];
const nameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
const byName = (a, b) => nameCollator.compare(a || "", b || "");
function categoryRank(category) {
  const index = nativeOrder.indexOf(family(category));
  return index < 0 ? nativeOrder.length : index;
}

function PagedRows({ rows, render, listKey }) {
  return <ScrollPage key={listKey} rows={rows} render={render} />;
}
function ScrollPage({ rows, render }) {
  const [limit, more] = useState(80),
    end = useRef(null);
  useEffect(() => {
    if (!end.current || limit >= rows.length) return;
    const target = end.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          more((n) => Math.min(rows.length, n + 80));
        }
      },
      { root: target.closest(".models"), rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [limit, rows.length]);
  return (
    <>
      {rows.slice(0, limit).map(render)}
      {limit < rows.length && (
        <div ref={end} className="scroll-end" aria-hidden="true" />
      )}
    </>
  );
}

const captureTypes = {
  1: "Amp",
  2: "Combo Amp",
  3: "Amp + Cab",
  5: "Pedal",
  6: "Fuzz",
  7: "Compressor",
  8: "Overdrive",
};
const sortFields = {
  name: "Name",
  date: "Date Added",
  author: "Author",
  instrument: "Preferred Instrument",
  device: "Capture Type",
  gain: "Gain",
};
function CaptureBrowser({ captures, error, retry, render }) {
  const [layout, setLayout] = useState(null),
    [layoutError, setLayoutError] = useState(""),
    [attempt, reload] = useState(0);
  const [tab, setTab] = useState("Folder"),
    [folder, setFolder] = useState(""),
    [query, search] = useState("");
  const [sort, setSort] = useState("name"),
    [desc, reverse] = useState(false),
    [options, showOptions] = useState(""),
    [type, filterType] = useState(""),
    [version, filterVersion] = useState("");
  useEffect(() => {
    let valid = true;
    setLayoutError("");
    api("capture-layout", attempt ? { refresh: true } : {})
      .then((v) => {
        if (valid) setLayout(v);
      })
      .catch((e) => {
        if (valid) setLayoutError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [attempt]);
  const folders = layout?.folders || [],
    current = folders.find((f) => f.key === folder);
  const roots = folders
    .filter((f) => f.parent === "local_nc_root")
    .sort((a, b) => {
      const rank = [
        "Factory Captures V1",
        "Factory Captures V2",
        "My Captures",
        "Downloads",
        "Recent",
        "Favorites",
      ];
      const idx = (f) => (rank.includes(f.name) ? rank.indexOf(f.name) : 99);
      return idx(a) - idx(b) || byName(a.name, b.name);
    });
  const children = folders
    .filter((f) => f.parent === folder)
    .sort((a, b) => byName(a.name, b.name));
  const rows = React.useMemo(() => {
    const allowed =
      tab === "Folder" && current ? new Set(current.members || []) : null;
    const pins = new Set(layout?.pinned || []),
      needle = query.trim().toLowerCase();
    return (captures || [])
      .filter(
        (m) =>
          (!allowed || allowed.has(m.capture)) &&
          (!type || m.device === +type) &&
          (!version || m.version === +version) &&
          (!needle ||
            [m.name, m.author].some((t) => t?.toLowerCase().includes(needle))),
      )
      .map((m) => ({ ...m, pinned: pins.has(m.capture) }))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
        let order =
          sort === "device"
            ? byName(captureTypes[a.device], captureTypes[b.device])
            : ["gain", "date", "instrument"].includes(sort)
              ? (a[sort] || 0) - (b[sort] || 0)
              : byName(a[sort], b[sort]);
        return (
          (desc ? -1 : 1) * (order || byName(a.name, b.name)) ||
          byName(a.capture, b.capture)
        );
      });
  }, [captures, layout, current, tab, query, type, version, sort, desc]);
  const key = [tab, folder, query, type, version, sort, desc].join("|");
  const results = (
    <>
      {current?.members === null && tab === "Folder" ? (
        <small>본체 목록 미확인</small>
      ) : !captures ? null : rows.length ? (
        <PagedRows listKey={key} rows={rows} render={render} />
      ) : (
        <small>항목 없음</small>
      )}
    </>
  );
  const contents = (
    <>
      {children.map((f) => (
        <button
          className="folder-btn"
          key={f.key}
          onClick={() => setFolder(f.key)}
        >
          {f.name}
          <span>›</span>
        </button>
      ))}
      {results}
    </>
  );
  return (
    <div className="capture-browser">
      <div className="capture-tools">
        <input
          aria-label="캡처 검색"
          placeholder="Search"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        <button
          aria-label="캡처 필터"
          onClick={() => showOptions(options === "filter" ? "" : "filter")}
        >
          ⚲
        </button>
        <button
          aria-label="캡처 정렬"
          onClick={() => showOptions(options === "sort" ? "" : "sort")}
        >
          ≡↓
        </button>
      </div>
      {options === "sort" && (
        <div className="capture-tools">
          <select
            aria-label="정렬 기준"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              reverse(e.target.value === "date");
            }}
          >
            {Object.entries(sortFields).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button aria-label="정렬 방향" onClick={() => reverse(!desc)}>
            {desc ? "↓" : "↑"}
          </button>
        </div>
      )}
      {options === "filter" && (
        <div className="capture-tools">
          <select
            aria-label="캡처 유형"
            value={type}
            onChange={(e) => filterType(e.target.value)}
          >
            <option value="">All types</option>
            {Object.entries(captureTypes).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="캡처 버전"
            value={version}
            onChange={(e) => filterVersion(e.target.value)}
          >
            <option value="">All versions</option>
            <option value="1">V1</option>
            <option value="2">V2</option>
          </select>
        </div>
      )}
      <div className="capture-tabs">
        {["Folder", "Library"].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {error && <button onClick={retry}>{error} · 다시 읽기</button>}
      {tab === "Folder" && options === "filter" && (
        <button
          onClick={() => {
            reload(attempt + 1);
            retry();
          }}
        >
          본체 목록 다시 읽기
        </button>
      )}
      {layoutError && (
        <button onClick={() => reload(attempt + 1)}>
          {layoutError} · 폴더 다시 읽기
        </button>
      )}
      {tab === "Library" || (!current && (query || type || version)) ? (
        results
      ) : !layout ? (
        <small>폴더 읽는 중…</small>
      ) : current && current.parent !== "local_nc_root" ? (
        <>
          <button
            className="folder-btn"
            onClick={() => setFolder(current.parent)}
          >
            ‹　{current.name}
          </button>
          {contents}
        </>
      ) : (
        roots.map((f) => (
          <React.Fragment key={f.key}>
            <button
              className="folder-btn"
              aria-expanded={folder === f.key}
              onClick={() => setFolder(folder === f.key ? "" : f.key)}
            >
              {f.name.toUpperCase()}
              <span>{folder === f.key ? "⌃" : "⌄"}</span>
            </button>
            {folder === f.key && (
              <div className="capture-children">{contents}</div>
            )}
          </React.Fragment>
        ))
      )}
    </div>
  );
}

function App() {
  const [libraryOpen,setLibraryOpen]=useState(false);
  const libraryToggle=useRef(null);
  useEffect(()=>{
    const portrait=window.matchMedia("(orientation: portrait) and (max-width: 1024px)");
    const reset=()=>setLibraryOpen(false);
    portrait.addEventListener("change",reset);
    return ()=>portrait.removeEventListener("change",reset);
  },[]);
  useEffect(()=>{
    if(!libraryOpen)return;
    function escape(event){
      if(event.key==="Escape"){
        setLibraryOpen(false);
        libraryToggle.current?.focus();
      }
    }
    function outside(event){
      if(!event.target.closest("#block-library, .library-toggle, .library-backdrop"))setLibraryOpen(false);
    }
    document.addEventListener("keydown",escape);
    document.addEventListener("pointerdown",outside,true);
    return ()=>{
      document.removeEventListener("keydown",escape);
      document.removeEventListener("pointerdown",outside,true);
    };
  },[libraryOpen]);
  const [signalChannels, setSignalChannels] = useState([]);
  const [liveState, S] = useState(null),
    [preview, setPreview] = useState(null),
    [paramsOpen, setParamsOpen] = useState(false),
    [lib, L] = useState({ models: [], inputs: {}, outputs: {} }),
    [paused, setPaused] = useState(false),
    [captures, setCaptures] = useState(null),
    [filter, setFilter] = useState(""),
    [product, setProduct] = useState(""),
    [captureError, setCaptureError] = useState(""),
    [retry, setRetry] = useState(0),
    [picked, P] = useState(null),
    [category, C] = useState(""),
    [page, G] = useState(0),
    [modal, M] = useState(null),
    [slots, Q] = useState([]),
    [bank, K] = useState(0),
    [search, F] = useState(""),
    [pendingScene, J] = useState(null),
    [busy, B] = useState(false),
    [msg, T] = useState(""),
    [gig, H] = useState(true),
    [drag, D] = useState(null);
  const [cpu,setCpu] = useState(null), [overlay,setOverlay] = useState(false);
  const s = liveState ?? (paused ? preview : null);
  const stream = useRef({ writing: false, pending: null }),
    history = useRef({ undo: [], redo: [] });
  const mode = useRef(null);
  const latest = useRef(null),
    lock = useRef(false),
    epoch = useRef(0),
    pointer = useRef(null),
    sceneNext = useRef(null),
    reading = useRef(false),
    modalRef = useRef(null);
  modalRef.current = modal;
  function accept(next) {
    if (latest.current?.identity !== next.identity) {
      P(null);
      C("");
      G(0);
      history.current = { undo: [], redo: [] };
    }
    latest.current = next;
    S(next);
  }
  async function refresh(force = false) {
    if (
      lock.current ||
      reading.current ||
      (!force && (document.hidden || pointer.current || modalRef.current))
    )
      return;
    const version = epoch.current;
    reading.current = true;
    try {
      const prevState = latest.current;
      const reply = await api("live", {
        known: prevState?.rev,
        knownPreview: mode.current === "browse" && !force,
      });
      if (reply.paused) {
        if (reply.preview) setPreview(reply.preview);
        if (mode.current !== "browse") {
          L(await api("library"));
          setCaptures(null);
          S(null);
          P(null);
          latest.current = null;
          setPaused(true);
          mode.current = "browse";
          T("");
        }
        return;
      }
      setPaused(false);
      mode.current = "live";
      const next = reply.unchanged
        ? { ...prevState, scene: reply.scene, dirty: reply.dirty }
        : reply;
      if (!latest.current || force) L(await api("library"));
      if (version === epoch.current) {
        const prev = latest.current;
        if (
          !prev ||
          prev.rev !== next.rev ||
          prev.scene !== next.scene ||
          prev.dirty !== next.dirty
        )
          accept(next);
        if (!prev || force) T("");
      }
    } catch (e) {
      if (version === epoch.current) {
        T(e.message);
        latest.current = null;
        Q([]);
        S(null);
      }
    } finally {
      reading.current = false;
    }
  }
  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(), 850),
      wake = () => refresh(true);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  useEffect(() => {
    setFilter("");
  }, [category]);
  useEffect(() => {
    if (category !== "Neural Capture" || captures !== null) return;
    let valid = true;
    setCaptureError("");
    api("captures")
      .then((v) => {
        if (valid) setCaptures(v);
      })
      .catch((e) => {
        if (valid) setCaptureError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [category, captures, retry, paused]);
  async function toggleUsb() {
    if (lock.current) return;
    lock.current = true;
    epoch.current++;
    B(true);
    try {
      if (paused) {
        const state = await api("connect");
        L(await api("library"));
        accept(state);
        setPaused(false);
        mode.current = "live";
        T("");
      } else {
        if (!(await api("release")).paused) return;
        setPreview(latest.current);
        latest.current = null;
        S(null);
        P(null);
        setPaused(true);
        mode.current = "browse";
        T("");
      }
      setCaptures(null);
      Q([]);
    } catch (e) {
      T(e.message);
    } finally {
      lock.current = false;
      B(false);
    }
  }
  async function run(a, d = {}, done) {
    if (lock.current) {
      if (a === "scene") {
        sceneNext.current = {
          target: d.target,
          identity: latest.current?.identity,
        };
        J(d.target);
      }
      return false;
    }
    const before = latest.current;
    if (!before) return;
    lock.current = true;
    epoch.current++;
    B(true);
    if (a === "scene") J(d.target);
    try {
      const result = await api(a, {
        rev: before.rev,
        identity: before.identity,
        scene: before.scene,
        ...d,
      });
      if (a === "scene") accept({ ...before, scene: result.scene });
      else accept(result);
      if (a === "save") Q([]);
      T(result.savedName ? "저장됨 · " + result.savedName : "");
      done?.(result);
      return true;
    } catch (e) {
      T(e.message);
      try {
        accept(await api("live"));
      } catch {
        latest.current = null;
        Q([]);
        S(null);
      }
    } finally {
      lock.current = false;
      B(false);
      const next = sceneNext.current;
      sceneNext.current = null;
      if (
        next &&
        next.identity === latest.current?.identity &&
        next.target !== latest.current?.scene
      )
        run("scene", { target: next.target });
      else J(null);
    }
  }
  async function writeKnob(p, value) {
    const queue = stream.current;
    queue.pending = {
      row: route?.row ?? active.row,
      ...(route ? {part:route.part} : {col:active.col,model:active.model}),
      index: p.index,
      value,
      identity: s.identity,
      scene: s.scene,
    };
    if (queue.writing) return queue.writing;
    queue.writing = (async () => {
      await Promise.resolve();
      try {
        while (queue.pending) {
          const n = queue.pending;
          queue.pending = null;
          const now = latest.current;
          const b = now?.blocks.find((x) => x.row === n.row && x.col === n.col);
          if (
            now?.identity !== n.identity ||
            now?.scene !== n.scene ||
            (!n.part && b?.model !== n.model)
          )
            break;
          if (
            Math.abs(
              ((n.part ? now.lanes[n.row].controls[n.part] : b.params).find(p=>p.index===n.index)?.values[
                p.assigned ? n.scene : 0
              ] ?? -1) - n.value,
            ) < 1e-6
          )
            continue;
          if (!(await remember(n.part ? "route-edit" : "edit", n))) break;
        }
      } finally {
        queue.pending = null;
        queue.writing = null;
      }
    })();
    return queue.writing;
  }
  async function directory(mode) {
    if (!latest.current && mode !== "presets") return;
    F("");
    M({ kind: mode, loading: true });
    try {
      const entries =
        mode === "presets" && slots.length ? slots : await api("presets");
      Q(entries);
      K(
        Math.floor(
          (entries.find((x) => x.name === s?.name)?.slot ??
            entries[0]?.slot ??
            0) / 8,
        ),
      );
      M((open) => (open?.kind === mode ? { ...open, loading: false } : open));
    } catch (e) {
      T(e.message);
      M(null);
    }
  }
  function recall(entry) {
    if (!s || !entry) return;
    if (
      s.dirty &&
      !confirm("미저장 편집을 버리고 " + entry.name + "로 전환할까요?")
    )
      return;
    run("recall", { ...entry, discard: s.dirty }, () => {
      M(null);
      P(null);
      C("");
      G(0);
    });
  }
  async function adjacent(offset) {
    try {
      const entries = slots.length ? slots : await api("presets");
      Q(entries);
      const i = entries.findIndex((x) => x.name === s?.name);
      if (i < 0) {
        M({ kind: "presets" });
        return;
      }
      recall(entries[i + offset]);
    } catch (e) {
      T(e.message);
    }
  }
  const at = (r, c) => s?.blocks.find((b) => b.row === r && b.col === c),
    active = picked && at(picked.row, picked.col);
  function reveal(block) {
    const plugin =
      block?.plugin || lib.models.find((m) => m.model === block?.model)?.plugin;
    C(plugin ? "Plugins" : block?.category || "");
    if (plugin) setProduct(plugin);
  }
  const route = picked?.part && s ? picked : null;
  const editingBranch = route?.part === "start" || route?.part === "end";
  useEffect(()=>{
    if (!editingBranch) return;
    function dismiss(event) {
      if (event.isPrimary && event.button === 0 &&
          !event.target.closest(".route-node, .branch-panel, .param-options")) P(null);
    }
    document.addEventListener("pointerdown", dismiss, true);
    return ()=>document.removeEventListener("pointerdown", dismiss, true);
  },[editingBranch]);
  const openRoute = useCallback((row,part)=>{
    P({row,part}); setParamsOpen(true); C(""); G(0);
    if ((part==="input" || part==="output") && !window.matchMedia("(orientation: portrait) and (max-width: 1024px)").matches)
      setLibraryOpen(true);
  },[]);
  function select(row, col) {
    const block = at(row, col);
    P({ row, col });
    setParamsOpen(!!block);
    if (!block) setLibraryOpen(true);
    reveal(block);
    G(0);
  }
  function remember(action, d, done) {
    const selection = picked;
    return run(action, d, (result) => {
      history.current.undo.push(selection);
      history.current.redo = [];
      done?.(result);
    });
  }
  function travel(action) {
    const h = history.current,
      source = h[action],
      other = h[action === "undo" ? "redo" : "undo"];
    run(action, {}, (result) => {
      other.push(picked);
      const old = source.pop();
      if (old) {
        const b = result.blocks.find(
          (b) => b.row === old.row && b.col === old.col,
        );
        P(old.part || b ? old : null);
        reveal(b);
      } else {
        P(null);
        C("");
      }
      G(0);
    });
  }
  function blockAction(a, d = {}, done) {
    if (active) remember(a, { row: active.row, col: active.col, ...d }, done);
  }
  function gesture(e, src) {
    if (!s || busy || pointer.current) return;
    const g = { src, x: e.clientX, y: e.clientY, id: e.pointerId };
    pointer.current = g;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    function target(ev) {
      return document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-cell]");
    }
    function move(ev) {
      if (ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x,
        dy = ev.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 7) return;
      if (!g.moved && libraryOpen && src.row==null) {
        if (ev.pointerType==="touch" && Math.abs(dy)>Math.abs(dx)) return;
        setLibraryOpen(false);
      }
      g.moved = true;
      D({
        x: ev.clientX,
        y: ev.clientY,
        category: src.category,
        cell: target(ev)?.dataset.cell,
      });
    }
    function stop(ev) {
      if (ev.pointerId !== g.id) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
      pointer.current = null;
      D(null);
      if (ev.type === "pointercancel") return;
      if (g.moved) {
        const cell = target(ev);
        if (!cell) return;
        const [row, col] = cell.dataset.cell.split(":").map(Number);
        if (src.row == null) remember("place", { row, col, ...placement(src) });
        else if (src.row !== row || src.col !== col)
          remember(
            "move",
            { row: src.row, col: src.col, toRow: row, toCol: col },
            () => {
              P({ row, col });
              reveal(src);
              G(0);
            },
          );
      } else if (src.row != null) select(src.row, src.col);
      else if (picked)
        remember("place", { ...picked, ...placement(src) }, () => {
          setLibraryOpen(false);
          reveal(src);
          G(0);
        });
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }
  const scenes = Array.from(letters, (letter, i) => (
    <button
      key={letter}
      className={"scene " + ((pendingScene ?? s?.scene) === i ? "active" : "")}
      aria-pressed={s?.scene === i}
      disabled={!liveState}
      onClick={() => run("scene", { target: i })}
    >
      {letter}
    </button>
  ));
  const close = () => M(null),
    categories = [
      ...new Set([
        ...lib.models.filter((m) => !m.plugin).map((m) => family(m.category)),
        ...(lib.models.some((m) => m.plugin) ? ["Plugins"] : []),
      ]),
    ]
      .filter((c) => !/(deprecated|internal|^splitter$|^mixer$)/i.test(c))
      .sort((a, b) => {
        return categoryRank(a) - categoryRank(b) || a.localeCompare(b);
      });
  const plugins = [
    ...new Set(lib.models.map((m) => m.plugin).filter(Boolean)),
  ].sort((a, b) => (pluginNames[a] || a).localeCompare(pluginNames[b] || b));
  const pluginSections = lib.access
    ? [
        {
          title: "OWNED PLUGINS",
          ids: plugins.filter((id) => lib.access.owned.includes(id)),
        },
        {
          title: "ALL PLUGINS",
          ids: plugins.filter((id) => !lib.access.owned.includes(id)),
          locked: true,
        },
      ]
    : [{ title: "ALL PLUGINS", ids: plugins }];
  const items = React.useMemo(() => {
    let entries =
      category === "Neural Capture"
        ? captures || []
        : category === "Plugins"
          ? lib.models.filter((m) => m.plugin === product)
          : lib.models.filter(
              (m) => !m.plugin && family(m.category) === family(category),
            );
    const needle = filter.trim().toLowerCase();
    return entries
      .filter(
        (m) =>
          !needle ||
          [m.name, m.author].some((t) => t?.toLowerCase().includes(needle)),
      )
      .sort(
        (a, b) =>
          (category === "Plugins"
            ? categoryRank(a.category) - categoryRank(b.category)
            : 0) || byName(a.name, b.name),
      );
  }, [category, captures, lib, product, filter]);
  const modelRow = (m) => (
    <button
      key={m.capture || m.model}
      className={
        "entry model " +
        (active?.model === m.model &&
        (!m.capture || m.capture === active.capture)
          ? "on"
          : "")
      }
      onPointerDown={(e) => gesture(e, m)}
      onClick={(e) => {
        if (e.detail === 0 && picked)
          remember("place", { ...picked, ...placement(m) },()=>setLibraryOpen(false));
      }}
    >
      {m.capture ? (
        m.pinned && (
          <span className="pin" aria-label="Pinned">
            ◆
          </span>
        )
      ) : (
        <Icon category={m.category} name={m.name} plugin={m.plugin} />
      )}
      <span>
        {m.name}
        {m.capture && (
          <small>
            V{m.version} · {m.author}
          </small>
        )}
      </span>
    </button>
  );
  const modelList = (
    <>
      {(category !== "Plugins" || product) && (
        <input
          className="libsearch"
          aria-label="라이브러리 검색"
          placeholder="Search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      )}
      {category === "Neural Capture" &&
        captures === null &&
        (captureError ? (
          <button onClick={() => setRetry(retry + 1)}>
            {captureError} · 다시 읽기
          </button>
        ) : (
          <p>캡처 목록 읽는 중…</p>
        ))}
      {((category === "Neural Capture" && captures) ||
        (category === "Plugins" && product)) && <small>{items.length}개</small>}
      <PagedRows
        rows={items}
        render={modelRow}
        listKey={[category, product, filter].join("|")}
      />
    </>
  );
  function save(ev) {
    ev.preventDefault();
    const f = new FormData(ev.target),
      slot = Number(f.get("slot")) - 1,
      name = f.get("name").trim(),
      previous = slots.find((x) => x.slot === slot)?.name || "";
    if (
      previous &&
      !confirm(slotName(slot) + " " + previous + "에 덮어쓸까요?")
    )
      return;
    run("save", { slot, name, previous }, close);
  }
  return (
    <div className="shell">
      <header>
        <div className="desk-heading">
          <strong>⌁　Quad Desk</strong>
          <span className="desk-status" role="status">
            <span data-connected={!!liveState}>{paused ? "USB 대기 · 읽기 전용" : liveState ? "USB 연결됨" : msg ? "USB 연결 확인 필요" : "USB 연결 중…"}</span>
            {busy ? " · 처리 중…" : msg && " · " + msg}
          </span>
        </div>
        <nav>
          <button className={!gig ? "current" : ""} onClick={() => H(false)}>
            GRID
          </button>
          <button onClick={() => directory("presets")}>DIRECTORY</button>
          <button className={gig ? "current" : ""} onClick={() => H(!gig)}>
            GIG VIEW
          </button>
        </nav>
        <SignalMeters active={!!liveState && !paused} publish={setSignalChannels} />
        <DeviceToolbar api={api} online={!!liveState && !paused} busy={busy} revision={s?.rev} travel={travel} report={T}/>
        <button
          disabled={busy}
          onClick={toggleUsb}
          title="Cortex Control과 USB 사용 전환"
        >
          {paused ? "USB 연결" : "USB 해제"}
        </button>
        <button
          aria-label="본체 다시 읽기"
          onClick={() => {
            Q([]);
            setCaptures(null);
            refresh(true);
          }}
        >
          ↻
        </button>
      </header>
      <div className={"workspace"+(libraryOpen?" library-open":"")}>
        <button ref={libraryToggle} className="library-toggle" aria-controls="block-library"
          aria-expanded={libraryOpen} aria-label={libraryOpen?"라이브러리 닫기":"라이브러리 열기"}
          onClick={()=>setLibraryOpen(v=>!v)}><span aria-hidden="true"/></button>
        {libraryOpen && <div className="library-backdrop" onClick={()=>{setLibraryOpen(false);libraryToggle.current?.focus()}}/>}
        {
          <aside id="block-library" aria-label="블록 라이브러리" className={category && !route ? "expanded" : ""}>
            <div className="rail">
                {categories.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={c}
                    className={family(category) === c ? "chosen" : ""}
                    onClick={() => {if(route)P(null); C(c); setLibraryOpen(true)}}
                  >
                    <Icon category={c} rail />
                  </button>
                ))}
              </div>
            {route && ["input","output"].includes(route.part) ?
              <PortList route={route} lane={s.lanes[route.row]} lib={lib} disabled={busy || paused}
                back={()=>P(null)} choose={value=>remember(route.part,{row:route.row,value},()=>setLibraryOpen(false))}/> :
            <div className="models">
              {category ? (
                <>
                  <button onClick={() => C("")}>‹　{family(category)}</button>
                  {category === "Plugins" ? (
                    pluginSections.map(({ title, ids, locked }) => (
                      <details className="plugin-section" key={title} open>
                        <summary title={lib.access?.source}>{title}</summary>
                        {ids.map((id) => (
                          <section className="plugin-group" key={id}>
                            <button
                              className="entry product"
                              aria-expanded={product === id}
                              onClick={() => {
                                setProduct(product === id ? "" : id);
                                setFilter("");
                              }}
                            >
                              {locked && (
                                <span aria-label="마지막 확인 시 미보유">
                                  🔒
                                </span>
                              )}
                              <span aria-hidden="true">
                                {product === id ? "▾" : "▸"}
                              </span>
                              {pluginNames[id] || "Plugin " + id}
                            </button>
                            {product === id && (
                              <div className="plugin-children">{modelList}</div>
                            )}
                          </section>
                        ))}
                      </details>
                    ))
                  ) : category === "Neural Capture" ? (
                    <CaptureBrowser
                      captures={captures}
                      error={captureError}
                      retry={() => {
                        setCaptures(null);
                        setRetry(retry + 1);
                      }}
                      render={modelRow}
                    />
                  ) : (
                    modelList
                  )}
                </>
              ) : (
                categories.map((c) => (
                  <button className="entry" key={c} onClick={() => C(c)}>
                    <Icon category={c} />
                    {c}
                  </button>
                ))
              )}
            </div>}
          </aside>
        }
        <main onClick={event=>{
          if (!active) return;
          const target=event.target;
          const gridBackground=target.closest(".scroll") && !target.closest("button");
          if (target===event.currentTarget || gridBackground) {
            P(null);
            setParamsOpen(false);
            reveal(null);
            G(0);
          }
        }}>
          <div className="bar">
            <button
              disabled={!s || busy}
              aria-label="이전 프리셋"
              onClick={() => adjacent(-1)}
            >
              ‹
            </button>
            <button
              disabled={!s || busy}
              aria-label="다음 프리셋"
              onClick={() => adjacent(1)}
            >
              ›
            </button>
            <button className="preset" onClick={() => directory("presets")}>
              {slots.some((x) => x.name === s?.name)
                ? slotName(slots.find((x) => x.name === s.name).slot) + "　"
                : ""}
              {s?.name || "Quad Cortex"}
              {s?.dirty ? "*" : ""}
            </button>
            <button
              disabled={!s || busy}
              aria-label="My Presets에 저장"
              onClick={() => directory("save")}
            >
              ▣
            </button>
            {scenes}
          </div>
          {
            <>
              <div className="scroll">
                <div className="board">
                  {s && <GridRouting key={s.identity+"-"+s.rev+"-"+s.scene} state={s} disabled={busy || paused}
                    selection={route} open={openRoute}
                    commit={points=>remember("split",points)} />}
                  {s?.lanes.map((lane, row) => (
                    <React.Fragment key={row}>
                      <Port signalChannels={signalChannels} side="input" row={row} value={lane.input} name={lib.inputs[lane.input]} indicator={lane.input!==0 && (lane.gate?.[s.scene] ?? lane.gate?.[0])}
                        branched={s.splits.some(v=>row===v.row+1 && v.start>=0)}
                        open={()=>openRoute(row,"input")} />
                      {Array.from({ length: 8 }, (_, col) => {
                        const b = at(row, col),
                          selected = picked?.row === row && picked?.col === col,
                          cell = row + ":" + col;
                        return (
                          <div
                            key={col}
                            data-cell={cell}
                            className={
                              "cell " +
                              (selected ? "target " : "") +
                              (drag?.cell === cell ? "drop" : "")
                            }
                          >
                            {b ? (
                              <>
                                <button
                                  className={
                                    "tile " +
                                    (selected ? "selected " : "") +
                                    (b.bypass[s.scene] ? "muted" : "")
                                  }
                                  title={b.name}
                                  aria-label={b.name}
                                  aria-pressed={selected}
                                  onPointerDown={(e) => gesture(e, b)}
                                  onClick={(e) => {
                                    if (e.detail === 0) select(row, col);
                                  }}
                                >
                                  {overlay && cpu?.columns?.[row]?.[col] != null && <span className="cpu-meter" title={cpu.columns[row][col].toFixed(1)+"%"}><i style={{width:Math.min(100,cpu.columns[row][col])+"%"}}/></span>}
                                  <Icon
                                    selected={selected}
                                    category={b.category}
                                    name={b.name}
                                    plugin={
                                      lib.models.find(
                                        (m) => m.model === b.model,
                                      )?.plugin
                                    }
                                  />
                                </button>
                                <button
                                  className="del"
                                  aria-label={b.name + " 삭제"}
                                  onClick={() =>
                                    remember("delete", { row, col }, () => {
                                      P(null);
                                      C("");
                                    })
                                  }
                                >
                                  ×
                                </button>
                              </>
                            ) : (
                              <button
                                className="empty"
                                aria-label={
                                  row + 1 + "행 " + (col + 1) + "열 추가"
                                }
                                onClick={() => select(row, col)}
                              >
                                ＋
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <Port signalChannels={signalChannels} side="output" row={row} value={lane.output} name={lib.outputs[lane.output]} indicator={lane.output!==0 && (lane.mute?.[s.scene] ?? lane.mute?.[0])}
                        branched={s.splits.some(v=>row===v.row+1 && v.end>=0)}
                        open={()=>openRoute(row,"output")} />
                    </React.Fragment>
                  ))}
                </div>
              </div>
              {route && (!gig || paramsOpen) && <RoutePanel key={route.row+route.part} route={route} state={s}
                open={openRoute} busy={busy} paused={paused} commit={writeKnob}
                assign={p=>remember("route-assign",{...route,index:p.index,rev:s.rev,scene:s.scene})}/>}
              {active && (!gig || paramsOpen) && (
                <section
                  className="panel"
                  style={{ "--c": style(active.category)[2] }}
                >
                  <div className="panelhead">
                    <span>{active.category}</span>
                    <b className="grow" style={{ color: "var(--c)" }}>
                      {active.name}
                    </b>
                    {Array.from(
                      { length: Math.ceil(active.params.length / 10) },
                      (_, i) => (
                        <button
                          key={i}
                          className={page === i ? "on" : ""}
                          onClick={() => G(i)}
                        >
                          {i + 1}
                        </button>
                      ),
                    )}
                    <button
                      aria-label="바이패스"
                      aria-pressed={active.bypass[s.scene]}
                      onClick={() => blockAction("bypass")}
                    >
                      ⏻
                    </button>
                  </div>
                  <div
                    className={
                      "params " + (active.bypass[s.scene] ? "muted" : "")
                    }
                  >
                    {active.params.slice(page * 10, page * 10 + 10).map((p) => (
                      <BlockParameter
                        key={[
                          s.identity,
                          active.model,
                          active.row,
                          active.col,
                          p.index,
                          s.scene,
                        ].join("-")}
                        p={p}
                        readOnly={paused}
                        disabled={isInactive(p, active.params, s.scene)}
                        scene={s.scene}
                        busy={busy}
                        commit={(value) => writeKnob(p, value)}
                        assign={() => blockAction("assign",{index:p.index,rev:s.rev,scene:s.scene})}
                      />
                    ))}
                  </div>
                </section>
              )}
              {gig && (
                <section className="gig-panel" aria-label="Gig view">
                  <div className="gig-side">
                    <div>Gig view</div>
                    <strong>⊞　SCENE</strong>
                    <button
                      disabled={!active && !route}
                      aria-pressed={paramsOpen}
                      onClick={() => setParamsOpen(!paramsOpen)}
                    >
                      Parameter Editor　◉
                    </button>
                  </div>
                  <div className="gig-scenes">
                    {Array.from(letters, (letter, i) => {
                      const info = s?.sceneInfo?.[i],
                        label =
                          info?.label ||
                          (s?.defaultScene === i
                            ? "Default scene"
                            : "Scene " + letter);
                      const color = info?.color || gigColors[i],
                        activeScene = (pendingScene ?? s?.scene) === i;
                      return (
                        <button
                          key={letter}
                          className={activeScene ? "active" : ""}
                          disabled={!liveState}
                          aria-pressed={activeScene}
                          aria-label={letter + " · " + label}
                          style={{
                            "--scene-color": gigPalette[color] || color,
                            "--scene-shade": gigShades[color],
                          }}
                          onClick={() => run("scene", { target: i })}
                        >
                          <b aria-hidden="true">{letter}</b>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          }
        </main>
      </div>
      <footer>
        <FooterTools report={T} {...{api,s,paused,busy,run,refresh,cpu,setCpu,overlay,setOverlay}} />
        <button className="foot-gig" aria-pressed={gig} onClick={() => H(!gig)}>
          GIG VIEW
        </button>
      </footer>
      {drag && (
        <div className="ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon category={drag.category} />
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              presets: "My Presets",
              save: "My Presets에 저장",
            }[modal.kind]
          }
          close={close}
        >
          {modal.loading && <p role="status">프리셋 목록을 읽는 중…</p>}
          {!modal.loading && modal.kind === "presets" && (
            <>
              <input
                aria-label="프리셋 검색"
                placeholder="Search"
                value={search}
                onChange={(e) => F(e.target.value)}
              />
              <div className="picker">
                <div className="banks">
                  {Array.from({ length: 32 }, (_, i) => (
                    <button
                      key={i}
                      className={i === bank ? "on" : ""}
                      onClick={() => {
                        K(i);
                        F("");
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <div className="directory">
                  {(search
                    ? slots.filter((x) =>
                        x.name.toLowerCase().includes(search.toLowerCase()),
                      )
                    : Array.from(
                        { length: 8 },
                        (_, j) =>
                          slots.find((x) => x.slot === bank * 8 + j) || {
                            slot: bank * 8 + j,
                            name: "",
                          },
                      )
                  ).map((x) => (
                    <button
                      key={x.slot}
                      className={x.name === s?.name ? "on" : ""}
                      disabled={busy || !x.name || paused}
                      onClick={() => recall(x)}
                    >
                      <span className="slotno">{slotName(x.slot)}</span>
                      {x.name || "Unsaved"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {!modal.loading && modal.kind === "save" && (
            <form onSubmit={save}>
              <label>
                이름
                <input name="name" required defaultValue={s?.name} />
              </label>
              <label>
                저장 슬롯
                <select
                  name="slot"
                  defaultValue={
                    (slots.find((x) => x.name === s?.name)?.slot ?? 0) + 1
                  }
                >
                  {Array.from({ length: 256 }, (_, i) => (
                    <option value={i + 1} key={i}>
                      {slotName(i)}　{slots.find((x) => x.slot === i)?.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>저장</button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function PortList({route,lane,lib,disabled,back,choose}){
  const input=route.part==="input";
  const groups=input ? [["Mono",[1,2,4,5,8,9,10,11]],["Stereo",[3,6,12,13]],["Routing",[7,0]]] :
    [["Stereo",[19,1,2,3,22,14,15]],["Mono",[4,5,6,7,8,9,20,21,10,11,12,13]],["Routing",[16,17,18,0]]];
  const ports=lib[route.part+"s"];
  return <div className="models port-list"><button onClick={back}>‹　{route.part.toUpperCase()}</button>
    {groups.map(([name,ids])=><details key={route.part+name} open><summary>{name.toUpperCase()}</summary>
      {ids.filter(id=>ports[id]!=null && !(input && id===7 && route.row<2) && !(!input && route.row>=2 && [16,17,18].includes(id))).map(id=>
        <button key={id} className="entry" aria-pressed={lane[route.part]===id} disabled={disabled}
          onClick={()=>choose(id)}>{id===0?"Not In Use":id===19?"Multiple Outputs":
          portLabel(ports[id]).replace(/^In /,"Input ").replace(/^USB /,input?"USB Input ":"USB Output ").replace(/^(XLR|Out) /,"Output ")}</button>)}
    </details>)}</div>;
}

function GateMeter({row,online}){
  const [value,setValue]=useState(null);
  useEffect(()=>{
    let valid=true,timer;
    async function poll(){
      let next=null;
      if(!document.hidden){
        try{next=(await api("gate-meter",{row})).value ?? null}catch{}
      }
      if(valid){setValue(next);timer=setTimeout(poll,document.hidden?500:80)}
    }
    if(online)poll();else setValue(null);
    return ()=>{valid=false;clearTimeout(timer)};
  },[row,online]);
  const db=value==null?null:(value-1)*40;
  return <div className="param gate-meter">
    <small>GAIN REDUCTION</small>
    <div role="meter" aria-label="Gain reduction" aria-valuemin={-40} aria-valuemax={0}
      aria-valuenow={db??undefined} aria-valuetext={db==null?"—":db.toFixed(1)+" dB"} className="gate-track">
      <i style={{width:(db==null?0:-db/40*100)+"%"}}/>
    </div>
    <output>{db==null?"—":db.toFixed(1)+" dB"}</output>
  </div>;
}

function RoutePanel({route,state,open,busy,paused,commit,assign}){
  const {part,row}=route, params=state.lanes[row].controls?.[part] || [];
  const pair=part==="start" || part==="end";
  const current=p=>p?.values[p.assigned?state.scene:0];
  const type=Math.round((current(params.find(p=>p.name==="TYPE"))??0)*2);
  const gate=params.find(p=>p.name==="BYPASS");
  const split=state.splits.find(v=>v.row===row);
  const inactive=p=> (pair && !(split?.[part]>=0)) || (part==="start" && (
    (p.name==="BALANCE" && type!==0) || (["LEVEL TO A","LEVEL TO B"].includes(p.name) && type!==1) ||
    (["FREQUENCY","MODE"].includes(p.name) && type!==2)));
  return <section className={"panel "+(pair?"branch-panel":"port-panel")} style={{"--c":pair?(part==="start"?"#168bea":"#eb1e9d"):"#ddd"}}>
    <div className="panelhead">{pair?["start","end"].map(k=>
      <button key={k} aria-pressed={part===k} onClick={()=>open(row,k)}>{k==="start"?"Splitter":"Mixer"} {(row+1)+"/"+(row+2)}</button>):
      <span className="grow route-title">{part==="input"?"Input gate control":"Lane output control"} <b>Path {row+1}</b></span>}
      {gate && <button disabled={busy||paused} aria-label="Input gate" aria-pressed={current(gate)<.5} onClick={()=>commit(gate,current(gate)<.5?1:0)}>⏻</button>}
    </div>
    <div className="params">{params.filter(p=>p!==gate).map(p=><React.Fragment key={p.index+"-"+state.scene}>
      {part==="input" && p.name==="INPUT GAIN" && gate && current(gate)<.5 && <GateMeter row={row} online={!paused}/>}
      <BlockParameter
      p={p} pressButton={part==="output" && ["MUTE","SOLO"].includes(p.name)}
      scene={state.scene} readOnly={paused} busy={busy} disabled={paused||inactive(p)}
      commit={value=>commit(p,value)} assign={()=>assign(p)}/></React.Fragment>)}</div>
  </section>;
}
createRoot(document.getElementById("root")).render(<App />);
