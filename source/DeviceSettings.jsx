import {useQueuedSettings} from "./useQueuedSettings";
import SaveIcon from "./SaveIcon";
import ConnectionChoice from "./ConnectionChoice";
import {bluetoothMode} from "./bleTransport";
import OfflineUpdate from "./OfflineUpdate";
import {watchPiRestart} from "./piReconnect";
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

const pageHelp = {
  Brightness: ["화면과 풋스위치 LED 밝기를 조절합니다. 프리셋·씬·스톰프 스위치는 각 모드에서 비활성 LED에 ‘어두운 LED’ 밝기를 적용할지 정합니다.", "Adjust the screen and footswitch LED brightness. The Preset, Scene and Stomp switches choose which modes use the Dimmed LEDs level for inactive footswitches."],
  "Master Volume": ["본체 마스터 볼륨 노브로 음량을 조절할 출력을 선택합니다.", "Choose which outputs follow the master volume knob on the Quad Cortex."],
  "Global Bypass": ["그리드의 각 행에서 캐비넷 또는 IR 블록을 일괄 바이패스합니다.", "Choose which grid rows bypass their cabinet or impulse response blocks."],
  "Scene Bypass State Behavior": ["씬에서 블록을 켜거나 끌 때 그 변경을 현재 씬에 반영할지 정합니다. 스톰프 풋스위치로 바꾼 경우만 제외할 수도 있습니다.", "Choose when switching a block on or off updates its bypass state in the current scene. You can exclude changes made with a Stomp footswitch."],
  "Stomp Mode Bypass Assignment": ["새 블록의 바이패스를 스톰프 풋스위치에 자동으로 할당할지 정합니다.", "Choose whether new blocks are automatically assigned to a Stomp footswitch for bypass control."],
  "Hold Timing": ["본체 풋스위치를 얼마나 오래 눌러야 길게 누르기로 인식할지 정합니다.", "Set how long you hold a footswitch before the Quad Cortex recognizes a long press."],
  "Gig View Access": ["풋스위치로 긱 뷰를 열 수 있도록 설정합니다.", "Enable footswitch access to Gig View."],
  "Swap Tempo and Tuner Access": ["템포와 튜너를 여는 풋스위치 조작을 서로 바꿉니다.", "Swap the footswitch actions that open Tempo and Tuner."],
  "Dynamic Latency Compensation": ["병렬 신호 경로 사이의 처리 지연 차이를 본체가 보정하도록 설정합니다.", "Enable compensation for processing delays between parallel signal paths."],
  "MIDI Settings": ["MIDI 채널과 클록 송수신, MIDI Thru, USB MIDI 및 중복 프로그램 변경 메시지 처리를 설정합니다.", "Configure the MIDI channel, clock input and output, MIDI Thru, USB MIDI and duplicate program changes."],
  "연결 방식": ["iPad에서 리모트 디바이스에 연결할 방법을 선택합니다. 외부 Wi-Fi도 여기에서 설정합니다.", "Choose how the iPad connects to the remote device, or join an external Wi-Fi network."],
  "리모트 디바이스": ["리모트 디바이스의 핫스팟 이름과 비밀번호, 접속 주소와 키를 바꾸거나 앱을 업데이트합니다.", "Change the remote device’s hotspot credentials, access URL and key, or update the app."],
  Language: ["최초 설정과 설정 메뉴, 연결 및 로딩 안내에 사용할 언어를 선택합니다.", "Choose the language for setup, settings, and connection and loading messages."],
};

