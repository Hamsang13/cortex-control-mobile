import React, {useEffect, useRef, useState} from "react";

const groups = [
  ["Brightness", [
    ["screen_brightness", "Screen", "range"], ["led_brightness", "LEDs", "range"],
    ["dimmed_led_brightness", "Dimmed LEDs", "range"], ["enable_preset_dimmed", "Preset mode"],
    ["enable_scene_dimmed", "Scene mode"], ["enable_stomp_dimmed", "Stomp mode"]]],
  ["Master Volume", ["Out 1/2", "Out 3/4", "Send 1/2", "Headphones"].map((label,i) =>
    ["master_volume_assignment."+["out12","out34","send12","headphones"][i], label])],
  ["Global Bypass", [1,2,3,4].flatMap(n => [["global_bypass_cab.row"+n, "Row "+n+" · Cab"],
    ["global_bypass_ir.row"+n, "Row "+n+" · IR Loader"]])],
  ["Scene Bypass State Behavior", [["scene_block_bypass","Scene block bypass",
    ["Always overwrite","Overwrite except stomp footswitch","Never overwrite"]]]],
  ["Stomp Mode Bypass Assignment", [["stomp_mode_auto_assign","Auto-assign"]]],
  ["Hold Timing", [["hold_timing","Hold time",Array.from({length:6},(_,i)=>(500+i*100)+" ms")]]],
  ["Gig View Access", [["gig_view_stomp_access_enabled","Gig View footswitch access"]]],
  ["Swap Tempo and Tuner Access", [["swap_tempo_tuner_access","Swap Tempo and Tuner"]]],
  ["Dynamic Latency Compensation", [["enable_dynamic_delay_compensation","Dynamic latency compensation"]]],
  ["MIDI Settings", [["midi_channel","Base MIDI channel",Array.from({length:16},(_,i)=>String(i+1))],
    ["midi_thru","MIDI Thru"],["midi_over_usb","MIDI Over USB"],["ignore_duplicate_pc","Ignore duplicate PC"],
    ["midi_clock_out","MIDI clock out",["Off","MIDI DIN","USB MIDI","USB and DIN"]],["midi_clock_in_enabled","MIDI clock in"]]]
];

function Setting({item, value, busy, save}) {
  const [key,label,options]=item;
  const [draft,setDraft]=useState(null);
  const submit=v=>{setDraft(null);if(v!==value)save(key,v)};
  return <label className="setting-field"><span>{label}</span>
    {value==null ? <small>—</small> : (options==="range" || key==="hold_timing") ?
      <><input type="range" min="0" max={key==="hold_timing"?5:100} value={draft??value} disabled={busy}
        onChange={e=>setDraft(Number(e.target.value))} onPointerUp={e=>submit(Number(e.currentTarget.value))}
        onKeyUp={e=>submit(Number(e.currentTarget.value))} onPointerCancel={()=>setDraft(null)}
        onBlur={()=>{if(draft!=null)submit(draft)}}/><output>{key==="hold_timing"?options[draft??value]:(draft??value)+"%"}</output></> :
      options ? <select value={value} disabled={busy} onChange={e=>submit(Number(e.target.value))}>
        {options.map((o,i)=><option key={i} value={key==="midi_channel"?i+1:i}>{o}</option>)}</select> :
      <input type="checkbox" role="switch" checked={value} disabled={busy} onChange={e=>submit(e.target.checked)}/>}
  </label>
}

function PiForm({initial,api}) {
  const [form,setForm]=useState({...initial,wifi:"",key:""});
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e){
    e.preventDefault();setBusy(true);setMessage("");
    try {
      const result=await api("pi-set",form);
      setForm({...result,wifi:"",key:""});
      setMessage("저장했습니다. Pi를 재부팅한 뒤 "+result.ssid+"에 연결하고 "+result.url+"에서 접속 키를 사용하세요.");
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  return <form onSubmit={submit}><p>변경 사항은 다음 Pi 부팅부터 적용됩니다. 새 비밀번호와 접속 키를 보관하세요.</p>
    {[["ssid","Wi-Fi 이름","text"],["wifi","새 Wi-Fi 비밀번호","password"],["url","리모트 접속 URL","url"],["key","새 접속 키","password"]].map(([k,l,type])=>
      <label className="setting-field" key={k}>{l}<input type={type} required={type!=="password"}
        autoComplete={type==="password"?"new-password":"off"} placeholder={type==="password"?"비워 두면 현재 값 유지":""}
        value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}
    <button disabled={busy}>접속 설정 저장</button><p role="status">{message}</p></form>
}

export default function DeviceSettings({api,online,close}){
  const [page,setPage]=useState(groups[0][0]),[values,setValues]=useState(null),[pi,setPi]=useState(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const dialog=useRef(null),writing=useRef(false);
  useEffect(()=>{const el=dialog.current;el.showModal();return ()=>el.close()},[]);
  useEffect(()=>{let active=true;api("pi-settings").then(v=>{if(active)setPi(v)}).catch(e=>{if(active)setError(e.message)});
    return ()=>{active=false}},[api,retry]);
  useEffect(()=>{let active=true;setValues(null);setError("");
    if(online)api("device-settings").then(v=>{if(active)setValues(v)}).catch(e=>{if(active)setError(e.message)});
    return ()=>{active=false}},[api,online,retry]);
  async function save(key,value){
    if(writing.current)return;
    writing.current=true;setBusy(true);setError("");
    try{setValues(await api("device-set",{key,value,previous:values[key]}))}
    catch(e){setError(e.message);try{setValues(await api("device-settings"))}catch{setValues(null)}}
    finally{writing.current=false;setBusy(false)}
  }
  const pages=groups.map(([name])=>name);
  if(pi?.available)pages.push("Raspberry Pi");
  return <dialog ref={dialog} className="settings-dialog" onCancel={close} aria-label="Device Settings"
    onClick={e=>{if(e.target===dialog.current)close()}}>
    <div className="settings-card"><div className="settings-title">Device Settings<button aria-label="설정 닫기" onClick={close}>×</button></div>
      <div className="settings-body"><div className="settings-list">{pages.map(name=>
        <button key={name} aria-pressed={page===name} onClick={()=>setPage(name)}>{name}</button>)}</div>
        <section><select className="settings-mobile-nav" aria-label="설정 항목" value={page} onChange={e=>setPage(e.target.value)}>
          {pages.map(name=><option key={name}>{name}</option>)}</select><h3>{page}</h3>
          {page==="Raspberry Pi"?<PiForm initial={pi} api={api}/>:
            !online?<p>Quad Cortex를 USB로 연결하세요.</p>:values?
            groups.find(([name])=>name===page)[1].map(item=><Setting key={item[0]} item={item} value={values[item[0]]} busy={busy} save={save}/>):
            !error&&<p role="status">본체 설정 읽는 중…</p>}
          {error&&<p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>다시 읽기</button></p>}
        </section></div></div></dialog>
}
