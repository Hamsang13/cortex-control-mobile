import React,{useEffect,useState} from "react";
import {bluetoothMode} from "./bleTransport";

export default function OfflineUpdate({api,admin}) {
  const [file,setFile]=useState(null), [message,setMessage]=useState(""), [busy,setBusy]=useState(false);
  const [available,setAvailable]=useState(false), [release,setRelease]=useState(null);
  const [checking,setChecking]=useState(false),[attempt,recheck]=useState(0),[notice,setNotice]=useState("");
  useEffect(()=>{
    let mounted=true;
    api("update-status").then(s=>{
      if(!mounted)return;
      setAvailable(s.available);
      if(s.status==="rollback")setMessage("마지막 업데이트가 실패해 이전 버전으로 복구했습니다.");
    }).catch(()=>{});
    return ()=>{mounted=false};
  },[api]);
  useEffect(()=>{
    if(!available)return;
    let active=true;
    setChecking(true);setRelease(null);setNotice("GitHub에서 새 빌드를 확인하는 중…");
    api("online-check").then(info=>{
      if(active){setRelease(info);setNotice(info.available?"설치 가능한 빌드 "+info.build.slice(0,7):"최신 빌드입니다.");}
    }).catch(e=>{if(active)setNotice(e.message)}).finally(()=>{if(active)setChecking(false)});
    return ()=>{active=false};
  },[available,attempt,api]);
  async function apply(online){
    if(busy || (online?!release?.available:!file))return;
    setBusy(true);
    try{
      let data;
      if(online){
        setMessage("Pi에서 다운로드 및 서명 확인 중…");
        data=await api("online-install",{build:release.build});
      }else{
        setMessage("ZIP 업로드 및 서명 확인 중…");
        const response=await fetch("/api/update-zip",{method:"POST",headers:{"X-QC-Key":location.hash.slice(1),"X-QC-Admin":admin.current},body:file});
        data=await response.json();
        if(!response.ok)throw Error(data.error||"업로드 실패");
      }
      setMessage("앱을 다시 시작하고 있습니다.");
      for(let i=0;i<75;i++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        let state;
        try{state=await api("update-status")}catch{continue}
        if(state.ticket!==data.ticket)continue;
        if(state.status==="rollback")throw Error("새 앱이 시작되지 않아 이전 버전으로 복구했습니다.");
        if(state.status==="applied"){location.reload();return}
      }
      throw Error("기동 확인이 지연되었습니다. 잠시 후 설정을 다시 열어 주세요.");
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  if(!available)return null;
  return <section className="pi-update-panel"><h3>온라인 앱 업데이트</h3><p role="status">{notice}</p>
    <button disabled={busy||checking} onClick={()=>recheck(v=>v+1)}>다시 확인</button>
    {release?.available&&<button className="install-update" disabled={busy||checking} onClick={()=>apply(true)}>업데이트 설치</button>}
    {!bluetoothMode&&<><h3>오프라인 앱 업데이트</h3>
    <label>업데이트 ZIP <input type="file" accept=".zip,application/zip" disabled={busy}
      onChange={e=>setFile(e.target.files[0]||null)}/></label>
    <button disabled={!file||busy} onClick={()=>apply(false)}>업데이트 적용</button></>}
    <p role="status">{message}</p></section>;
}