function SettingsHeading({page, pages, setPage, t, language}) {
  const [open,setOpen]=useState(false);
  const button=useRef(null), bubble=useRef(null);
  useEffect(()=>{
    if (!open) return;
    function outside(e){
      if (!button.current?.contains(e.target) && !bubble.current?.contains(e.target)) setOpen(false);
    }
    function escape(e){
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setOpen(false);button.current?.focus()}
    }
    document.addEventListener("pointerdown",outside,true);
    document.addEventListener("keydown",escape,true);
    return ()=>{
      document.removeEventListener("pointerdown",outside,true);
      document.removeEventListener("keydown",escape,true);
    };
  },[open]);
  return <div className="settings-heading">
    <select className="settings-mobile-nav" aria-label={t("설정 항목")} value={page} onChange={e=>setPage(e.target.value)}>
      {pages.map(name=><option key={name} value={name}>{t(name)}</option>)}
    </select>
    <h3>{t(page)}</h3>
    <button type="button" className="settings-info" ref={button} aria-label={language==="ko"?t(page)+" 설명":"About "+t(page)}
      aria-controls={open?"settings-help":undefined} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span aria-hidden="true">i</span></button>
    {open && <p id="settings-help" className="settings-help" ref={bubble}>{pageHelp[page][language==="ko"?0:1]}</p>}
  </div>;
}

function Setting({item, value, save, t}) {
  const [key,label,options]=item;
  const [draft,setDraft]=useState(null);
  const submit=v=>{setDraft(null);if(v!==value)save(key,v)};
  const range=options==="range" || key==="hold_timing";
  return <label className={"setting-field"+(range?" setting-range":"")}><span>{t(label)}</span>
    {value==null ? <small>—</small> : range ?
      <><input type="range" min="0" max={key==="hold_timing"?5:100} value={draft??value}
        onChange={e=>setDraft(Number(e.target.value))} onPointerUp={e=>submit(Number(e.currentTarget.value))}
        onKeyUp={e=>submit(Number(e.currentTarget.value))} onPointerCancel={()=>setDraft(null)}
        onBlur={()=>{if(draft!=null)submit(draft)}}/><output>{key==="hold_timing"?options[draft??value]:(draft??value)+"%"}</output></> :
      options ? <select value={value} onChange={e=>submit(Number(e.target.value))}>
        {options.map((o,i)=><option key={i} value={key==="midi_channel"?i+1:i}>{t(o)}</option>)}</select> :
      <input type="checkbox" role="switch" checked={value} onChange={e=>submit(e.target.checked)}/>}
  </label>
}

