import React, {useEffect, useRef, useState} from "react";

export default function DeviceToolbar({api,online,busy,revision,travel,report}) {
  const [status,setStatus]=useState(null), [preview,setPreview]=useState(null);
  const [master,setMaster]=useState(null), [locked,setLocked]=useState(true);
  const lockRef=useRef(true);
  const dial=useRef(null), pending=useRef(null), sending=useRef(false), version=useRef(0);
  useEffect(()=>{
    let valid=true,timer;
    async function poll(){
      const before=version.current;
      if(!document.hidden && !sending.current)try{
        const next=await api("toolbar");
        if(valid && before===version.current)setStatus(next);
      }catch(e){if(valid){setStatus(null);report(e.message)}}
      if(valid)timer=setTimeout(poll,1500);
    }
    if(online)poll();else setStatus(null);
    return ()=>{valid=false;clearTimeout(timer)};
  },[online,revision]);
  useEffect(()=>{
    let valid=true,timer;
    lockRef.current=true;
    setLocked(true);
    setPreview(null);
    setMaster(null);
    pending.current=null;
    dial.current=null;
    version.current++;
    async function refresh(){
      const before=version.current;
      if(!document.hidden && !sending.current){
        try{
          const state=await api("master-state");
          if(valid && before===version.current && !sending.current)setMaster(state);
        }catch{if(valid && before===version.current)setMaster(null)}
      }
      if(valid)timer=setTimeout(refresh, document.hidden?1000:150);
    }
    if(online)refresh();
    return ()=>{valid=false;clearTimeout(timer)};
  },[online]);
  function toggleLock(){
    lockRef.current=!lockRef.current;
    setLocked(lockRef.current);
    if(lockRef.current){
      pending.current=null;
      dial.current=null;
      setPreview(null);
    }
  }
  async function write(value){
    if(lockRef.current || !online || !master)return;
    version.current++;
    pending.current=Math.max(0,Math.min(100,value));
    setPreview(pending.current);
    if(sending.current)return;
    sending.current=true;
    try{
      while(!lockRef.current && pending.current!=null){
        const target=pending.current;
        pending.current=null;
        const actual=await api("master-volume",{value:target/100});
        setMaster(actual);
      }
    }catch(e){pending.current=null;report(e.message)}
    finally{sending.current=false;if(!dial.current)setPreview(null)}
  }
  const value=preview ?? (master?Math.round(master.volume*100):null);
  function move(e){
    const g=dial.current;
    if(lockRef.current || !g || g.id!==e.pointerId)return;
    const next=Math.max(0,Math.min(100,Math.round(g.value+(g.y-e.clientY)*.6)));
    if(next!==g.last){g.last=next;write(next)}
  }
  function end(){dial.current=null;if(!sending.current)setPreview(null)}
  return <div className="device-tools">
    {[["undo","실행 취소","↶"],["redo","다시 실행","↷"]].map(([action,label,icon])=>
      <button key={action} title={label} aria-label={label} disabled={!online || busy || !status?.[action]} onClick={()=>travel(action)}>{icon}</button>)}
    <button className={"master-dial"+(master?.engaged===false?" pickup":"")} role="slider" aria-label="Master Volume" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value ?? undefined} title={"Master Volume · "+(value ?? "—")} disabled={locked || !online || value==null}
      onPointerDown={e=>{if(lockRef.current || !e.isPrimary || e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);dial.current={id:e.pointerId,y:e.clientY,value,last:value}}}
      onPointerMove={move} onPointerUp={end} onLostPointerCapture={end} onPointerCancel={end}
      onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();write(value+(["ArrowUp","ArrowRight"].includes(e.key)?1:-1))}}}>
      <i style={{"--turn":(value??0)*2.7-135+"deg"}}/><span>{value??"—"}</span>
    </button>
    <button className="master-lock" aria-label="마스터 볼륨 잠금" aria-pressed={locked}
      title={locked?"마스터 볼륨 잠금 해제":"마스터 볼륨 잠그기"} disabled={!online || value==null}
      onClick={toggleLock}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="5" y="10" width="14" height="11" rx="2"/><path d={locked?"M8 10V7a4 4 0 0 1 8 0v3":"M8 10V7a4 4 0 0 1 8 0"}/>
      </svg>
    </button>
  </div>;
}
