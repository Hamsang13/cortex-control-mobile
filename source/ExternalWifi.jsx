import React,{useEffect,useState} from "react";
import {bluetoothMode} from "./bleTransport";
import {watchPiRestart} from "./piReconnect";

export default function ExternalWifi({api}) {
  const [state,setState]=useState(null),[ssid,setSsid]=useState(""),[password,setPassword]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{
    let mounted=true;
    api("external-wifi",{action:"status"}).then(s=>{if(mounted)setState(s)}).catch(()=>{});
    return ()=>{mounted=false};
  },[api]);
  async function act(action) {
    setBusy(true);setMessage("");
    try {
      const result=await api("external-wifi",{action,...(action==="join"?{ssid,password}:action==="confirm"?{ticket:state.ticket}:{})});
      if(action==="join") {
        setPassword("");setState(result);
        setMessage("iPad를 "+ssid+"에 연결하고 90초 안에 Pi 설정에서 연결 유지를 누르세요. 접속 주소 "+result.url);
        if(!bluetoothMode) watchPiRestart({url:result.url+"/#"+location.hash.slice(1),proof:result.proof,wifiTicket:result.ticket});
      } else if(action==="forget") {
        setState({...state,phase:"idle"});setMessage("iPad에서 Pi 핫스팟에 다시 연결하세요.");
      } else {
        setState(result);if(action==="confirm")setMessage("외부 Wi-Fi를 저장했습니다.");
      }
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  if(!state?.version)return null;
  const joining=["scheduled","trial","recovering"].includes(state.phase);
  return <section><h3>외부 Wi-Fi</h3>
    <p>Pi와 iPad를 같은 공유기 또는 휴대폰 핫스팟에 연결합니다. 전환 중에는 Pi 자체 핫스팟이 닫힙니다.</p>
    {state.phase==="connected"&&<p>외부 Wi-Fi에 연결되어 있습니다.</p>}
    {joining?<button disabled={busy} onClick={()=>act("status")}>연결 상태 확인</button>:<form onSubmit={e=>{e.preventDefault();act("join")}}>
      <label className="setting-field">외부 Wi-Fi 이름<input required value={ssid} onChange={e=>setSsid(e.target.value)}/></label>
      <label className="setting-field">Wi-Fi 비밀번호<input required type="password" autoComplete="off" minLength={8} maxLength={63} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button disabled={busy}>이 Wi-Fi에 연결</button>
    </form>}
    {state.phase==="trial"&&<button disabled={busy} onClick={()=>act("confirm")}>연결 유지</button>}
    {state.phase==="connected"&&<button disabled={busy} onClick={()=>act("forget")}>외부 Wi-Fi를 지우고 Pi 핫스팟으로 복귀</button>}
    {message&&<p role="status">{message}</p>}</section>;
}