function PiForm({initial,api,t,language}) {
  const [form,setForm]=useState({...initial,wifi:"",key:""});
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e){
    e.preventDefault();setBusy(true);setMessage("");
    try {
      const result=await api("pi-set",form);
      const {reconnect,...settings}=result;
      setForm({...settings,wifi:"",key:""});
      if(reconnect && !bluetoothMode)watchPiRestart(reconnect);
      setMessage(bluetoothMode ? t("저장했습니다. 리모트 디바이스 재부팅 후 Bluetooth로 다시 연결하세요.") : language==="en" ? `Saved. Keep this tab open. After restarting, connect to ${result.ssid} to return to ${result.url}.` : "저장했습니다. 이 탭을 열어 두세요. 리모트 디바이스 재부팅 후 "+result.ssid+"에 연결되면 "+result.url+"로 자동 이동합니다. Wi-Fi 이름이나 비밀번호를 바꿨다면 Wi-Fi 설정에서 다시 연결하세요.");
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  return <form className="pi-connection-form" onSubmit={submit}><p>{t("변경 사항은 다음 리모트 디바이스 부팅부터 적용됩니다. 새 비밀번호와 접속 키를 보관하세요.")}</p>
    {[["ssid","Wi-Fi 이름","text"],["wifi","새 Wi-Fi 비밀번호","password"],["url","리모트 접속 URL","url"],["key","새 접속 키","password"]].map(([k,l,type])=>
      <label className="setting-field" key={k}>{t(l)}<input type={type} required={type!=="password"}
        autoComplete={type==="password"?"new-password":"off"} placeholder={type==="password"?t("비워 두면 현재 값 유지"):""}
        value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}
    <button disabled={busy}><SaveIcon size={15}/>{t("접속 설정 저장")}</button><p role="status">{message}</p></form>
}

export default function DeviceSettings({api,online,close,network,onNetwork,settingsLanguage}){
  const {language,changeLanguage,t}=settingsLanguage;
  const [page,setPage]=useState("연결 방식"),[values,setValues]=useState(null),[pi,setPi]=useState(null);
  const [error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [piError,setPiError]=useState(""),[piRetry,setPiRetry]=useState(0);
  const dialog=useRef(null);
  useEffect(()=>{const el=dialog.current;el.showModal();return ()=>el.close()},[]);
  useEffect(()=>{let active=true;setPi(null);setPiError("");api("pi-settings").then(v=>{if(active)setPi(v)}).catch(e=>{if(active)setPiError(e.message)});
    return ()=>{active=false}},[api,piRetry]);
  useEffect(()=>{let active=true;setValues(null);setError("");
    if(online)api("device-settings").then(v=>{if(active)setValues(v)}).catch(e=>{if(active)setError(e.message)});
    return ()=>{active=false}},[api,online,retry]);
  const edits=useQueuedSettings(online,values,
    (key,value,previous)=>api("device-set",{key,value,previous}),
    setValues,async error=>{
      setError(error.message);
      return api("device-settings").catch(()=>{setValues(null)});
    });
  function save(key,value){setError("");return edits.enqueue([[key,value]])}
  const pages=[...groups.map(([name])=>name), "연결 방식", "리모트 디바이스","Language"];
  return <dialog ref={dialog} className="settings-dialog" onCancel={close} lang={language} aria-label={t("Device Settings")}
    onClick={e=>{if(e.target===dialog.current)close()}}>
    <div className="settings-card"><div className="settings-title">{t("Device Settings")}<button aria-label={t("설정 닫기")} onClick={close}>×</button></div>
      <div className="settings-body"><div className="settings-list">{pages.map(name=>
        <button key={name} aria-pressed={page===name} onClick={()=>setPage(name)}>{t(name)}</button>)}</div>
        <section className={page==="리모트 디바이스" ? "pi-settings-page" : undefined}><SettingsHeading key={page} {...{page,pages,setPage,t,language}}/>
          {page==="Language"?<label className="setting-field">{t("Language")}<select value={language} onChange={e=>changeLanguage(e.target.value)}><option value="en">English</option><option value="ko">한국어</option></select></label>:page==="연결 방식"?<ConnectionChoice t={t} language={language} api={api} pi={pi} network={network} onNetwork={onNetwork}/>: page==="리모트 디바이스"?pi?.available?<><PiForm t={t} language={language} initial={pi} api={api}/><OfflineUpdate t={t} api={api}/></>:piError?<p role="alert">{t("리모트 디바이스 설정을 읽을 수 없습니다. 리모트 디바이스에서 실행 중인 Cortex Remote에 접속하세요.")} <button onClick={()=>setPiRetry(v=>v+1)}>{t("다시 읽기")}</button></p>:pi?<p>{t("핫스팟 이름·비밀번호와 리모트 주소·접속 키는 리모트 디바이스에서 실행 중인 Cortex Remote에 접속하면 변경할 수 있습니다.")}</p>:<p role="status">{t("리모트 디바이스 설정을 읽는 중입니다.")}</p>:
            !online?<p>{t("Quad Cortex를 USB로 연결하세요.")}</p>:values?
            groups.find(([name])=>name===page)[1].map(item=><Setting t={t} key={item[0]} item={item} value={edits.draft[item[0]]??values[item[0]]} save={save}/>):
            !error&&<p role="status">{t("본체 설정 읽는 중…")}</p>}
          {error&&page!=="Language"&&page!=="리모트 디바이스"&&page!=="연결 방식"&&<p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>{t("다시 읽기")}</button></p>}
        </section></div></div></dialog>
}
