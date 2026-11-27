import SaveIcon from "./SaveIcon";
import {modeNames,networkMode} from "./ConnectionChoice";
import {bluetoothMode, bluetoothApi} from "./bleTransport";
import BluetoothRemote from "./BluetoothRemote";
import DeviceSettings from "./DeviceSettings";
import IOSettings from "./IOSettings";
import BlockMenu from "./BlockMenu";
import CabinetPanel from "./CabinetPanel";
import {hidReading, meterReading, MeterTrack, outputReadings, physicalInputs, physicalOutputs} from "./SignalTrack";
import DeviceToolbar from "./DeviceToolbar";
import {GridRouting, Port, portLabel, displayedInput} from "./GridRouting";
import ChoiceParameter, {SceneMark} from "./ChoiceParameter";
import FooterTools from "./FooterTools";
import icons from "./cortex-icons.json";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
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
import pluginNames from "./plugin-names.json";
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
async function api(action, body = {}, onProgress) {
  if (bluetoothMode) return bluetoothApi(action,body,onProgress);
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
  let data;
  const total = Number(response.headers.get("Content-Length"));
  if (onProgress && response.ok && total > 0 && response.body) {
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let received=0, text="";
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      received+=value.byteLength;
      text+=decoder.decode(value,{stream:true});
      onProgress(Math.min(1,received/total));
    }
    data=JSON.parse(text+decoder.decode());
  } else data=await response.json();
  if (!response.ok) {
    if (["connect", "live"].includes(action) && /no RecallPresetMessage broadcast within/i.test(data.error)) {
      throw Error("본체에서 현재 프리셋 응답이 없습니다. Cortex Control이 열려 있으면 종료한 뒤 USB 연결을 누르세요. 이미 닫았다면 USB 케이블을 확인하세요.");
    }
    throw Error(data.error);
  }
  return data;
}
function GridCpuTotals({cpu,blocks,pair}) {
  const costs=[0,0];
  let known=Number.isFinite(cpu?.total) && Array.isArray(cpu?.columns);
  for(const block of blocks){
    const cost=cpu?.columns?.[block.row]?.[block.col];
    if(Number.isFinite(cost) && cost>=0) costs[Math.floor(block.row/2)]+=cost;
    else known=false;
  }
  const sum=costs[0]+costs[1];
  return costs.map((cost,index)=>{
    if (pair != null && index !== pair/2) return null;
    // Each row pair has half the total capacity. Allocate the overall load by block cost.
    const percent=known && sum>0 ? Math.min(100,2*cpu.total*cost/sum) :
      known && cpu.total===0 ? 0 : null;
    return <span key={index} className="cpu-pair" style={{bottom:pair==null && index===0?"50%":"0%"}}
      title="블록별 DSP 비용에 따른 행 그룹 추정 사용률">
      {index===0?"1–2":"3–4"} CPU {percent==null?"—":Math.round(percent)+"%"}
    </span>;
  });
}
const headerMeters = [
  ["IN", physicalInputs],
  ["OUT", physicalOutputs],
];

