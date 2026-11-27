import React,{useEffect,useState} from "react";
import {bluetoothMode} from "./bleTransport";
import {watchPiRestart} from "./piReconnect";

const defaultBluetoothUrl = "https://cortexRemote.hamsang";

export const modeNames={offline:"오프라인",hotspot:"핫스팟",ble:"블루투스"};
export function networkMode(network){
  return ["connected","trial"].includes(network?.phase)?"hotspot":"offline";
}

function ExternalWifiForm({api, busy, ownSsid, currentSsid, join, t}) {
  const [attempt,rescan]=useState(0), [scan,setScan]=useState({phase:"loading",names:[]});
  const [selected,setSelected]=useState(""), [manual,setManual]=useState(false);
  const [typed,setTyped]=useState(""), [password,setPassword]=useState("");
  useEffect(()=>{
    let active=true;
    setScan(previous=>({...previous,phase:"loading"}));
    api("external-wifi",{action:"scan"}).then(({ssids})=>{
      if (!active) return;
      const names=[...new Set(ssids.filter(name=>typeof name==="string" && name && name!==ownSsid && name!==currentSsid))];
      setScan({phase:"ready",names});
    }).catch(()=>{if(active)setScan(previous=>({...previous,phase:"failed"}))});
    return ()=>{active=false};
  },[api,attempt,ownSsid,currentSsid]);
  const names=scan.names;
  const ssid=manual?typed:selected;
  return <form onSubmit={e=>{e.preventDefault();if(ssid && !busy)join(ssid,password)}}>
    <label className="setting-field">{t("주변 Wi-Fi")}<select disabled={busy} value={manual?"manual":selected?"ssid:"+selected:""}
      onChange={e=>{const v=e.target.value;setManual(v==="manual");setSelected(v.startsWith("ssid:")?v.slice(5):"");setPassword("")}}>
      <option value="" disabled>{t("네트워크 선택")}</option>
      {selected && !names.includes(selected) && <option value={"ssid:"+selected}>{selected}</option>}
      {names.map(name=><option key={name} value={"ssid:"+name}>{name}</option>)}
      <option value="manual">{t("이름 직접 입력")}</option>
    </select></label>
    {scan.phase==="loading"?<p role="status">{t("주변 Wi-Fi 검색 중…")}</p>:
      <>{(scan.phase==="failed" || !names.length) && <p role="status">{t(scan.phase==="failed"?"Wi-Fi 검색에 실패했습니다. 이름을 직접 입력할 수 있습니다.":"검색된 외부 Wi-Fi가 없습니다. 이름을 직접 입력할 수 있습니다.")}</p>}
        <button type="button" disabled={busy} onClick={()=>rescan(n=>n+1)}>{t("다시 검색")}</button></>}
    {manual && <label className="setting-field">{t("외부 Wi-Fi 이름")}<input required disabled={busy} value={typed}
      onChange={e=>{setTyped(e.target.value);setPassword("")}}/></label>}
    {(manual || selected) && <label className="setting-field">{t("Wi-Fi 비밀번호")}<input required disabled={busy} type="password" minLength={8} maxLength={63} autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label>}
    <button disabled={busy || !ssid || password.length<8}>{t("이 Wi-Fi에 연결")}</button>
  </form>;
}

