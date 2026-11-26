import React,{useState} from "react";
import {bluetoothMode} from "./bleTransport";
import {watchPiRestart} from "./piReconnect";

export const modeNames={offline:"오프라인",hotspot:"핫스팟",ble:"블루투스"};
export function networkMode(network){
  return ["connected","trial"].includes(network?.phase)?"hotspot":"offline";
}

export default function ConnectionChoice({api,pi,network,onNetwork}){
  const current=bluetoothMode?"ble":networkMode(network);
  const [choice,setChoice]=useState(null),[ssid,setSsid]=useState(""),[password,setPassword]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[entry,setEntry]=useState("");
  const mode=choice??current, phase=network?.phase;
  const station=networkMode(network)==="hotspot";
  const changing=["scheduled","recovering","offline-pending"].includes(phase);
  const endpoint=network?.host&&pi?.url ? "http://"+network.host+":"+new URL(pi.url).port : pi?.url;
  function select(next){
    setChoice(next);setMessage("");setPassword("");setEntry("");
  }
  async function act(action){
    setBusy(true);setMessage("");
    try{
      const result=await api("external-wifi",{action,...(action==="join"?{ssid,password}:action==="confirm"?{ticket:network.ticket}:{})});
      setPassword("");
      if(action==="join"){
        onNetwork(result);
        setMessage("iPad를 "+ssid+"에 연결하고 90초 안에 이 설정에서 연결 유지를 누르세요.");
        if(!bluetoothMode)watchPiRestart({url:result.url+"/#"+location.hash.slice(1),proof:result.proof,wifiTicket:result.ticket});
      }else if(action==="offline"||action==="forget"){
        onNetwork(result.phase?result:{...network,phase:"idle"});
        setMessage("iPad Wi-Fi에서 "+(pi?.ssid||"Pi 핫스팟")+"에 연결하세요.");
        if(!bluetoothMode && result.url && result.proof)watchPiRestart({url:result.url+"/#"+location.hash.slice(1),proof:result.proof});
      }else{onNetwork(result);setMessage(action==="confirm"?"외부 Wi-Fi를 저장했습니다.":"");}
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  function openBluetooth(){
    try{
      const url=window.isSecureContext?new URL(location.href):new URL(entry);
      if(!window.isSecureContext && url.protocol!=="https:")throw Error("HTTPS 주소를 입력하세요.");
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
    <label className="setting-field"><span>연결 모드</span><select aria-label="연결 모드" value={mode} disabled={busy} onChange={e=>select(e.target.value)}>
      <option value="offline">오프라인 (기본)</option><option value="hotspot">핫스팟</option><option value="ble">블루투스</option>
    </select></label>
    <p>{{offline:"iPad를 Pi의 Wi-Fi에 직접 연결합니다. 인터넷이 없는 곳에서도 리모트를 쓸 수 있습니다.",hotspot:"Pi와 iPad를 같은 공유기 또는 휴대폰 핫스팟에 연결합니다.",ble:"iPad의 인터넷 Wi-Fi를 유지하고 Bluefy에서 Pi와 연결합니다."}[mode]}</p>
    {mode==="ble"?<>
      <div className="setting-field"><span>Bluetooth 기기</span><strong>Cortex Remote</strong></div>
      {!bluetoothMode&&<form onSubmit={e=>{e.preventDefault();openBluetooth()}}>
        {!window.isSecureContext&&<label className="setting-field">리모트 HTTPS 주소<input required type="url" value={entry} onChange={e=>setEntry(e.target.value)}/></label>}
        <button>Bluetooth 연결 열기</button></form>}
    </>:<>
      {mode==="offline"&&<div className="setting-field"><span>Wi-Fi 이름</span><strong>{pi?.ssid||"—"}</strong></div>}
      {mode==="hotspot"&&station&&<div className="setting-field"><span>외부 Wi-Fi</span><strong>{network.ssid||"연결됨"}</strong></div>}
      <div className="setting-field"><span>리모트 주소</span><code>{endpoint?.replace(/^https?:\/\//,"")||"—"}</code></div>
      {mode==="hotspot"&&!network?.version&&<p>외부 Wi-Fi 설정은 Pi 네트워크 서비스에 연결하면 사용할 수 있습니다.</p>}
      {mode==="hotspot"&&network?.version&&!changing&&!station&&<form onSubmit={e=>{e.preventDefault();act("join")}}>
        <label className="setting-field">외부 Wi-Fi 이름<input required value={ssid} onChange={e=>setSsid(e.target.value)}/></label>
        <label className="setting-field">Wi-Fi 비밀번호<input required type="password" minLength={8} maxLength={63} autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button disabled={busy}>이 Wi-Fi에 연결</button></form>}
      {changing&&<p role="status">Pi가 Wi-Fi를 전환하고 있습니다.</p>}
      {mode==="hotspot"&&phase==="trial"&&<button disabled={busy} onClick={()=>act("confirm")}>연결 유지</button>}
      {mode==="offline"&&station&&<button disabled={busy} onClick={()=>act(network.canOffline?"offline":"forget")}>{network.canOffline?"Pi 핫스팟으로 전환":"외부 Wi-Fi를 지우고 Pi 핫스팟으로 전환"}</button>}
      {bluetoothMode&&endpoint&&!changing&&mode===networkMode(network)&&<form onSubmit={openWifi}><label className="setting-field">Wi-Fi 리모트 접속 키<input type="password" required autoComplete="off" value={entry} onChange={e=>setEntry(e.target.value)}/></label><button>Wi-Fi 리모트 열기</button></form>}
    </>}
    {message&&<p role="status">{message}</p>}
  </>;
}