function SignalMeters({ active, publish }) {
  const [frame, setFrame] = useState({});
  useEffect(() => {
    let current = true, timer;
    function update(values) {
      setFrame(values);
      publish(values);
    }
    async function refresh() {
      let values = {};
      try {
        if (!document.hidden) values = await api("meters");
      } catch {
        // Clear stale readings while USB or the network is unavailable.
      }
      if (!current) return;
      update(values);
      timer = setTimeout(refresh, document.hidden ? 500 : 100);
    }
    if (active) refresh();
    else update({});
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, publish]);

  return <div className="signal-meters" aria-label="Quad Cortex physical signal levels">
    {headerMeters.map(([type, channels]) => <div className="signal-line" key={type}>
      <span className="signal-label">{type} {channels.map((channel,i) =>
        <React.Fragment key={channel}>{i > 0 && "/"}<b data-connected={frame.plugged?.[channel]}>{i+1}</b></React.Fragment>
      )}</span>
      <div className="signal-bars">
      {channels.map((channel,i) => {
        if (frame.plugged?.[channel] !== true) return null;
        const reading=hidReading(frame.io,channel);
        const label=type+" "+(i+1)+(reading?.clip?" CLIP":"");
        return <span className="signal-channel" key={channel} role="img" aria-label={label} title={label} data-clip={reading?.clip}>
          <MeterTrack reading={reading}/>
        </span>;
      })}</div>
    </div>)}
  </div>;
}
const instrumentTags = {
  1: ["기타", "M14 9l5-6 2 2-6 6m-2-2c-2-1-4 0-4 2 0 1-1 2-3 2-3 0-4 5-1 7s7 1 7-2c0-2 1-3 2-3 2-1 2-4-1-6z M7 16l2 2"],
  2: ["베이스", "M11 14l8-11 2 1-9 12m-2-6c-1 1 0 3-3 3-4 0-5 5-2 7s7 1 8-3c0-2 2-3 3-3-2-2-4 1-5-1 M6 17l2 1"],
  3: ["신스", "M2 6h20v13H2z M7 12v7m5-7v7m5-7v7 M6 6v6h2V6m7 0v6h2V6"],
  4: ["보컬", "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M6 10v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8"],
  5: ["기타 악기", "M9 17V6l11-3v11m-11 3c0 3-6 5-6 2 0-3 6-5 6-2zm11-3c0 3-6 5-6 2 0-3 6-5 6-2z"],
};
function InstrumentTag({value}) {
  const tag=instrumentTags[value];
  if (!tag) return null;
  return <svg className="instrument-tag" viewBox="0 0 24 24" role="img" aria-label={tag[0]}
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <title>{tag[0]}</title><path d={tag[1]}/>
  </svg>;
}
function DirectoryFrame({close,children}) {
  const ref=useRef(null);
  useLayoutEffect(()=>{
    const node=ref.current;
    node.showModal();
    return ()=>node.close();
  },[]);
  return <dialog ref={ref} className="preset-directory-view tablet-directory" aria-label="Directory"
    onCancel={e=>{e.preventDefault();close()}} onClick={e=>{
      if(e.target!==ref.current || !ref.current.matches(":modal"))return;
      const r=ref.current.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();
    }}>{children}</dialog>;
}
function RefreshPrompt({preset, choose}) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog className="refresh-prompt" ref={dialog} aria-labelledby="refresh-title"
    onCancel={e=>{e.preventDefault();choose("cancel")}}>
    <h2 id="refresh-title">플러그인 목록 갱신</h2>
    <p>‘{preset.name}’에 저장하지 않은 변경사항이 있습니다. 갱신 전에 저장할까요?</p>
    <div className="actions">
      <button onClick={()=>choose("save")}>저장 후 갱신</button>
      <button onClick={()=>choose("skip")}>저장하지 않고 갱신</button>
      <button autoFocus onClick={()=>choose("cancel")}>취소</button>
    </div>
  </dialog>;
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
function BlockPower({block,scene,disabled,action}) {
  const hold = useRef(null), suppress = useRef(false);
  const cancel = () => { clearTimeout(hold.current); hold.current=null; };
  useEffect(() => cancel, [block.row,block.col,block.model,scene,disabled]);
  return <button type="button" className="block-power" disabled={disabled}
    aria-label={"블록 전원 · "+(block.bypassAssigned?"씬 할당됨":"씬 미할당")}
    aria-pressed={!block.bypass[scene]} title="전원 전환 · 길게 눌러 씬 할당"
    onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{
      if (!e.isPrimary || e.button!==0) return;
      cancel(); suppress.current=false;
      e.currentTarget.setPointerCapture(e.pointerId);
      hold.current=setTimeout(()=>{suppress.current=true;action("bypass-assign")},550);
    }} onPointerMove={e=>{
      if(hold.current===null)return;
      const r=e.currentTarget.getBoundingClientRect();
      if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom){cancel();suppress.current=true}
    }} onPointerUp={cancel} onPointerCancel={()=>{cancel();suppress.current=true}} onLostPointerCapture={cancel}
    onKeyDown={e=>{suppress.current=false;if(e.shiftKey && e.key==="Enter"){e.preventDefault();if(!e.repeat)action("bypass-assign")}}}
    onClick={()=>{if(!suppress.current)action("bypass");suppress.current=false}}>
    {block.bypassAssigned && <SceneMark scene={scene}/>}
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v10M6.2 5.5a9 9 0 1 0 11.6 0"/></svg>
  </button>;
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
  const formatted = p.offAt===value ? "OFF" : p.pan ? (Math.abs(value-.5)<.005?"C":(value<.5?"L ":"R ")+Math.round(Math.abs(value-.5)*200)) : p.level && value < .01 ? "Off" :
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
        {p.name}
      </small>
      {p.assigned && <SceneMark scene={scene}/>}
      <i className={"dial" + (p.expression ? " expression-dial" : "")} style={{ "--angle": p.expression ? "0deg" : value * 270 - 135 + "deg" }}>{p.expression ? "X"+p.expression : null}</i>
      <output>{current == null ? "—" : formatted}</output>
    </button>
  );
}
function BlockParameter(props) {
  const { p } = props;
  if (["comboBox", "switch", "toggleButton"].includes(p.type) ||
      (!p.type && (p.steps === 2 || p.options?.length > 2))) {
    return <ChoiceParameter {...props} busy={props.busy === true || props.busy?.parameter === p.index} />;
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

function EffectGroups({rows, render, listKey, depth=0}) {
  if (depth===2) return <PagedRows rows={rows} render={render} listKey={listKey}/>;
  const groups=new Map();
  for (const model of rows) {
    const instrument=model.category.match(/\b(guitar|bass)\b/i)?.[1]?.toUpperCase();
    const suffix=(model.name.match(/\((M|ST|S\/C)\)$/i) || model.category.match(/\((M|ST)\)$/i))?.[1]?.toUpperCase();
    const label=(depth===0 ? instrument : {M:"MONO",ST:"STEREO","S/C":"SIDECHAIN"}[suffix]) || "";
    if (!groups.has(label)) groups.set(label,[]);
    groups.get(label).push(model);
  }
  const order=depth===0?["GUITAR","BASS",""]:["MONO","STEREO","SIDECHAIN",""];
  return order.filter(label=>groups.has(label)).map(label=>{
    const branch=<EffectGroups rows={groups.get(label)} render={render} depth={depth+1} listKey={listKey+"|"+label}/>;
    return label?<details open className="effect-group" key={label}><summary>{label}</summary>{branch}</details>:
      <React.Fragment key="unclassified">{branch}</React.Fragment>;
  });
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

const phoneEditorQuery = "(max-width:599px) and (orientation:portrait)";
function ParameterPage({compact, multiple, turn, children, muted}) {
  const touches = useRef(new Map()), swipe = useRef(null), suppressClick = useRef(false);
  useEffect(()=>{touches.current.clear();swipe.current=null;suppressClick.current=false},[compact]);
  function down(e) {
    if (!compact || e.pointerType !== "touch") return;
    const points=touches.current;
    if (!points.size) suppressClick.current=false;
    points.set(e.pointerId,{x:e.clientX,y:e.clientY,target:e.target});
    if (points.size<2) return;
    if (points.size===2 && !swipe.current) {
      const [a,b]=points.values();
      swipe.current={x:(a.x+b.x)/2,y:(a.y+b.y)/2, dx:0,dy:0};
      suppressClick.current=true;
      // Cancel the first finger's dial drag or pending scene-assignment timer.
      a.target.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:[...points.keys()][0],pointerType:"touch"}));
    } else if (swipe.current) swipe.current.cancelled=true;
    for (const id of points.keys()) if (e.currentTarget.hasPointerCapture(id)===false) {
      try { e.currentTarget.setPointerCapture(id); } catch {}
    }
    e.stopPropagation();
  }
  function move(e) {
    const points=touches.current, p=points.get(e.pointerId);
    if (!p) return;
    p.x=e.clientX;p.y=e.clientY;
    const s=swipe.current;
    if (!s) return;
    e.stopPropagation();
    if(points.size===2){
      const [a,b]=points.values();
      s.dx=(a.x+b.x)/2-s.x;s.dy=(a.y+b.y)/2-s.y;
    }
  }
  function finish(e) {
    // Synthetic cancellation above is for the control, not the swipe.
    if (e.type==="pointercancel" && !e.nativeEvent.isTrusted) return;
    const points=touches.current,s=swipe.current;
    if (!points.delete(e.pointerId) || !s) return;
    e.stopPropagation();
    if(e.type==="pointercancel")s.cancelled=true;
    if(!points.size){
      swipe.current=null;
      if(!s.cancelled && Math.abs(s.dx)>=32 && Math.abs(s.dx)>1.4*Math.abs(s.dy))turn(s.dx<0?1:-1);
    }
  }
  return <div data-paged={multiple || undefined} className={"params parameter-page"+(muted?" muted":"")}
    onPointerDownCapture={down} onPointerMoveCapture={move} onPointerUpCapture={finish}
    onPointerCancelCapture={finish} onPointerLeave={e=>{
      if(!swipe.current && !e.currentTarget.contains(e.relatedTarget instanceof Node?e.relatedTarget:null))touches.current.delete(e.pointerId);
    }}
    onClickCapture={e=>{if(compact && suppressClick.current && e.detail){e.preventDefault();e.stopPropagation()}}}>
    {children}</div>;
}