export default function ConnectionChoice({api,pi,network,onNetwork,t,language}){
  const current=bluetoothMode?"ble":networkMode(network);
  const [choice,setChoice]=useState(null);
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[entry,setEntry]=useState("");
  const mode=choice??current, phase=network?.phase;
  const station=networkMode(network)==="hotspot";
  const changing=["scheduled","recovering","offline-pending"].includes(phase);
  const endpoint=network?.host&&pi?.url ? "http://"+network.host+":"+new URL(pi.url).port : pi?.url;
  function select(next){
    setChoice(next);setMessage("");setEntry(next==="ble"?defaultBluetoothUrl:"");
  }
  async function act(action,ssid,password){
    setBusy(true);setMessage("");
    try{
      const result=await api("external-wifi",{action,...(action==="join"?{ssid,password}:action==="confirm"?{ticket:network.ticket}:{})});
      if(action==="join"){
        onNetwork(result);
        setMessage(bluetoothMode?t("90초 안에 연결 유지를 누르세요."):
          language==="en"?`Connect your iPad to ${ssid} and select Keep connection within 90 seconds.`:"iPad를 "+ssid+"에 연결하고 90초 안에 이 설정에서 연결 유지를 누르세요.");
        if(!bluetoothMode)watchPiRestart({url:result.url+"/#"+(result.accessKey||location.hash.slice(1)),proof:result.proof,wifiTicket:result.ticket});
      }else if(action==="offline"||action==="forget"){
        onNetwork(result.phase?result:{...network,phase:"idle"});
        setMessage(language==="en"?`Connect your iPad to ${pi?.ssid||"the device hotspot"}.`:"iPad Wi-Fi에서 "+(pi?.ssid||"리모트 디바이스 핫스팟")+"에 연결하세요.");
        if(!bluetoothMode && result.url && result.proof)watchPiRestart({url:result.url+"/",proof:result.proof});
      }else{onNetwork(result);setMessage(action==="confirm"?t("외부 Wi-Fi를 저장했습니다."):"");}
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  function openBluetooth(){
    try{
      const url=new URL(entry || defaultBluetoothUrl);
      if(url.protocol!=="https:")throw Error(t("HTTPS 주소를 입력하세요."));
      url.hash="";url.searchParams.set("transport","ble");location.assign(url);
    }catch(e){setMessage(e.message)}
  }
  function openWifi(e){
    e.preventDefault();
    try{
      const url=new URL(endpoint);
      url.hash=entry;location.assign(url);
    }catch(e){setMessage(e.message)}
  }
  return <>
    <label className="setting-field"><span>{t("연결 모드")}</span><select aria-label={t("연결 모드")} value={mode} disabled={busy} onChange={e=>select(e.target.value)}>
      <option value="offline">{t("오프라인 (기본)")}</option><option value="hotspot">{t("핫스팟")}</option><option value="ble">{t("블루투스")}</option>
    </select></label>
    <p>{t({offline:"iPad를 리모트 디바이스의 Wi-Fi에 직접 연결합니다. 인터넷이 없는 곳에서도 리모트를 쓸 수 있습니다.",hotspot:"리모트 디바이스와 iPad를 같은 공유기 또는 휴대폰 핫스팟에 연결합니다.",ble:"iPad의 인터넷 Wi-Fi를 유지하고 Bluefy에서 리모트 디바이스와 연결합니다."}[mode])}</p>
    {mode==="ble"?<>
      <div className="setting-field"><span>{t("Bluetooth 기기")}</span><strong>Cortex Remote</strong></div>
      {!bluetoothMode&&<form onSubmit={e=>{e.preventDefault();openBluetooth()}}>
        <label className="setting-field">{t("리모트 HTTPS 주소")}<input required type="url" value={entry} onChange={e=>setEntry(e.target.value)}/></label>
        <button>{t("Bluetooth 연결 열기")}</button></form>}
    </>:<>
      {mode==="offline"&&<div className="setting-field"><span>{t("Wi-Fi 이름")}</span><strong>{pi?.ssid||"—"}</strong></div>}
      {mode==="hotspot"&&station&&<div className="setting-field"><span>{t("외부 Wi-Fi")}</span><strong>{network.ssid||t("연결됨")}</strong></div>}
      <div className="setting-field"><span>{t("리모트 주소")}</span><code>{endpoint?.replace(/^https?:\/\//,"")||"—"}</code></div>
      {mode==="hotspot"&&!network?.version&&<p>{t("외부 Wi-Fi 설정은 리모트 디바이스 네트워크 서비스에 연결하면 사용할 수 있습니다.")}</p>}
      {mode==="hotspot"&&network?.version&&!changing&&phase!=="trial"&&<ExternalWifiForm api={api} t={t} busy={busy}
        ownSsid={pi?.ssid} currentSsid={station?network.ssid:""} join={(ssid,password)=>act("join",ssid,password)}/>}
      {changing&&<p role="status">{t("리모트 디바이스가 Wi-Fi를 전환하고 있습니다.")}</p>}
      {mode==="hotspot"&&phase==="trial"&&<button disabled={busy} onClick={()=>act("confirm")}>{t("연결 유지")}</button>}
      {mode==="offline"&&station&&<button disabled={busy} onClick={()=>act(network.canOffline?"offline":"forget")}>{t(network.canOffline?"리모트 디바이스 핫스팟으로 전환":"외부 Wi-Fi를 지우고 리모트 디바이스 핫스팟으로 전환")}</button>}
      {bluetoothMode&&endpoint&&!changing&&mode===networkMode(network)&&<form onSubmit={openWifi}>{station && <label className="setting-field">{t("Wi-Fi 리모트 접속 키")}<input type="password" required autoComplete="off" value={entry} onChange={e=>setEntry(e.target.value)}/></label>}<button>{t("Wi-Fi 리모트 열기")}</button></form>}
    </>}
    {message&&<p role="status">{message}</p>}
  </>;
}
