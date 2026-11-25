import React, {useRef, useState} from "react";

const clamp = v => Math.max(0,Math.min(1,v));
const colors = ["#7153ff","#ffcf32"];

function DragPoint({x,y,label,color,disabled,onDrop,children}) {
  const [preview,setPreview]=useState(null);
  const drag=useRef(null);
  function move(e) {
    const g=drag.current;
    if (!g || e.pointerId!==g.id) return;
    const rect=e.currentTarget.parentElement.getBoundingClientRect();
    g.point=[clamp(x+(e.clientX-g.x)/rect.width),clamp(y+(e.clientY-g.y)/rect.height)];
    setPreview(g.point);
  }
  return <button type="button" className="cab-point" disabled={disabled} aria-label={label}
    style={{left:100*(preview?.[0]??x)+"%",top:100*(children?y:preview?.[1]??y)+"%",background:color}}
    onPointerDown={e=>{
      if (!e.isPrimary || e.button!==0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};
    }} onPointerMove={move} onPointerUp={e=>{
      const g=drag.current;
      if (g?.id!==e.pointerId) return;
      drag.current=null;setPreview(null);
      if(g.point) onDrop(...g.point);
    }} onLostPointerCapture={()=>{drag.current=null;setPreview(null)}}
    onKeyDown={e=>{
      const delta={ArrowRight:[.01,0],ArrowLeft:[-.01,0],ArrowDown:[0,.01],ArrowUp:[0,-.01]}[e.key];
      if(delta){e.preventDefault();onDrop(clamp(x+delta[0]),clamp(y+delta[1]))}
    }}>{children}</button>;
}

export default function CabinetPanel({block,scene,busy,readOnly,commit,assign,bypass,Parameter}){
  const [page,setPage]=useState(0);
  const params=block.params, at=index=>params.find(p=>p.index===index);
  const value=p=>p?.values[p.assigned?scene:0]??0;
  const control=(p,label,overrides={})=>p && <Parameter key={p.index} scene={scene} readOnly={readOnly}
    busy={busy} p={{...p,name:label,...overrides}} assign={()=>assign(p)} commit={v=>commit(p,v)}/>;
  const high=params.find(p=>p.name==="HPF"), low=params.find(p=>p.name==="LPF");
  const output=params.find(p=>p.name==="OUTPUT VOLUME");
  const extra=params.filter(p=>(p.index>=16 && ![high,low,output].includes(p)) || [7,15].includes(p.index));
  const tabs=["마이크 위치","캐비넷 필터",...(extra.length?["추가 파라미터"]:[])];
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
  const hz=p=>p.min+(p.max-p.min)*value(p)**(p.exponent??1);
  const logX=p=>clamp(Math.log(hz(p)/20)/Math.log(1000));
  return <section className="panel cabinet" aria-label={block.name}>
    {micHeader(0)}
    <div className="cab-title"><strong title={block.name}>{block.name}</strong>
      {tabs.map((label,i)=><button key={label} aria-label={label} aria-pressed={page===i} onClick={()=>setPage(i)}>{i===2?"⋯":i+1}</button>)}
      <button aria-label="캐비넷 바이패스" aria-pressed={block.bypass[scene]} disabled={busy||readOnly} onClick={bypass}>⏻</button>
    </div>
    {micHeader(8)}
    {side(0)}
    <div className="cab-center">
      {page===0 ? <div className="cab-field">
        {[0,8].map(n=>{
          const pos=at(n+5), dist=at(n+4);
          if(!pos || !dist)return null;
          const sign=n?1:-1;
          return <DragPoint key={n} label={"MIC "+(n/8+1)+" 위치와 거리"} color={colors[n/8]} disabled={busy||readOnly}
            x={.5+sign*value(pos)/2} y={value(dist)}
            onDrop={async(x,y)=>{await commit(pos,clamp(sign*(x-.5)*2));await commit(dist,y)}}/>;
        })}
      </div> : page===1 ? <>
        {high && low && <div className="cab-filter"><div className="cab-hz" aria-hidden="true">{["Hz","100","1k","10k"].map((tick,i)=><span key={tick} style={{left:[0,23,57,90][i]+"%"}}>{tick}</span>)}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={`M0 ${logX(high)>.001?93:50} L${logX(high)*100} 50 H${logX(low)*100} L100 ${logX(low)<.999?93:50}`} fill="none" stroke="white" vectorEffect="non-scaling-stroke"/></svg>
          {[high,low].map((p,i)=><DragPoint key={p.index} label={p.name} color="#eee" disabled={busy||readOnly} x={logX(p)} y={.5}
            onDrop={x=>commit(p,clamp((20*1000**x-p.min)/(p.max-p.min))**(1/(p.exponent??1)))}>{i?"L":"H"}</DragPoint>)}
        </div>}
        <div className="cab-filter-knobs">{[high,output,low].map(p=>control(p,p?.name,p===high?{offAt:0}:p===low?{offAt:1}:{}))}</div>
      </> : <div className="cab-extra">{extra.map(p=>control(p,p.name))}</div>}
    </div>
    {side(8)}
  </section>;
}
