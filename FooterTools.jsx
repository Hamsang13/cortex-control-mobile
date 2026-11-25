import React, {useEffect, useRef, useState} from "react";

const options = {
  6: ["2/4","3/4","4/4","5/4","6/4","7/4","8/4","9/4","10/4","11/4","12/4","13/4","3/8","6/8","9/8","12/8","5/8 (3+2)","5/8 (2+3)","7/8 (3+2+2)","7/8 (2+3+2)","7/8 (2+2+3)"],
  7: ["1/4","1/8","1/8 triplet","1/16"], 8: ["BLIP","BLOCK","COWBELL","DIGITAL","DRUM KIT","SOFT KIT"],
  9: ["MULTI","HP","OUT 1/2","OUT 3/4","SEND 1/2"]
};
const bound = (v,min,max) => Math.max(min,Math.min(max,v));
const sceneLetters = [..."ABCDEFGH"];

export default function FooterTools({report,api,s,paused,busy,run,refresh,cpu,setCpu,overlay,setOverlay}) {
  const [panel,open] = useState(""), [globalTempo,setGlobal] = useState(null),
    [tuner,setTuner] = useState({}), [hz,pitch] = useState(null),
    [reference,calibrate] = useState(null), [cents,showCents] = useState(true),
    [mini,showMini] = useState(()=>localStorage.getItem("qc-live-tuner")==="1"),
    [pending,wait] = useState(false);
  const tunerOwner = useRef(null);
  const taps = useRef([]), writing = useRef(false);
  const preset = s?.tempo?.map(v => v[s.scene] ?? v[0]) || [];
  const [scope,setScope] = useState(null);
  const global = (panel === "tempo" ? scope : null) ?? (preset[1] >= .5);
  const values = global ? (globalTempo || {}) : preset;
  const bpm = Number.isFinite(values[0]) ? Math.round(40+200*values[0]) : null;
  const locked = paused || !s || busy || pending || global;
  const gridKey = s?.blocks.map(b=>[b.row,b.col,b.model].join(".")).join(",");
  useEffect(()=>{
    let valid=true;
    setCpu(null);
    if(s) api("cpu").then(v=>{if(valid && (!v.identity || v.identity===s.identity)) setCpu(v)}).catch(e=>{if(valid)report(e.message)});
    return ()=>{valid=false};
  },[s?.identity,gridKey,paused]);
  useEffect(()=>{
    let valid=true;
    if(s && (panel==="tempo" || global)) api("global-tempo").then(v=>{if(valid)setGlobal(v)}).catch(e=>{if(valid)report(e.message)});
    return ()=>{valid=false};
  },[panel,global,s?.identity,paused]);
  useEffect(()=>{
    let valid=true;
    if(s && (panel==="tuner" || mini)) api("tuner").then(v=>{if(valid)setTuner(v)}).catch(e=>{if(valid)report(e.message)});
    return ()=>{valid=false};
  },[panel,mini,paused,s?.identity]);
  const tunerMode = panel==="tuner" ? "panel" : mini ? "footer" : null;
  useEffect(()=>{
    pitch(null);
    if (!tunerMode || paused || !s) return;
    const owner = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    tunerOwner.current = owner;
    let valid=true, timer, reading=false;
    const stop = () => api("tuner-stop",{owner}).catch(()=>{});
    async function read(){
      if (!valid || reading || document.hidden) return;
      reading=true;
      try {
        const result=await api("pitch",{owner,mode:tunerMode});
        if(valid && !document.hidden) pitch(result.hz ?? null);
      } catch(e) { if(valid){pitch(null); report(e.message)} }
      finally {
        reading=false;
        if(!valid || document.hidden) stop();
        else timer=setTimeout(read,45);
      }
    }
    function visibility(){
      clearTimeout(timer);
      if(document.hidden){pitch(null);stop()} else read();
    }
    read();
    document.addEventListener("visibilitychange",visibility);
    return ()=>{
      valid=false; clearTimeout(timer); tunerOwner.current=null;
      document.removeEventListener("visibilitychange",visibility);
      stop();
    };
  },[tunerMode,paused,!!s]);
  const [changingTuner,setChangingTuner]=useState(false);
  async function changeTuner(field,value){
    const owner=tunerOwner.current;
    if(!owner || changingTuner)return;
    setChangingTuner(true);
    try{
      const state=await api("tuner-"+field,{owner,[field]:value});
      if(owner===tunerOwner.current)setTuner(state);
    } catch(err){report(err.message)} finally {setChangingTuner(false)}
  }
  useEffect(()=>{
    const close=e=>{if(e.key==="Escape")open("")};
    if(panel)window.addEventListener("keydown",close);
    return ()=>window.removeEventListener("keydown",close);
  },[panel]);
  async function write(index,value){
    if(locked || writing.current)return;
    writing.current=true;wait(true);report("");
    try{
      await api("set-tempo",{index,value,global,identity:s.identity,scene:s.scene});

      await refresh();
    }catch(e){report(e.message)}finally{writing.current=false;wait(false)}
  }
  function tap(){
    const now=performance.now(), a=taps.current;
    if(a.length && now-a[a.length-1]>1600)a.length=0;
    a.push(now);if(a.length>5)a.shift();
    if(a.length>1)write(0,(bound(Math.round(60000*(a.length-1)/(now-a[0])),40,240)-40)/200);
  }
  const ref=reference ?? tuner.reference ?? 440;
  const midi=hz ? 69+12*Math.log2(hz/ref) : null;
  const note=midi==null ? "—" : ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"][(Math.round(midi)%12+12)%12]+(Math.floor(Math.round(midi)/12)-1);
  const deviation=midi==null ? null : Math.round((midi-Math.round(midi))*100);
  const [beat,setBeat] = useState(null);
  const sig = options[6][Math.round((values[6] ?? .1)*20)] ?? "4/4";
  const beats = Number.parseInt(sig,10);
  const playing = values[4] >= .5;
  useEffect(()=>{
    let valid=true,timer;
    setBeat(null);
    async function poll(){
      try{
        const r=await api("beat");
        if(valid)setBeat(r.beat ?? null);
      }catch{if(valid)setBeat(null)}
      if(valid)timer=setTimeout(poll,85);
    }
    if(panel==="tempo" && playing && !paused)poll();
    return ()=>{valid=false;clearTimeout(timer)};
  },[panel,playing,paused,s?.identity]);
  const stepper=<span className="util-steps">{[1,-1].map(d=><button key={d} disabled={locked||bpm==null} aria-label={d>0?"BPM 증가":"BPM 감소"} onClick={()=>write(0,(bound(bpm+d,40,240)-40)/200)}>{d>0?"▴":"▾"}</button>)}</span>;
  function toggle(p){setScope(null);report("");open(panel===p?"":p)}
  return <>
    <button onClick={()=>toggle("tuner")}>TUNER {mini && note}</button>
    <button onClick={()=>toggle("tempo")}>TEMPO</button>
    <strong className="foot-bpm">{bpm ?? "—"}</strong>{stepper}<button disabled={locked} onClick={tap}>TAP</button>
    <button aria-pressed={overlay} title={cpu?.estimated?"모델별 DSP 비용으로 계산한 추정치":"DSP 사용률"} onClick={()=>setOverlay(!overlay)}>CPU {cpu?.estimated?"≈":""}{cpu?.total==null?"—":Math.round(cpu.total)+"%"}</button>
    {panel && <div className="shade utility-shade" onClick={()=>open("")}><section className="utility" role="dialog" aria-modal="true" aria-label={panel} onClick={e=>e.stopPropagation()}>
      <header><strong>{panel==="tempo"?"Tempo":"Tuner"}</strong>
      {panel==="tempo" ? <button disabled={locked} aria-pressed={values[2]>=.5} onClick={()=>write(2,values[2]>=.5?0:1)}>Tempo LED</button> :
      <><select aria-label="본체 튜너 입력" value={tuner.input ?? ""} disabled={paused || changingTuner || !s || tuner.input==null} onChange={e=>changeTuner("input",Number(e.target.value))}>
        <option value="" disabled>Input</option>
        {[[1,"Input 1"],[2,"Input 2"],[3,"Input 1/2"],[4,"Return 1"],[5,"Return 2"],[8,"USB 5"],[9,"USB 6"]].map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select><button aria-pressed={cents} onClick={()=>showCents(!cents)}>Cents</button><button aria-label="튜너 Mute" aria-pressed={!!tuner.mute} disabled={paused || !s || changingTuner || tuner.mute==null} onClick={()=>changeTuner("mute",!tuner.mute)}>Mute {tuner.mute==null?"—":tuner.mute?"On":"Off"}</button></>}
      <button aria-label="닫기" onClick={()=>open("")}>×</button></header>
      {panel==="tempo" ? <>
        <div className="util-tabs">{["Global","Preset"].map((v,i)=><button key={v} aria-pressed={global===(i===0)} onClick={()=>setScope(i===0)}>{v}</button>)}</div>
        {global && <small>Global · 본체 설정 읽기 전용</small>}
        <div className="util-scenes">{sceneLetters.map((l,i)=><button key={l} aria-pressed={s?.scene===i} disabled={locked || global} onClick={()=>run("scene",{target:i})}>{l}</button>)}</div>
        <div className="util-tempo"><b>{bpm ?? "—"}</b>{stepper}<button disabled={locked} onClick={tap}>TAP</button></div>
        <div className="util-options">{[[8,"Sound"],[6,"Time Signature"],[7,"Subdivisions"],[9,"Routing"]].map(([i,label])=><label key={i}>{label}<select disabled={locked} value={Math.round(values[i]*(options[i].length-1)) || 0} onChange={e=>write(i,Number(e.target.value)/(options[i].length-1))}>{options[i].map((x,n)=><option key={x} value={n}>{x}</option>)}</select></label>)}
        {[[3,"Volume", Math.round(10*(-60+69*(values[3]||0)**(1/3.5)))/10+" dB"],[5,"Pan",Math.round(((values[5]??.5)*2-1)*100)||"C"]].map(([i,label,display])=><label key={i}>{label} · {display}<input key={values[i]} type="range" min="0" max="1" step=".001" disabled={locked} defaultValue={values[i]} onPointerUp={e=>write(i,Number(e.target.value))} onKeyUp={e=>write(i,Number(e.target.value))}/></label>)}</div>
        <div className="util-beats" aria-label={beats+" beats"}>{Array.from({length:beats},(_,i)=><i key={i} className={playing && i===beat?"active":""}/>)}</div>
        <button className="metronome" disabled={locked} aria-pressed={values[4]>=.5} onClick={()=>write(4,values[4]>=.5?0:1)}>Metronome {values[4]>=.5?"On":"Off"}</button>
      </> : <>
        <div className="util-note">{note} {cents && deviation!=null && <small>{deviation>0?"+":""}{deviation} ¢</small>}</div>
        <div className="pitch-scale"><i style={{left:(50+(deviation??0))+"%",opacity:deviation==null?.25:1}}/></div><div className="pitch-label"><span>−50</span><span>0</span><span>+50</span></div>
        <div className="tuner-bottom"><label><input type="checkbox" checked={mini} onChange={e=>{showMini(e.target.checked);localStorage.setItem("qc-live-tuner",e.target.checked?"1":"0")}}/> Show Live Tuner in footer</label><label>Reference <input type="number" min="400" max="480" step=".1" key={ref} defaultValue={ref} onBlur={e=>{if(e.target.value && e.target.validity.valid)calibrate(Number(e.target.value));else e.target.value=ref}}/> Hz</label></div>
      </>}
    </section></div>}
  </>;
}
