import React, {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

const items = ["Virtual Device Presets", "Save Current Parameters as…", "Reset to Defaults",
  "Assign Expression Pedal", "Assign footswitch", "Change bypass to mute", "Copy Virtual Device"];

export default function BlockMenu({block, blocks, disabled, action}) {
  const [view, setView] = useState(null);
  const [pedal, setPedal] = useState(1);
  const [position, setPosition] = useState({});
  const trigger = useRef(null), popup = useRef(null);
  const bypass = block.expressionBypass ?? {pedal:0,mode:0,delay:0,invert:false,latch:false};
  const setBypass = changes => action("expression-bypass",changes);
  function close() { setView(null); trigger.current?.focus(); }
  useEffect(() => {
    if (!view) return;
    const outside = e => {
      if (!popup.current?.contains(e.target) && !trigger.current?.contains(e.target)) setView(null);
    };
    const escape = e => { if (e.key === "Escape") close(); };
    const resized = () => setView(null);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resized);
    };
  }, [view]);
  function open() {
    if (view) return close();
    const box = trigger.current.getBoundingClientRect();
    setPosition({left: Math.max(4, Math.min(box.left, innerWidth - 264)),
      ...(innerHeight-box.bottom > 275 ? {top:box.bottom} : {bottom:innerHeight-box.top})});
    setView("menu");
  }
  return <><button ref={trigger} aria-label="Virtual device menu" aria-expanded={!!view} onClick={open}>⋮</button>
    {view && createPortal(<div ref={popup} className={"device-menu "+(view==="expression"?"expression-pane":"")} style={view==="expression"?{}:position}>
      {view==="menu" && items.map((name,i)=><button key={name} disabled={i!==3 && i!==4}
        onClick={()=>setView(i===3?"expression":"stomp")}>{name}{i===4?"　›":""}</button>)}
      {view==="stomp" && <><div className="switch-bank">{Array.from("ABCDEFGH",(s,i)=>
        <button key={s} disabled={disabled} aria-pressed={block.stomp===i}
          onClick={()=>action("stomp",{switch:block.stomp===i?-1:i})}>{s}</button>)}</div>
        {["Latching","Momentary"].map((name,i)=><button key={name}
          disabled={disabled || block.stomp==null || blocks.filter(b=>b.stomp===block.stomp).length!==1}
          aria-pressed={block.stomp!=null && !!block.momentary===!!i} onClick={()=>action("momentary",{value:!!i})}>{name}</button>)}</>}
      {view==="expression" && <><strong>ASSIGN EXPRESSION PEDAL</strong>
        {[1,2].map(n=><React.Fragment key={n}><button aria-expanded={pedal===n} onClick={()=>setPedal(n)}>Expression Pedal {n} (X{n})</button>
          {pedal===n && <><b>{block.name}</b><label><input type="checkbox" checked={bypass.pedal===n} disabled={disabled}
            onChange={()=>setBypass({pedal:bypass.pedal===n?0:n})}/>BYPASS</label>
            {bypass.pedal===n && <div><label>Switch on…<select value={bypass.mode} disabled={disabled}
              onChange={e=>setBypass({mode:Number(e.target.value)})}>{["Stop","Switch","Heel-Toe"].map((name,i)=>
                <option key={name} value={i}>{name}</option>)}</select></label>
              <label><input type="checkbox" checked={bypass.invert} disabled={disabled} onChange={e=>setBypass({invert:e.target.checked})}/>Invert</label>
              <label>Switch delay<input type="number" key={bypass.delay} defaultValue={bypass.delay} min="0" max="5000" disabled={disabled}
                onBlur={e=>{if(e.target.value!=="" && e.target.validity.valid && e.target.valueAsNumber!==bypass.delay)setBypass({delay:e.target.valueAsNumber})}}/>ms</label>
              <label><input type="checkbox" checked={bypass.latch} disabled={disabled || bypass.mode!==1}
                onChange={e=>setBypass({latch:e.target.checked})}/>Latch Emulation</label></div>}
            {block.params.filter(p=>!p.textOptions).map(p=>{
            const selected=p.expression===n;
            return <div key={p.index}><label><input type="checkbox" checked={selected} disabled={disabled}
              onChange={()=>action("expression",{index:p.index,pedal:selected?0:n})}/>{p.name}</label>
              {selected && ["expressionMin","expressionMax"].map((k,i)=><label key={k+(p[k]??i)}>{i?"Max":"Min"}
                <input type="range" min="0" max="100" defaultValue={Math.round((p[k]??i)*100)} disabled={disabled}
                onPointerUp={e=>action("expression",{index:p.index,pedal:n,[k]:Number(e.target.value)/100})}
                onKeyUp={e=>{if(e.key.startsWith("Arrow")||["Home","End"].includes(e.key))action("expression",{index:p.index,pedal:n,[k]:Number(e.target.value)/100})}}/></label>)}</div>;
          })}</>}</React.Fragment>)}
        <button onClick={close}>Done</button></>}
    </div>,document.body)}</>;
}
