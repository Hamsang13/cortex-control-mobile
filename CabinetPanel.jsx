import React, {useRef, useState} from "react";

const clamp = v => Math.max(0,Math.min(1,v));
const colors = ["#7153ff","#ffcf32"];

function DragPoint({x,y,label,color,disabled,onDrop,onPreview,originX,bounds=[0,1],children}) {
  const [preview,setPreview]=useState(null);
  const drag=useRef(null);
  function move(e) {
    const g=drag.current;
    if (!g || e.pointerId!==g.id) return;
    const rect=e.currentTarget.parentElement.getBoundingClientRect();
    g.point=[Math.max(bounds[0],Math.min(bounds[1],g.startX+(e.clientX-g.x)/rect.width)),clamp(g.startY+(e.clientY-g.y)/rect.height)];
    setPreview(g.point);
    onPreview?.(g.point);
  }
  const px=preview?.[0]??x, py=children?y:preview?.[1]??y;
  return <>
    {originX!=null && <svg className="cab-guide" aria-hidden="true">
      <line x1={originX*100+"%"} y1="0" x2={px*100+"%"} y2={py*100+"%"}
        stroke="#ddd" strokeWidth="1" strokeDasharray="1 3" strokeLinecap="round"/>
      {[.3,.6].map((fraction,i)=><circle key={fraction}
        cx={(originX+(px-originX)*fraction)*100+"%"} cy={py*fraction*100+"%"}
        r={i?6:3.5} fill={color}/>)}
    </svg>}
    <button type="button" className="cab-point" disabled={disabled} aria-label={label}
    style={{left:100*px+"%",top:100*py+"%",background:color}}
    onPointerDown={e=>{
      if (!e.isPrimary || e.button!==0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,startX:x,startY:y};
    }} onPointerMove={move} onPointerUp={e=>{
      const g=drag.current;
      if (g?.id!==e.pointerId) return;
      drag.current=null;setPreview(null);
      if(g.point) onDrop(...g.point);
      onPreview?.(null);
    }} onLostPointerCapture={()=>{drag.current=null;setPreview(null);onPreview?.(null)}}
    onKeyDown={e=>{
      const delta={ArrowRight:[.01,0],ArrowLeft:[-.01,0],ArrowDown:[0,.01],ArrowUp:[0,-.01]}[e.key];
      if(delta){e.preventDefault();onDrop(clamp(x+delta[0]),clamp(y+delta[1]))}
    }}>{children}</button></>;
}

