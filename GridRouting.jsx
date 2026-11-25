import React, {useEffect, useRef, useState} from "react";

import {meterReading, MeterTrack} from "./SignalTrack";

const gapX = gap => 70 + gap * 107.5;

function branch(x, edge, y) {
  if (x === edge) return `M${x} ${y}v100`;
  const dir = Math.sign(edge - x);
  return `M${x} ${y}v40q0 10 ${10*dir} 10H${edge-10*dir}q${10*dir} 0 ${10*dir} 10v40`;
}

export function portLabel(name) {
  if (!name || name === "EMPTY") return "+";
  const names = {MULTIPLE:"Multi Out", PREV_ROW:"Prev. row", NEXT_ROW_3_4:"Row 3/4",
    NEXT_ROW_3:"Row 3", NEXT_ROW_4:"Row 4"};
  if (names[name]) return names[name];
  const [type,...numbers] = String(name).split("_");
  return [({INPUT:"In",OUTPUT:"Out",OUT:"Out",RETURN:"Return",SEND:"Send"})[type] || type,
    numbers.join("/")].filter(Boolean).join(" ");
}

export function Port({side, row, value, name, branched, indicator, open, signalChannels, selected}) {
  const label = portLabel(name ?? (value || "EMPTY"));
  const usbChannel = side==="input" ? {INPUT_1:0, INPUT_2:1}[name] : undefined;
  const wet = side==="output" && name==="MULTIPLE";
  return <button className={"port port-"+side} aria-label={`${row+1}행 ${side==="input"?"입력":"출력"} · ${label}`}
    aria-pressed={selected} disabled={branched} onClick={open}>
    {indicator && side==="input" && <i className="port-status" aria-label={side==="input"?"Noise gate On":"Mute On"}/>}
    {label.split(" ").map((part,i)=><span key={i}>{part}</span>)}
    {side==="output" && indicator ? <span className="port-signal port-signal-muted" role="img" aria-label="Mute On" title="MUTE"/> :
      (usbChannel!=null || wet) && <span className="port-signal" title={wet?"USB 3/4 Wet":"USB "+(usbChannel+1)+" DI"}>
        <MeterTrack reading={wet?meterReading(signalChannels[2],signalChannels[3]):signalChannels[usbChannel]}/>
      </span>}
  </button>;
}

