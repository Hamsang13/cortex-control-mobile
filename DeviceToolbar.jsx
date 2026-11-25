import React, {useEffect, useRef, useState} from "react";

export default function DeviceToolbar({api,online,busy,revision,travel,report}) {
  const [status,setStatus]=useState(null), [preview,setPreview]=useState(null);
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
    if(online)poll();else{setStatus(null);setPreview(null);pending.current=null}
    return ()=>{valid=false;clearTimeout(timer)};
  },[online,revision]);
  async function write(value){
    if(!online || !status)return;
    version.current++;
    pending.current=Math.max(0,Math.min(100,value));
    setPreview(pending.current);
    if(sending.current)return;
    sending.current=true;
    try{
      while(pending.current!=null){
        const target=pending.current;
        pending.current=null;
        const actual=await api("master-volume",{value:target/100});
        setStatus(prev=>prev && {...prev,volume:actual.volume});
      }
    }catch(e){pending.current=null;report(e.message)}
    finally{sending.current=false;if(!dial.current)setPreview(null)}
  }
  const value=preview ?? (status?Math.round(status.volume*100):null);
  function move(e){
    const g=dial.current;
    if(!g || g.id!==e.pointerId)return;
    const next=Math.max(0,Math.min(100,Math.round(g.value+(g.y-e.clientY)*.6)));
    if(next!==g.last){g.last=next;write(next)}
  }
  function end(){dial.current=null;if(!sending.current)setPreview(null)}
  return <div className="device-tools">
    {[["undo","실행 취소","↶"],["redo","다시 실행","↷"]].map(([action,label,icon])=>
      <button key={action} title={label} aria-label={label} disabled={!online || busy || !status?.[action]} onClick={()=>travel(action)}>{icon}</button>)}
    <button className="master-dial" role="slider" aria-label="Master Volume" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value ?? undefined} title={"Master Volume · "+(value ?? "—")} disabled={!online || value==null}
      onPointerDown={e=>{if(!e.isPrimary || e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);dial.current={id:e.pointerId,y:e.clientY,value,last:value}}}
      onPointerMove={move} onPointerUp={end} onLostPointerCapture={end} onPointerCancel={end}
      onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();write(value+(["ArrowUp","ArrowRight"].includes(e.key)?1:-1))}}}>
      <i style={{"--turn":(value??0)*2.7-135+"deg"}}/><span>{value??"—"}</span>
    </button>
  </div>;
}