export default function CabinetPanel({block,scene,busy,readOnly,previewCabinet,commit,assign,bypass,Parameter}){
  const [page,setPage]=useState(0);
  const [moving,setMoving]=useState(null);
  const params=block.params, at=index=>params.find(p=>p.index===index);
  const value=p=>p?.values[p.assigned?scene:0]??0;
  const previewable=p=>[4,5,12,13].includes(p.index) || ["HPF","LPF","OUTPUT VOLUME"].includes(p.name);
  const control=(p,label,overrides={})=>p && <Parameter key={p.index} scene={scene} readOnly={readOnly && !(previewCabinet && previewable(p))}
    busy={busy} p={{...p,name:label,...overrides,values:moving?.[p.index]==null ? p.values :
      p.values.map((v,i)=>i===(p.assigned?scene:0)?moving[p.index]:v)}} assign={()=>{if(!readOnly)assign(p)}} commit={v=>(previewCabinet && previewable(p)?previewCabinet:commit)(p,v)}/>;
  const high=params.find(p=>p.name==="HPF"), low=params.find(p=>p.name==="LPF");
  const output=params.find(p=>p.name==="OUTPUT VOLUME");
  const tabs=["마이크 위치","캐비넷 필터"];
  function micHeader(n){
    return <div className="cab-mic-head">
      {control(at(n+1),"MIC "+(n/8+1))}
      <div className="cab-toggle">{control(at(n),"MIC "+(n/8+1)+" BYPASS")}</div>
    </div>;
  }
  function side(n){
    const offsets=n?[5,2,4,3]:[2,5,3,4];
    return <div className="cab-side" style={{"--c":colors[n/8]}}>
      {offsets.map(i=>control(at(n+i),({2:"LEVEL",3:"PAN",4:"DIST",5:"POSITION"})[i],
        i===3?{pan:true}:i===2 && at(n+i)?.normalized ? {normalized:false,min:-40,max:6,offAt:0}:{}))}
      <div className="cab-phase">{control(at(n+6),"Phase",{options:["Ø","Ø"]})}</div>
    </div>;
  }
  const hz=p=>p.min+(p.max-p.min)*(moving?.[p.index]??value(p))**(p.exponent??1);
  const logX=p=>clamp(Math.log(hz(p)/20)/Math.log(1000));
  function cutoff(p,x) {
    const frequency=20*1000**x;
    return clamp((frequency-p.min)/(p.max-p.min))**(1/(p.exponent??1));
  }
  const response=high && low ? `M0 ${logX(high)>.001?93:50} L${logX(high)*100} 50 H${logX(low)*100} L100 ${logX(low)<.999?93:50}` : "";
  return <section className="panel cabinet" aria-label={block.name}>
    {micHeader(0)}
    <div className="cab-title"><strong title={block.name}>{block.name}</strong>
      {tabs.map((label,i)=><button key={label} aria-label={label} aria-pressed={page===i} onClick={()=>setPage(i)}>{i+1}</button>)}
      <button aria-label="캐비넷 바이패스" aria-pressed={block.bypass[scene]} disabled={busy||readOnly} onClick={bypass}>⏻</button>
    </div>
    {micHeader(8)}
    {side(0)}
    <div className="cab-center">
      {page===0 ? <div className="cab-field">
        {[0,8].map(n=>{
          const pos=at(n+5), dist=at(n+4);
          if(!pos || !dist)return null;
          const originX=n?0:1;
          const position=x=>n?x:1-x;
          return <div className="cab-cone" key={n} style={{"--origin":originX*100+"%"}}>
            <DragPoint label={"MIC "+(n/8+1)+" 위치와 거리"} color={colors[n/8]} disabled={busy||(readOnly&&!previewCabinet)}
              originX={originX} x={position(value(pos))} y={value(dist)}
              onPreview={point=>setMoving(point?{[pos.index]:position(point[0]),[dist.index]:point[1]}:null)}
              onDrop={async(x,y)=>{const write=previewCabinet??commit;await write(pos,position(x));await write(dist,y)}}/>
          </div>;
        })}
      </div> : <>
        {high && low && <div className="cab-filter"><div className="cab-hz" aria-hidden="true">{["Hz","100","1k","10k"].map((tick,i)=><span key={tick} style={{left:[0,23,57,90][i]+"%"}}>{tick}</span>)}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={response+" V100 H0 Z"} fill="#ffffff19"/>
          <path d={response} fill="none" stroke="#ddd" vectorEffect="non-scaling-stroke"/></svg>
          {[high,low].map((p,i)=><DragPoint key={p.index} label={p.name} color="#eee" disabled={busy||(readOnly&&!previewCabinet)} x={logX(p)} y={.5}
            bounds={[Math.log(p.min/20)/Math.log(1000),Math.log(p.max/20)/Math.log(1000)]}
            onPreview={point=>setMoving(point?{[p.index]:cutoff(p,point[0])}:null)}
            onDrop={x=>(previewCabinet??commit)(p,cutoff(p,x))}>{i?"L":"H"}</DragPoint>)}
        </div>}
        <div className="cab-filter-knobs">{[high,output,low].map(p=>control(p,p?.name,p===high?{offAt:0}:p===low?{offAt:1}:{}))}</div>
      </>}
    </div>
    {side(8)}
  </section>;
}
