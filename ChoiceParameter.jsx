import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function SceneMark({scene}) {
  const description="씬 할당 · "+"ABCDEFGH"[scene];
  return <span className="scene-mark" role="img" aria-label={description} title={description}>A B<br/>C D</span>;
}

export default function ChoiceParameter({p, scene, disabled, busy, readOnly, commit, assign, pressButton=false}) {
  const value = p.values[p.assigned ? scene : 0];
  const binary = (p.options.length || p.steps || 2) === 2;
  const toggle = binary && (p.type === "switch" || p.type === "toggleButton" ||
    (!p.type && p.steps === 2));
  const count = pressButton ? 2 : p.options.length || (toggle ? 2 : p.steps) || 0;
  const vertical = toggle || (p.type === "switch" && count === 3);
  const index = Math.round((value ?? 0) * (count - 1));
  const label = i => p.options[i] || (toggle ? ["Off", "On"][i] : String(i+1));
  const anchor = useRef(null), menu = useRef(null), hold = useRef(null);
  const suppressClick = useRef(false);
  const [position, setPosition] = useState(null);
  function close(restore = true) {
    setPosition(null);
    if (restore) anchor.current?.focus({preventScroll:true});
  }
  function cancelHold() {
    clearTimeout(hold.current?.timer);
    hold.current = null;
  }
  useEffect(() => cancelHold, []);
  useLayoutEffect(() => {
    if (!position) return;
    menu.current?.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
    menu.current?.querySelector(':focus')?.scrollIntoView({block:"nearest"});
    const outside = e => {
      if (!menu.current?.contains(e.target) && !anchor.current?.contains(e.target)) close(false);
    };
    const resize = () => close(false);
    document.addEventListener("pointerdown",outside,true);
    window.addEventListener("resize",resize);
    return () => {
      document.removeEventListener("pointerdown",outside,true);
      window.removeEventListener("resize",resize);
    };
  },[position]);
  function show() {
    if (position) return close();
    const rect = anchor.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width-16,140),window.innerWidth-16);
    const height = Math.min(count*36+8,300,window.innerHeight-16);
    setPosition({width, maxHeight:height,
      left:Math.max(8, Math.min(rect.left+8,window.innerWidth-width-8)),
      top:Math.max(8,Math.min(rect.bottom-height/2,window.innerHeight-height-8))});
  }
  function choose(i) {
    close();
    if (!readOnly && !disabled && !busy && i!==index) commit(i/(count-1));
  }
  return <>
    <button ref={anchor} type="button" className="param choice-param"
      role={toggle && !pressButton?"switch":undefined} aria-checked={toggle && !pressButton?index===1:undefined}
      aria-pressed={pressButton?index===1:undefined}
      aria-haspopup={vertical || pressButton?undefined:"listbox"} aria-expanded={vertical || pressButton?undefined:!!position}
      aria-label={pressButton?p.name:p.name+" "+(value==null?"—":label(index))}
      disabled={disabled || busy || value==null || count<2 || (readOnly && (pressButton || vertical))}
      onContextMenu={e=>e.preventDefault()}
      onPointerDown={e=>{
        if(!e.isPrimary || e.button!==0)return;
        cancelHold();suppressClick.current=false;
        if(!readOnly)hold.current={x:e.clientX,y:e.clientY,timer:setTimeout(()=>{
          suppressClick.current=true;assign();
        },550)};
      }}
      onPointerMove={e=>{
        const h=hold.current;
        if(h && Math.hypot(h.x-e.clientX,h.y-e.clientY)>8){cancelHold();suppressClick.current=true}
      }}
      onPointerLeave={cancelHold} onPointerCancel={cancelHold} onPointerUp={cancelHold}
      onKeyDown={e=>{
        if(e.key==="F10" && e.shiftKey && !e.repeat && !readOnly){e.preventDefault();assign()}
        if(!pressButton && ["ArrowDown","ArrowUp"].includes(e.key)){
          e.preventDefault();
          if(vertical)choose(Math.max(0,Math.min(count-1,index+(e.key==="ArrowUp"?1:-1))));
          else show();
        }
      }}
      onClick={e=>{
        if(suppressClick.current && e.detail!==0){suppressClick.current=false;return}
        if(pressButton)choose(1-index);
        else if(vertical) {
          const target=e.target.closest("[data-choice]");
          choose(target?Number(target.dataset.choice):(index+1)%count);
        } else show();
      }}>
      {!pressButton && <small>{p.name}{p.assigned && <SceneMark scene={scene}/>}</small>}
      {pressButton ? <span className="param-push">
        {p.assigned && <SceneMark scene={scene}/>}
        {index===1 && p.name==="MUTE"?"MUTED":p.name}
      </span> : vertical ? <span className="param-switch" style={{gridTemplateRows:"repeat("+count+",22px)"}}>
        <i aria-hidden="true" style={{gridRow:"span "+count,height:(count*22-1)+"px","--switch-position":(3+index*22)+"px"}}/>
        {Array.from({length:count},(_,i)=>count-1-i).map(i=><span key={i} data-choice={i} className={index===i?"current":""}>{label(i)}</span>)}
      </span> : <span className="param-select"><span>{label(index)}</span><b aria-hidden="true">⌄</b></span>}
    </button>
    {position && createPortal(<div className="param-options" style={position} ref={menu}
      role="listbox" aria-label={p.name} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))close(false)}}
      onKeyDown={e=>{
        const items=Array.from(menu.current.children), from=items.indexOf(document.activeElement);
        const next={ArrowDown:Math.min(count-1,from+1),ArrowUp:Math.max(0,from-1),Home:0,End:count-1}[e.key];
        if(next!=null){e.preventDefault();items[next].focus()}
        if(e.key==="Escape"){e.preventDefault();close()}
      }}>
      {Array.from({length:count},(_,i)=><button key={i} role="option" aria-selected={index===i}
        tabIndex={-1} onClick={()=>choose(i)}>{label(i)}</button>)}
    </div>,document.body)}
  </>;
}