export function GridRouting({state,disabled,commit,open,selection}) {
  const [drag,setDrag] = useState(null);
  const pointer = useRef(null);
  const wire = useRef(null);
  useEffect(()=>{
    const board=wire.current.closest(".board");
    let hold=null, suppress=false;
    function cancel(){clearTimeout(hold?.timer);hold=null}
    function start(e){
      cancel();suppress=false;
      if(!e.isPrimary || e.button!==0 || e.target.closest(".port,.tile,.del,.route-node"))return;
      const path=e.target.closest("[data-wire-row]");
      const box=board.getBoundingClientRect();
      const t=(e.clientY-box.top)/box.height*4;
      if(!path && Math.abs(t-Math.floor(t)-.5)*box.height/4>12)return;
      const lane=Number(path?.dataset.wireRow ?? Math.floor(t));
      if(!path && !wire.current.querySelector('[data-wire-row="'+lane+'"]'))return;
      const row=lane & ~1, part=path?.dataset.part || "start";
      hold={x:e.clientX,y:e.clientY,timer:setTimeout(()=>{
        suppress=true;open(row,part);
      },550)};
    }
    function move(e){if(hold && Math.hypot(hold.x-e.clientX,hold.y-e.clientY)>7)cancel()}
    function click(e){if(suppress){suppress=false;e.preventDefault();e.stopPropagation()}}
    function context(e){if(hold || suppress)e.preventDefault()}
    board.addEventListener("pointerdown",start,true);
    board.addEventListener("pointermove",move,true);
    board.addEventListener("pointerleave",cancel);
    window.addEventListener("pointerup",cancel,true);
    window.addEventListener("pointercancel",cancel,true);
    board.addEventListener("click",click,true);
    board.addEventListener("contextmenu",context);
    return ()=>{cancel();board.removeEventListener("pointerdown",start,true);
      board.removeEventListener("pointermove",move,true);board.removeEventListener("pointerleave",cancel);
      window.removeEventListener("pointerup",cancel,true);window.removeEventListener("pointercancel",cancel,true);
      board.removeEventListener("click",click,true);board.removeEventListener("contextmenu",context)};
  },[open]);
  function points(row) {
    return (drag?.row===row ? drag : state.splits.find(s=>s.row===row)) ||
      {row,start:-1,end:-1};
  }
  function move(e) {
    const g = pointer.current;
    if (!g || g.id!==e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX-g.x,e.clientY-g.y)<5) return;
    g.moved=true;
    const bounds=e.currentTarget.closest(".board").getBoundingClientRect();
    const y=(e.clientY-bounds.top)/bounds.height*4;
    const x=(e.clientX-bounds.left)/bounds.width*1000;
    const gap=Math.round((x-70)/107.5);
    const split=g.part==="start";
    const parked=y>=g.row+1 && (split ? x<145 : x>855);
    const valid=y>=g.row && y<=g.row+1 && x>=25 && x<=975;
    const v=parked ? -1 : split ? gap : gap-1;
    g.candidate=null;
    if ((parked || valid) && (parked || (v>=0 && v<=7))) {
      const candidate={...g.original,[g.part]:v};
      if(candidate.start<0 || candidate.end<0 || candidate.start<=candidate.end)
        g.candidate=candidate;
    }
    setDrag(g.candidate || {...g.original});
  }
  function finish(e,cancel=false) {
    const g=pointer.current;
    if(!g || g.id!==e.pointerId)return;
    pointer.current=null;setDrag(null);
    if(cancel)return;
    if(!g.moved)open(g.row,g.part);
    else if(g.candidate && g.candidate[g.part]!==g.original[g.part]){open(g.row,g.part);commit(g.candidate);}
  }
  return <>
    <svg ref={wire} className="wires" viewBox="0 0 1000 400" preserveAspectRatio="none" >
      {state.lanes.map((lane,row)=>{
        const y=row*100+50, lower=row%2===1;
        const p=points(lower?row-1:row);
        const left=lower && p.start>=0 ? gapX(0) : 35;
        const right=lower && p.end>=0 ? gapX(8) : 965;
        return <g key={row} fill="none" stroke="#bdbdbd" strokeWidth="1.35">
          {(lane.input || lane.output || p.start>=0 || p.end>=0 || state.blocks.some(b=>b.row===row)) ?
            <><path d={`M${left} ${y}H${right}`} vectorEffect="non-scaling-stroke"/>
              <path data-wire-row={row} className="wire-hit" stroke="transparent" strokeWidth="18"
                tabIndex={0} role="button" aria-label={`${row+1}행 배선 편집`}
                onKeyDown={e=>{if(["Enter"," "].includes(e.key)){e.preventDefault();open(row & ~1,"start")}}}
                d={`M${left} ${y}H${right}`}/></>:null}
          {drag?.row===row && Array.from({length:9},(_,gap)=><circle key={gap} cx={gapX(gap)} cy={y} r="3.8" fill="#151515" stroke="white"/>)}
          {!lower && ["start","end"].map((part,i)=>p[part]>=0 &&
            <path data-wire-row={row} className="wire-branch" data-part={part} key={part} d={branch(gapX(p[part]+i),gapX(i*8),y)} vectorEffect="non-scaling-stroke"/>)}
        </g>;
      })}
    </svg>
    {[0,2].filter(row=>selection?.row===row && ["start","end"].includes(selection.part)).map(row=>{
      const p=points(row);
      return ["start","end"].map((part,i)=>{
        const parked=p[part]<0, x=parked?(i?944:56):gapX(p[part]+i);
        const y=(row+(parked?1:0)+.5)*25;
        return <button key={row+part} className={"route-node "+part+(parked?" parked":"")}
          style={{left:x/10+"%",top:y+"%"}} aria-label={`${i?"Mixer":"Splitter"} ${row+1}/${row+2}`}
          onKeyDown={e=>{if(e.key==="Escape"){pointer.current=null;setDrag(null)}}}
          onClick={e=>{if(e.detail===0)open(row,part)}}
          onPointerDown={e=>{
            if(!e.isPrimary || e.button!==0)return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointer.current={id:e.pointerId,x:e.clientX,y:e.clientY,part,row,original:{...p}};
          }}
          onPointerMove={disabled?undefined:move} onPointerUp={finish}
          onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)}>
          {i?"M":"S"}
        </button>;
      });
    })}
  </>;
}