function GigScenes({state:s,current,enabled,select,run}) {
  const [edit,setEdit]=useState(null), [copy,setCopy]=useState(null), [over,setOver]=useState(null);
  const drag=useRef(null), skipClick=useRef(false), root=useRef(null);
  const stamp={identity:s?.identity,rev:s?.rev,scene:s?.scene};
  useEffect(()=>{
    function outside(e){ if(!root.current?.contains(e.target))setCopy(null); }
    function escape(e){ if(e.key==="Escape"){setCopy(null);setEdit(null);} }
    document.addEventListener("pointerdown",outside);
    document.addEventListener("keydown",escape);
    return ()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape)};
  },[]);
  function finishEdit(){
    if(!edit)return;
    const {source,label,color,initial,original,stamp}=edit;
    setEdit(null);
    const change={};
    if(label.trim()!==initial)change.label=label.trim();
    if(color!==original)change.color=color;
    if(Object.keys(change).length)run("scene-style",{source,...change,...stamp});
  }
  function start(e,i){
    if(!enabled||edit||copy||e.button!==0||!e.isPrimary)return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={i,x:e.clientX,y:e.clientY,moved:false,stamp};
    skipClick.current=false;
  }
  function move(e){
    const d=drag.current;
    if(!d||!e.isPrimary)return;
    if(!d.moved && Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;
    if(!d.moved){d.moved=true;e.currentTarget.setPointerCapture(e.pointerId);}
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-gig-scene]");
    setOver(target && root.current.contains(target)?Number(target.dataset.gigScene):null);
  }
  function end(e){
    const d=drag.current;
    drag.current=null;setOver(null);
    if(!d?.moved)return;
    skipClick.current=true;
    const tile=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-gig-scene]");
    if(!tile||!root.current.contains(tile))return;
    const target=Number(tile.dataset.gigScene);
    if(target!==d.i)run("scene-transfer",{source:d.i,target,swap:!e.altKey,...d.stamp});
  }
  return <div ref={root} className="gig-scenes">{Array.from(letters,(letter,i)=>{
    const info=s?.sceneInfo?.[i], label=info?.label||(s?.defaultScene===i?"Default scene":"Scene "+letter);
    const color=info?.color||gigColors[i], active=current===i;
    return <div className="gig-tile" key={letter} data-gig-scene={i} data-drop={over===i||copy?.source===i}
      style={{"--scene-color":gigPalette[color]||color,"--scene-shade":gigShades[color]}}>
      <button className={"scene-face"+(active?" active":"")} disabled={!enabled} aria-pressed={active}
        aria-label={letter+" · "+label} onPointerDown={e=>start(e,i)} onPointerMove={move} onPointerUp={end}
        onPointerCancel={()=>{drag.current=null;setOver(null)}} onClick={()=>{
          if(skipClick.current){skipClick.current=false;return}
          if(copy){setCopy(null);if(copy.source!==i)run("scene-transfer",{...copy,target:i,swap:false});}
          else select(i);
        }}><b aria-hidden="true">{letter}</b><span>{copy?"복사할 씬 선택":label}</span></button>
      {enabled&&!copy&&edit?.source!==i&&<div className="scene-tools">
        <button aria-label={letter+" 씬 이름과 색상 편집"} title="Edit scene" onClick={()=>{
          setEdit({source:i,label,initial:label,original:color,color,stamp});
        }}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m4 16-1 5 5-1L20 8l-4-4z"/></svg></button>
        <button aria-label={letter+" 씬 교환 또는 복사"} title="Drag and drop to swap, hold ALT to replace"
          onPointerDown={e=>start(e,i)} onPointerMove={move} onPointerUp={end}
          onPointerCancel={()=>{drag.current=null;setOver(null)}} onClick={()=>{
            if(skipClick.current){skipClick.current=false;return}setCopy({source:i,...stamp});
          }}>⇄</button></div>}
      {edit?.source===i&&<form className="scene-inline" onSubmit={e=>{e.preventDefault();finishEdit()}}
        onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))finishEdit()}}>
        <input aria-label={letter+" 씬 이름"} autoFocus value={edit.label} onFocus={e=>e.target.select()}
          onChange={e=>setEdit({...edit,label:e.target.value})}/>
        <div>{["#ffd236","#ff7000","#ff2727","#ff02c2","#6954ff","#0a74e0","#00ffdd","#45f862"].map(c=>
          <button type="button" key={c} aria-label={c} aria-pressed={edit.color===c} style={{"--swatch":c}}
            onPointerDown={e=>e.preventDefault()} onClick={()=>setEdit({...edit,color:c})}/>)}</div>
      </form>}
    </div>;
  })}</div>;
}

