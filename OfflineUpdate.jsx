import React,{useEffect,useState} from "react";

export default function OfflineUpdate({api}) {
  const [file,setFile]=useState(null), [message,setMessage]=useState(""), [busy,setBusy]=useState(false);
  const [available,setAvailable]=useState(false);
  useEffect(()=>{
    let mounted=true;
    api("update-status").then(s=>{
      if(!mounted)return;
      setAvailable(s.available);
      if(s.status==="rollback")setMessage("마지막 업데이트가 실패해 이전 버전으로 복구했습니다.");
    }).catch(()=>{});
    return ()=>{mounted=false};
  },[api]);
  async function apply(){
    if(!file || busy)return;
    setBusy(true);
    try{
      setMessage("ZIP 업로드 및 서명 확인 중…");
      const response=await fetch("/api/update-zip",{method:"POST",headers:{"X-QC-Key":location.hash.slice(1)},body:file});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"업로드 실패");
      setMessage("앱을 다시 시작하고 있습니다. Wi-Fi 연결을 유지하세요.");
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
  return <section><h3>오프라인 앱 업데이트</h3>
    <label>업데이트 ZIP <input type="file" accept=".zip,application/zip" disabled={busy}
      onChange={e=>setFile(e.target.files[0]||null)}/></label>
    <button disabled={!file||busy} onClick={apply}>업데이트 적용</button><p role="status">{message}</p>
  </section>
}