function App() {
  const [network,setNetwork]=useState(null);
  const networkEpoch=useRef(0);
  const updateNetwork=useCallback(result=>{networkEpoch.current++;setNetwork(result)},[]);
  useEffect(()=>{
    let mounted=true,timer;
    async function read(){
      const before=networkEpoch.current;
      let next;
      try {
        if(!document.hidden)next=await api("external-wifi",{action:"status"});
        if(mounted && next && before===networkEpoch.current)setNetwork(next);
      } catch {if(mounted && before===networkEpoch.current)setNetwork(null)}
      if(mounted)timer=setTimeout(read,["scheduled","trial","recovering","offline-pending"].includes(next?.phase)?2000:15000);
    }
    read();
    return ()=>{mounted=false;clearTimeout(timer)};
  },[network?.phase]);
  const linkLabel=bluetoothMode?modeNames.ble:network?.version?modeNames[networkMode(network)]:"";
  const [compactParams,setCompactParams]=useState(()=>matchMedia(phoneEditorQuery).matches);
  useEffect(()=>{
    const media=matchMedia(phoneEditorQuery),resize=()=>setCompactParams(media.matches);
    media.addEventListener("change",resize);
    return ()=>media.removeEventListener("change",resize);
  },[]);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const libraryToggle=useRef(null);
  useEffect(()=>{
    const portrait=window.matchMedia(phoneEditorQuery);
    const reset=()=>setLibraryOpen(false);
    portrait.addEventListener("change",reset);
    return ()=>portrait.removeEventListener("change",reset);
  },[]);
  useEffect(()=>{
    if(!libraryOpen)return;
    function escape(event){
      if(event.key==="Escape" && !event.target.closest(".refresh-prompt")){
        setLibraryOpen(false);
        libraryToggle.current?.focus();
      }
    }
    function outside(event){
      if(!event.target.closest("#block-library, .library-toggle, .refresh-prompt"))setLibraryOpen(false);
    }
    document.addEventListener("keydown",escape);
    document.addEventListener("click",outside,true);
    return ()=>{
      document.removeEventListener("keydown",escape);
      document.removeEventListener("click",outside,true);
    };
  },[libraryOpen]);
  const [meterFrame, setMeterFrame] = useState({});
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [ioOpen,setIOOpen]=useState(false);
  const [liveState, S] = useState(null),
    [preview, setPreview] = useState(null),
    [paramsOpen, setParamsOpen] = useState(false),
    [lib, L] = useState({ models: [], inputs: {}, outputs: {} }),
    [usbPaused, setPaused] = useState(false),
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
    [cachedSlots, setCachedSlots] = useState([]),
    [bank, K] = useState(0),
    [search, F] = useState(""),
    [pendingScene, J] = useState(null),
    [busy, B] = useState(false),
    [msg, T] = useState(""),
    [gig, H] = useState(false),
    [drag, D] = useState(null);
  const [cpu,setCpu] = useState(null), [overlay,setOverlay] = useState(false);
  const s = liveState ?? preview;
  const paused = !liveState;
  const directorySlots = slots.length ? slots : cachedSlots;
  const stream = useRef({ writing: false, pending: [] }),
    history = useRef({ undo: [], redo: [] });
  const mode = useRef(null);
  const hadConnection=useRef(false), nextPoll=useRef(0);
  const [waitingReason,setWaitingReason]=useState("");
  function waitForDevice(reason) {
    setWaitingReason(reason);
    if(mode.current!=="waiting"){
      latest.current=null;S(null);Q([]);P(null);M(null);D(null);J(null);
      setIOOpen(false);setOverlay(false);setRefreshPrompt(null);setLibraryOpen(false);
      pointer.current=null;mode.current="waiting";
    }
    setInitialLoading(false);
  }
  const latest = useRef(null),
    lock = useRef(false),
    epoch = useRef(0),
    pointer = useRef(null),
    sceneNext = useRef(null),
    reading = useRef(false);
  function accept(next) {
    if (latest.current?.identity !== next.identity) {
      P(null);
      C("");
      G(0);
      history.current = { undo: [], redo: [] };
    }
    hadConnection.current=true;setWaitingReason("");
    setPreview(next);
    latest.current = next;
    S(next);
  }
  const [pluginNotice,setPluginNotice]=useState(""), [syncingPlugins,setSyncingPlugins]=useState(false);
  const [refreshPrompt,setRefreshPrompt] = useState(null);
  const pluginRefreshPending = useRef(false);
  const libraryRequest = useRef(0);
  function requestPluginRefresh() {
    if (pluginRefreshPending.current || lock.current) return;
    const preset=latest.current;
    if (preset?.dirty) setRefreshPrompt(preset);
    else refreshPlugins();
  }
  async function chooseRefresh(choice) {
    const requested=refreshPrompt;
    setRefreshPrompt(null);
    if (choice==="cancel" || !requested || lock.current || pluginRefreshPending.current) return;
    const current=latest.current;
    if (current?.identity!==requested.identity || current.rev!==requested.rev || current.scene!==requested.scene) {
      setPluginNotice("프리셋 상태가 바뀌었습니다. Refresh를 다시 눌러 주세요.");
      return;
    }
    if (choice==="save" && !await run("save",{identity:requested.identity,rev:requested.rev,scene:requested.scene})) return;
    await refreshPlugins();
  }
  async function refreshPlugins() {
    if (pluginRefreshPending.current) return;
    pluginRefreshPending.current=true;
    const version=epoch.current;
    setSyncingPlugins(true);
    setPluginNotice("");
    try {
      const result=await api("plugin-refresh");
      if(version!==epoch.current)return;
      if(lib.deviceKey && result.deviceKey && lib.deviceKey!==result.deviceKey){
        L(previous=>({...previous,owned:null}));
        setPluginNotice("현재 라이브러리와 Cortex Control의 본체가 다릅니다. USB로 본체를 다시 연결하세요.");
        return;
      }
      L(previous=>({...previous,deviceKey:result.deviceKey,owned:result.owned}));
      setPluginNotice([result.owned && ("보유 플러그인 "+result.owned.length+"개 확인"), result.guide].filter(Boolean).join(" · "));
    } catch(error) {
      if(version===epoch.current)setPluginNotice(error.message);
    } finally {
      pluginRefreshPending.current=false;
      setSyncingPlugins(false);
    }
  }
  const pluginUnavailable=model=>Boolean(model.plugin) && !lib.owned?.includes(String(model.plugin));
  const [previewChecked,setPreviewChecked]=useState(false);
  const [libraryPending,setLibraryPending]=useState(false);
  async function loadLibrary() {
    setLibraryPending(true);
    const request = ++libraryRequest.current;
    try {
      const library = await api("library");
      if (request === libraryRequest.current) L(library);
    } catch (e) {
      if (request === libraryRequest.current) T(e.message);
    } finally {
      if (request === libraryRequest.current) setLibraryPending(false);
    }
  }
  async function refresh(force = false) {
    if (
      lock.current ||
      reading.current ||
      (!force && (document.hidden || pointer.current || Date.now()<nextPoll.current))
    )
      return;
    const version = epoch.current;
    reading.current = true;
    try {
      const prevState = latest.current;
      const reply = await api("live", {
        checkUsb:true, known: prevState?.rev,
        knownPreview: mode.current === "browse" && !force,
      });
      if (version !== epoch.current) return;
      if(reply.usbMissing){
        nextPoll.current=Date.now()+1000;
        setPaused(false);waitForDevice("usb");return;
      }
      nextPoll.current=0;
      if (reply.paused) {
        if (reply.preview) setPreview(previous =>
          previous?.rev === reply.preview.rev && previous.scene === reply.preview.scene &&
          previous.dirty === reply.preview.dirty ? previous : reply.preview);
        if (mode.current !== "browse") {
          setWaitingReason("released");setInitialLoading(false);
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
      if (!latest.current || force) loadLibrary();
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
        nextPoll.current=Date.now()+1500;
        waitForDevice(e instanceof TypeError || /키 포함 주소/.test(e.message) ? "remote" : "sync");
      }
    } finally {
      reading.current = false;
    }
  }
  useEffect(() => {
    let mounted = true;
    api("preview").then(cached => {
      if (!mounted) return;
      if (cached.presets) setCachedSlots(cached.presets);
      if (mode.current || latest.current) return;
      if (cached.preview) setPreview(cached.preview);
      if (cached.library) L(cached.library);
    }).catch(() => {}).finally(()=>{if(mounted)setPreviewChecked(true)});
    refresh(true);
    const timer = setInterval(() => refresh(), 250),
      wake = () => refresh(true);
    document.addEventListener("visibilitychange", wake);
    return () => {
      mounted = false;
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
      if (usbPaused) {
        const state = await api("connect");
        accept(state);
        loadLibrary();
        setPaused(false);
        mode.current = "live";
        T("");
      } else {
        if (!(await api("release")).paused) return;
        setPreview(latest.current);
        latest.current = null;
        S(null);
        P(null);
        setPaused(true);setWaitingReason("released");
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
    B(a === "edit" || a === "route-edit" ? {parameter:d.index} : true);
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
  function previewCabinet(p, value) {
    if (mode.current !== "browse") return;
    setPreview(previous => {
      if (previous?.identity !== s.identity || previous.scene !== s.scene) return previous;
      return {...previous, blocks:previous.blocks.map(b => {
        if (b.row !== active.row || b.col !== active.col || b.model !== active.model) return b;
        return {...b, params:b.params.map(param => param.index !== p.index ? param : {
          ...param, values:param.values.map((v,i)=>i===(param.assigned?s.scene:0)?value:v)
        })};
      })};
    });
  }
  async function writeKnob(p, value) {
    const queue = stream.current;
    const next = {
      row: route?.row ?? active.row,
      ...(route ? {part:route.part} : {col:active.col,model:active.model}),
      index: p.index,
      value,
      identity: s.identity,
      scene: s.scene,
    };
    const last=queue.pending.at(-1);
    if (last && ["identity","scene","row","col","model","part","index"].every(k=>last[k]===next[k])) queue.pending.pop();
    queue.pending.push(next);
    if (queue.writing) return queue.writing;
    queue.writing = (async () => {
      await Promise.resolve();
      try {
        while (queue.pending.length) {
          const n = queue.pending.shift();
          const now = latest.current;
          const b = now?.blocks.find((x) => x.row === n.row && x.col === n.col);
          if (
            now?.identity !== n.identity ||
            now?.scene !== n.scene ||
            (!n.part && b?.model !== n.model)
          )
            break;
          const params=n.part ? now.lanes[n.row].controls[n.part] : b.params;
          const param=params.find(candidate=>candidate.index===n.index);
          if (!param || isInactive(param,params,n.scene)) continue;
          if (
            Math.abs(
              (param.values[param.assigned ? n.scene : 0] ?? -1) - n.value,
            ) < 1e-6
          )
            continue;
          if (!(await remember(n.part ? "route-edit" : "edit", n))) break;
        }
      } finally {
        queue.pending.length = 0;
        queue.writing = null;
      }
    })();
    return queue.writing;
  }
  const [initialLoading,setInitialLoading]=useState(true);
  const presetRequest = useRef(null);
  const [presetFraction,setPresetFraction]=useState(0);
  const [loadingPresets, setLoadingPresets] = useState(false);
  function readPresets() {
    if (presetRequest.current) return presetRequest.current;
    setPresetFraction(0);
    const request = api("directory-index",{},fraction=>{if(presetRequest.current===request)setPresetFraction(fraction)}).then(data => {
      const entries=data.presets;
      if (presetRequest.current === request) {
        setFolders(data.folders);
        Q(entries);
        setCachedSlots(entries);
      }
      return entries;
    }).catch(error => {
      if (presetRequest.current === request) presetRequest.current = null;
      throw error;
    }).finally(() => {
      if (!presetRequest.current || presetRequest.current === request) setLoadingPresets(false);
    });
    presetRequest.current = request;
    setLoadingPresets(true);
    return request;
  }
  useEffect(() => {
    if (!liveState) return;
    let current=true;
    setFolders([]);Q([]);setDirectoryError("");
    readPresets().catch(error => {if(current)setDirectoryError(error.message)}).finally(()=>{
      if(current)setInitialLoading(false);
    });
    return () => {
      current=false;
      presetRequest.current = null;
      setLoadingPresets(false);
    };
  }, [Boolean(liveState),usbPaused]);
  const [folders,setFolders]=useState([]),[folderName,setFolderName]=useState("My Presets");
  const [directoryError,setDirectoryError]=useState("");
  const [group,setGroup]=useState(null),[groupRetry,retryGroup]=useState(0);
  const directoryNames=[...new Set(["Downloads","Cloud Presets","Factory Presets","My Presets",...folders.map(f=>f.name)])];
  const isDirectory=modal?.kind==="presets";
  const visibleSlots=folderName==="My Presets" ? slots : group?.name===folderName ? group.rows : [];
  const loadingGroup=folderName!=="My Presets" && group?.name!==folderName && !directoryError;
  useEffect(()=>{
    if(!isDirectory || folderName==="My Presets")return;
    let valid=true;
    setDirectoryError("");setGroup(null);
    readPresets().then(()=>api("directory-group",{name:folderName})).then(rows=>{
      if(valid)setGroup({name:folderName,rows});
    }).catch(e=>{if(valid)setDirectoryError(e.message)});
    return ()=>{valid=false};
  },[isDirectory,folderName,groupRetry,usbPaused]);
  function directory() {
    setFolderName("My Presets");K(Math.floor((directorySlots.find(x=>x.name===s?.name)?.slot??0)/8));F("");
    M({kind:"presets"});
    readPresets().catch(e=>setDirectoryError(e.message));
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
      const entries = await readPresets();
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
  const editorRow = (active || route)?.row;
  const mainRef = useRef(null);
  const [needsTwoRows, setNeedsTwoRows] = useState(false);
  const editorVisible = editorRow != null && (!gig || paramsOpen);
  const pair = editorVisible && needsTwoRows && !drag ? editorRow & ~1 : null;
  useLayoutEffect(() => {
    if (!editorVisible) return;
    const main = mainRef.current, shell = main.closest(".shell");
    const grid = main.querySelector(".scroll"), board = grid.querySelector(".board");
    const panel = main.querySelector(".panel"), gigPanel = main.querySelector(".gig-panel");
    const footer = shell.querySelector("footer");
    function measure() {
      // Use the height of four full rows even when only two are currently visible.
      const rowHeight = parseFloat(getComputedStyle(board).gridTemplateRows);
      const gridTop = grid.getBoundingClientRect().top - shell.getBoundingClientRect().top;
      const required = gridTop + rowHeight * 4 + grid.offsetHeight - grid.clientHeight
        + parseFloat(getComputedStyle(panel).marginTop) + panel.scrollHeight
        + (gigPanel?.offsetHeight || 0) + footer.offsetHeight + parseFloat(getComputedStyle(shell).paddingBottom);
      setNeedsTwoRows(required > document.documentElement.clientHeight + 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [main, board, panel, ...panel.children, main.querySelector(".bar"),
                      shell.querySelector("header"), gigPanel, footer]) {
      if (el) observer.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [editorVisible, active?.model, route?.part, gig, page]);
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
    if ((part==="input" || part==="output") && !window.matchMedia(phoneEditorQuery).matches)
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
  function placeModel(model, target) {
    if (target?.col == null || pluginUnavailable(model)) return;
    const {row,col} = target;
    return remember("place", {row,col,...placement(model)}, () => {
      P({row,col});
      reveal(model);
      G(0);
      if (window.matchMedia(phoneEditorQuery).matches) setLibraryOpen(false);
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
  const powerButton = active && <BlockPower key={[s.identity,active.row,active.col,active.model].join("-")} block={active} scene={s.scene} disabled={busy || paused} action={blockAction}/>;
  const perPage=compactParams?6:10;
  const pageCount=Math.ceil((active?.params.length??0)/perPage);
  const shownPage=Math.min(page,Math.max(0,pageCount-1));
  const editorMenu = active && <BlockMenu key={[s.identity,active.row,active.col,active.model].join("-")} block={active} blocks={s.blocks} disabled={busy || paused} action={blockAction}/>;
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
        if (window.matchMedia(phoneEditorQuery).matches) setLibraryOpen(false);
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
        if (src.row == null) placeModel(src,{row,col});
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
      else placeModel(src,picked);
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
    categories = !lib.models.length ? nativeOrder : [
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
      disabled={pluginUnavailable(m)}
      title={pluginUnavailable(m) ? (lib.owned ? "보유 목록에 없는 플러그인" : "보유 상태 미확인") : undefined}
      className={
        "entry model " +
        (active?.model === m.model &&
        (!m.capture || m.capture === active.capture)
          ? "on"
          : "")
      }
      onPointerDown={(e) => gesture(e, m)}
      onClick={(e) => {
        if (e.detail === 0) placeModel(m,picked);
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
      {category==="Plugins" || category==="Neural Capture"
        ? <PagedRows rows={items} render={modelRow} listKey={[category,product,filter].join("|")}/>
        : <EffectGroups key={category+"|"+filter} rows={items} render={modelRow} listKey={category+"|"+filter}/>}
    </>
  );
  // The app bundle is ready. The remaining lights follow actual request boundaries.
  useEffect(()=>{
    if (usbPaused || msg) setInitialLoading(false);
  },[usbPaused,msg]);
  const loadingStep = !previewChecked ? 1 : !liveState ? 2 : libraryPending ? 3 : 4;
  return (
    <div className="shell">
      {initialLoading && liveState && (
        <div className="preset-loading" role="status">
          <div className="splash-chain" aria-hidden="true">
            {["pitch","overdrive","amp","cab","reverb"].map((key,i)=><div key={key} className="splash-block" style={{"--fill":(i<loadingStep?100:i>loadingStep?0:25+75*(i===4?presetFraction:0))+"%"}}>
              <img src={icons[key]} alt=""/><img className="splash-color" src={icons[key]} alt=""/>
            </div>)}
          </div>
          <span>{loadingPresets?"Loading Preset Directory...":"Loading Preset..."}</span>
        </div>
      )}
      <header>
        <div className="desk-heading">
          <div className="device-heading-row"><strong className="device-name" title={lib.deviceName || "Quad Cortex"}>
            <img src={icons.neuralLogo} alt="" /><span>{lib.deviceName || "Quad Cortex"}</span>
          </strong><button className="settings-launch" aria-label="Device Settings" title="Device Settings" onClick={()=>setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m9.8 3 .6-2h3.2l.6 2 2 .9 2-.7 2.2 2.2-.8 2 .9 2 2.1.6v3.2l-2.1.6-.9 2 .8 2-2.2 2.2-2-.7-2 .9-.6 2h-3.2l-.6-2-2-.9-2 .7-2.2-2.2.8-2-.9-2-2.1-.6V10l2.1-.6.9-2-.8-2 2.2-2.2 2 .7z"/><circle cx="12" cy="11.6" r="3.2"/>
            </svg></button></div>
          <span className="desk-status" role="status" title={msg || undefined}>
            <span data-connected={!!liveState}>{linkLabel && linkLabel+" · "}{usbPaused ? "USB 대기" : liveState ? "USB 연결됨" : waitingReason==="usb" ? "USB 미연결" : msg ? "USB 연결 확인 필요" : "USB 연결 중…"}</span>
            {busy ? " · 처리 중…" : !paused && msg && " · " + msg}
          </span>
        </div>
        {!paused && <><nav>
          <button className={!gig && !modal ? "current" : ""} onClick={() => {M(null);H(false)}}>
            GRID
          </button>
          <button className={modal?"current":""} onClick={() => directory("presets")}>DIRECTORY</button>
          <button className={gig && !modal ? "current" : ""} onClick={() => {M(null);H(!gig)}}>
            GIG VIEW
          </button>
        </nav>
        <SignalMeters active={!!liveState && !paused} publish={setMeterFrame} />
        <DeviceToolbar api={api} online={!!liveState && !paused} busy={busy} revision={s?.rev} travel={travel} report={T}/>
        <button className="io-launch" title="I/O Settings" aria-label="I/O Settings" onClick={()=>setIOOpen(true)}>I/O</button>
        <button
          disabled={busy}
          onClick={toggleUsb}
          title="Cortex Control과 USB 사용 전환"
        >
          USB 해제
        </button></>}
      </header>
      {paused && <section className={"usb-wait"+(hadConnection.current?" usb-interrupted":"")} aria-label="연결 안내" role="status">
        <img src={icons.neuralLogo} alt=""/>
        <h2>{waitingReason==="remote"?"리모트 디바이스에 접속해 주세요":waitingReason==="sync"?"Quad Cortex 연결을 확인해 주세요":"Quad Cortex를 연결해 주세요"}</h2>
        <p>{waitingReason==="remote"?msg:usbPaused?"USB 연결을 누르면 본체와 다시 연결합니다.":waitingReason==="sync"?"USB 케이블과 본체 상태를 확인해 주세요. 연결을 다시 시도하고 있습니다.":hadConnection.current?"USB 연결이 끊겼습니다. 다시 연결하면 현재 프리셋과 씬을 불러옵니다.":"본체 전원을 켜고 USB 데이터 케이블로 연결하면 현재 프리셋을 불러옵니다."}</p>
        {usbPaused && <button onClick={toggleUsb} disabled={busy}>USB 연결</button>}
      </section>}
      {(!paused || hadConnection.current) && <div inert={paused} className={"workspace"+(libraryOpen?" library-open":"")}>
        <button ref={libraryToggle} className="library-toggle" aria-controls="block-library"
          aria-expanded={libraryOpen} aria-label={libraryOpen?"라이브러리 닫기":"라이브러리 열기"}
          onClick={()=>setLibraryOpen(v=>!v)}><span aria-hidden="true"/></button>
        {
          <aside id="block-library" aria-label="블록 라이브러리" className={category && !route ? "expanded" : ""}>
            <div className="rail">
                {categories.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={c}
                    aria-pressed={family(category) === c}
                    onClick={() => {if(route)P(null); C(c); setLibraryOpen(true)}}
                  >
                    <Icon category={c} rail={family(category) !== c} />
                    <span className="category-label">{c}</span>
                  </button>
                ))}
              </div>
            {route && ["input","output"].includes(route.part) ?
              <PortList route={route} lane={{...s.lanes[route.row],input:displayedInput(s.lanes,route.row)}} lib={lib} disabled={busy || paused}
                back={()=>P(null)} choose={value=>remember(route.part,{row:route.row,value},()=>setLibraryOpen(false))}/> :
            <div className="models">
              {!lib.models.length && <div role="status">
                <p>{libraryPending ? "이펙터 목록을 불러오는 중…" : liveState ? "이펙터 목록을 불러오지 못했습니다." : "Quad Cortex를 USB로 연결하면 모델 목록이 표시됩니다."}</p>
                {!libraryPending && liveState && <button onClick={loadLibrary}>다시 불러오기</button>}
              </div>}
              {category && !lib.models.length ? <button onClick={()=>C("")}>‹　{category}</button> : category ? (
                <>
                  <button onClick={() => C("")}>‹　{family(category)}</button>
                  {category === "Plugins" ? (
                    <><button onClick={requestPluginRefresh} disabled={syncingPlugins || busy}>Refresh ↻</button>
                    <small className="plugin-sync-note" role="status">{pluginNotice || "플러그인이 바뀌면 Cortex Control에서 목록을 갱신하세요."}</small>
                    <details className="plugin-section" open>
                      <summary>ALL PLUGINS</summary>
                        {plugins.map((id) => (
                          <section className="plugin-group" key={id}>
                            <button
                              className="entry product"
                              aria-expanded={product === id}
                              onClick={() => {
                                setProduct(product === id ? "" : id);
                                setFilter("");
                              }}
                            >
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
                    </details></>
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
        <main ref={mainRef} onClick={event=>{
          if (!active && !route) return;
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
            <button className="preset" data-dirty={Boolean(s?.dirty)} onClick={() => directory("presets")}>
              {slots.some((x) => x.name === s?.name)
                ? slotName(slots.find((x) => x.name === s.name).slot) + "　"
                : ""}
              {s?.name || "Quad Cortex"}
              {s?.dirty ? "*" : ""}
            </button>
            <button
              disabled={!s || paused || busy || !s.dirty}
              aria-label="현재 프리셋 저장" title="현재 프리셋 저장"
              onClick={() => run("save")}
            >
              <SaveIcon/>
            </button>
            {scenes}
          </div>
          {
            <>
              <div className="scroll">
                <div className="board" data-pair={pair ?? undefined}>
                  {s && <GridRouting key={s.identity+"-"+s.rev+"-"+s.scene} state={s} pair={pair} disabled={busy || paused}
                    selection={route} open={openRoute}
                    commit={points=>remember("split",points)} />}
                  {s?.lanes.map((lane, row) => (pair == null || (row & ~1) === pair) && (
                    <React.Fragment key={row}>
                      <Port reduction={meterFrame.gates?.[row]} meterFrame={meterFrame} side="input" selected={route?.row===row && route.part==="input"} row={row} value={displayedInput(s.lanes,row)} name={lib.inputs[displayedInput(s.lanes,row)]} indicator={lane.input!==0 && (lane.gate?.[s.scene] ?? lane.gate?.[0])}
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
                                  title={overlay && Number.isFinite(cpu?.columns?.[row]?.[col])
                                    ? b.name+" · CPU "+cpu.columns[row][col].toFixed(1)+"%" : b.name}
                                  aria-label={b.name}
                                  aria-pressed={selected}
                                  onPointerDown={(e) => gesture(e, b)}
                                  onClick={(e) => {
                                    if (e.detail === 0) select(row, col);
                                  }}
                                >
                                  {overlay && Number.isFinite(cpu?.columns?.[row]?.[col]) && <span className="cpu-meter"
                                    style={{"--load":Math.max(0,Math.min(100,cpu.columns[row][col]))+"%","--fill":style(b.category)[2]}}/>}
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
                      <Port meterFrame={meterFrame} side="output" selected={route?.row===row && route.part==="output"} row={row} value={lane.output} name={lib.outputs[lane.output]} indicator={lane.output!==0 && (lane.mute?.[s.scene] ?? lane.mute?.[0])}
                        branched={s.splits.some(v=>row===v.row+1 && v.end>=0)}
                        open={()=>openRoute(row,"output")} />
                    </React.Fragment>
                  ))}
                  {overlay && s && <GridCpuTotals cpu={cpu} blocks={s.blocks} pair={pair}/>}
                </div>
              </div>
              {route && (!gig || paramsOpen) && <RoutePanel meterFrame={meterFrame} key={route.row+route.part} route={route} state={s}
                open={openRoute} busy={busy} paused={paused} commit={writeKnob}
                setPoints={points=>remember("split",points)}
                assign={p=>remember("route-assign",{...route,index:p.index,rev:s.rev,scene:s.scene})}/>}
              {active && (!gig || paramsOpen) && (active.params.some(p=>p.index===1 && p.textOptions) && active.params.some(p=>p.index===9 && p.textOptions) ?
                <CabinetPanel menu={editorMenu} key={[s.identity,active.row,active.col,active.model,s.scene,usbPaused].join("-")} block={active} scene={s.scene}
                  busy={busy} readOnly={paused} previewCabinet={usbPaused ? previewCabinet : null} commit={writeKnob} Parameter={BlockParameter}
                  assign={p=>blockAction("assign",{index:p.index,rev:s.rev,scene:s.scene})}
                  powerButton={powerButton}/> : (
                <section
                  className="panel"
                  style={{ "--c": style(active.category)[2] }}
                >
                  <div className="panelhead">
                    {editorMenu}<span>{active.category}</span>
                    <b className="grow" style={{ color: "var(--c)" }}>
                      {active.name}
                    </b>
                    {Array.from(
                      { length: pageCount },
                      (_, i) => (
                        <button
                          key={i}
                          aria-label={"파라미터 페이지 "+(i+1)} aria-pressed={shownPage===i}
                          className={shownPage === i ? "on" : ""}
                          onClick={() => G(i)}
                        >
                          {i + 1}
                        </button>
                      ),
                    )}
                    {powerButton}
                  </div>
                  <ParameterPage key={[s.identity,active.row,active.col,active.model].join("-")}
                    compact={compactParams} multiple={pageCount>1} muted={active.bypass[s.scene]}
                    turn={delta=>G(Math.max(0,Math.min(pageCount-1,shownPage+delta)))}>
                    {active.params.slice(shownPage*perPage,(shownPage+1)*perPage).map((p) => (
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
                  </ParameterPage>
                </section>
              ))}
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
                  <GigScenes key={String(s?.identity)+String(liveState)} run={run} state={s} current={pendingScene ?? s?.scene} enabled={liveState} select={i=>run("scene",{target:i})}/>
                </section>
              )}
            </>
          }
        </main>
      </div>}
      {!paused && <><footer>
        <FooterTools report={T} {...{api,paused,busy,run,refresh,cpu,setCpu,overlay,setOverlay}} s={liveState || (usbPaused ? preview : null)} />
        <button className="foot-gig" aria-pressed={gig} onClick={() => H(!gig)}>
          GIG VIEW
        </button>
        <span className="foot-version">Cortec Remote v0.4.0</span>
        <button className="foot-tribute" aria-label="Neural DSP에 감사 인사" onClick={e=>{
          const el=e.currentTarget;
          el.getAnimations().forEach(a=>a.cancel());
          el.animate([{opacity:0},{opacity:1,offset:.18},{opacity:1,offset:.60},{opacity:0}],
                     {duration:2000});
        }}>With respect to Neural DSP</button>
      </footer>
      {drag && (
        <div className="ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon category={drag.category} />
        </div>
      )}
      {refreshPrompt && <RefreshPrompt preset={refreshPrompt} choose={chooseRefresh}/>}
      </>}
      {settingsOpen && <DeviceSettings api={api} network={network} onNetwork={updateNetwork} online={!!liveState && !paused} close={()=>setSettingsOpen(false)}/>}
      {!paused && ioOpen && <IOSettings meterFrame={meterFrame} api={api} readOnly={paused} close={()=>setIOOpen(false)}/>}
      {!paused && modal && (
        <DirectoryFrame close={close}>
          <aside><small>PRESETS</small>{directoryNames.map(name=><button key={name} aria-pressed={folderName===name} onClick={()=>{setDirectoryError("");setFolderName(name);K(0);F("")}}>{name}</button>)}</aside>
          <section><div className="directory-tools"><input aria-label="프리셋 검색" placeholder="Search" value={search} onChange={e=>F(e.target.value)}/><button onClick={close} aria-label="Directory 닫기">×</button></div>
          {directoryError && <button onClick={()=>{setDirectoryError("");if(folderName==="My Presets")directory();else retryGroup(n=>n+1)}}>{directoryError} · 다시 읽기</button>}
          {(loadingPresets || loadingGroup) && !visibleSlots.length && <p role="status">프리셋 목록을 읽는 중…</p>}
          <div className="picker"><div className="banks">{!["Downloads","Cloud Presets"].includes(folderName) && Array.from({length:32},(_,i)=><button key={i} className={bank===i?"on":""} onClick={()=>{
            K(i);F("");requestAnimationFrame(()=>document.querySelector(`.preset-directory-view [data-bank="${i}"]`)?.scrollIntoView({block:"start"}));
          }}>{i+1}</button>)}</div>
          <div className="directory" key={folderName}>
            {(["Downloads","Cloud Presets"].includes(folderName)?[null]:Array.from({length:32},(_,i)=>i)).map(group=>{
              const rows=visibleSlots.filter(x=>(group===null||Math.floor(x.slot/8)===group)&&x.name.toLowerCase().includes(search.toLowerCase()));
              if(!rows.length && (search || !visibleSlots.length))return null;
              return <section key={group??"all"} data-bank={group}>
                {group!==null && <small>BANK {group+1}</small>}
                {rows.map((x,i)=><button key={JSON.stringify([x.folder,x.slot,x.name,i])} disabled={paused||busy||folders.some(f=>f.key===x.folder&&!f.local)} onClick={()=>recall(x)}>{group!==null && <span className="preset-slot">{slotName(x.slot)}</span>}<span className="preset-name" title={x.name}><span>{x.name}</span><InstrumentTag value={x.instrument}/></span>{x.author && <small title={x.author}>{x.author}</small>}</button>)}
              </section>;
            })}</div></div></section>
        </DirectoryFrame>
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

function GateMeter({value}){
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

const quickSplits = [
  ["분기 해제",-1,-1,"M19 4l10 12m0-12L19 16",44,16,4,16],
  ["분기만",0,-1,"M4 4v8q0 4 4 4h36",4,4,44,16],
  ["전체 병렬",0,7,"M4 4v8q0 4 4 4h32q4 0 4-4V4",4,4,44,4],
  ["중앙 병렬",3,4,"M20 4v3q0 3-3 3H6q-3 0-3 3t3 3h36q3 0 3-3t-3-3H31q-3 0-3-3V4",20,4,28,4],
  ["병합만",-1,7,"M4 16h36q4 0 4-4V4",44,4,4,16],
];

function RoutePanel({meterFrame,route,state,open,busy,paused,commit,assign,setPoints}){
  const {part,row}=route, params=state.lanes[row].controls?.[part] || [];
  const outputLevels=part==="output"?outputReadings(state.lanes[row].output,meterFrame):[];
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
      {pair && <div className="quick-splits" aria-label="Quick Splits">
        {quickSplits.map(([label,start,end,path,sx,sy,mx,my])=>{
          const selected=(split?.start??-1)===start && (split?.end??-1)===end;
          return <button key={label} title={label} aria-label={label} aria-pressed={selected} disabled={paused||busy}
            onClick={()=>{if(!selected)setPoints({row,start,end})}}>
            <svg viewBox="0 0 48 20" width="42" height="20" aria-hidden="true"><path d={path} fill="none" stroke="currentColor"/>
              <circle cx={sx} cy={sy} r="2.5" fill="#168bea"/><circle cx={mx} cy={my} r="2.5" fill="#eb1e9d"/>
            </svg></button>;
        })}
      </div>}
      {gate && <button disabled={busy||paused} aria-label="Input gate" aria-pressed={current(gate)<.5} onClick={()=>commit(gate,current(gate)<.5?1:0)}>⏻</button>}
    </div>
    <div className="params">{params.filter(p=>p!==gate).map(p=><React.Fragment key={p.index+"-"+state.scene}>
      {part==="input" && p.name==="INPUT GAIN" && gate && current(gate)<.5 && <GateMeter value={meterFrame.gates?.[row]}/>}
      <BlockParameter
      p={p} pressButton={part==="output" && ["MUTE","SOLO"].includes(p.name)}
      scene={state.scene} readOnly={paused} busy={busy} disabled={paused||inactive(p)}
      commit={value=>commit(p,value)} assign={()=>assign(p)}/></React.Fragment>)}
      {outputLevels.length>0 && <div className="param route-output-meter">
        <small>{state.lanes[row].output===19?"MULTI OUT LEVEL":"OUTPUT LEVEL"}</small>
        <div>{outputLevels.map((reading,i)=><MeterTrack key={i} reading={reading}/>)}</div>
        <output>{meterReading(...outputLevels)?.db > -40 ? meterReading(...outputLevels).db.toFixed(1)+" dB" : "—"}</output>
      </div>}</div>
  </section>;
}
createRoot(document.getElementById("root")).render(bluetoothMode ? <BluetoothRemote><App /></BluetoothRemote> : <App />);
