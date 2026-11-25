import React,{useEffect,useRef,useState} from "react";

const groups=[
  [["usb_port","USB","usb"]],[["exp_port.2","EXP 2","jack"],["exp_port.1","EXP 1","jack"]],
  [["midi-out","MIDI OUT","midi"]],[["midi-in","MIDI IN","midi"]],
  [["out_port.5","OUT 2/R","xlr"]],[["out_port.4","OUT 1/L","xlr"]],
  [["hp_port","🎧","jack"],["capture","CAPTURE OUT","jack"]],
  [["out_port.7","OUT 4/R","jack"],["out_port.6","OUT 3/L","jack"]],
  [["in_port.5","RET 2","jack"],["in_port.4","RET 1","jack"]],
  [["out_port.9","SEND 2","jack"],["out_port.8","SEND 1","jack"]],
  [["in_port.2","INPUT 2","combo"]],[["in_port.1","INPUT 1","combo"]]
];

function Socket({type}){
  return <svg viewBox="0 0 48 48" aria-hidden="true">
    {type==="usb"?<path d="M10 10h28v22l-6 6H16l-6-6z M16 16v13l3 3h10l3-3V16z" fillRule="evenodd"/>:
    type==="jack"?<><path d="m24 5 16 9v20l-16 9-16-9V14z"/><circle cx="24" cy="24" r="12" fill="#111"/><circle cx="24" cy="24" r="9"/></>:
    type==="midi"?<><circle cx="24" cy="24" r="17"/>{[[14,24],[17,18],[24,15],[31,18],[34,24]].map(([x,y])=><circle key={x} cx={x} cy={y} r="2" fill="#111"/>)}</>:
    <><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="24" cy="24" r="16"/>
      {type==="combo"?<path d="M24 13q4 0 4 4l5 4q5 3 0 7l-4 2q-5 7-10 0l-4-3q-4-3 0-6l5-4q0-4 4-4" fill="#111"/>:
      [[17,24],[24,17],[31,24]].map(([x,y])=><circle key={x} cx={x} cy={y} r="2.5" fill="#111"/>)}</>}
  </svg>;
}

const clamp=n=>Math.max(0,Math.min(1,n));
function Dial({label,value,format,steps,disabled,write}){
  const [draft,setDraft]=useState(null),g=useRef(null);
  const v=draft??value, text=v==null?"—":format(v);
  const snap=n=>steps?Math.round(clamp(n)*(steps-1))/(steps-1):clamp(n);
  return <button className="io-cell io-dial" role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={v==null?undefined:Math.round(v*100)} aria-valuetext={text} disabled={disabled || value==null}
    style={{"--turn":((v||0)*270-135)+"deg","--fill":((v||0)*270)+"deg"}}
    onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);g.current={y:e.clientY,v:value,next:value}}}
    onPointerMove={e=>{if(!g.current)return;g.current.next=snap(g.current.v+(g.current.y-e.clientY)/150);setDraft(g.current.next)}}
    onPointerUp={()=>{const d=g.current;g.current=null;setDraft(null);if(d && d.next!==value)write(d.next)}}
    onLostPointerCapture={()=>{g.current=null;setDraft(null)}}
    onKeyDown={e=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();write(snap(value+((e.key==="ArrowUp"||e.key==="ArrowRight")?1:-1)/(steps?steps-1:100)))}}}>
    <span>{label}</span><output>{text}</output><i/></button>;
}
function Toggle({label,on,yes="On",no="Off",disabled,write}){
  return <button className="io-cell io-toggle" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
    onClick={()=>write(!on)}><span>{label}</span><div><i data-on={!!on}/><b className={on?"lit":""}>{yes}</b><b className={!on?"lit":""}>{no}</b></div></button>;
}

function meterCell(label,keys,meter){
  const levels=keys.map(k=>meter[k]).filter(Number.isFinite);
  const value=levels.length?Math.max(...levels):null;
  return <div className="io-cell io-meter" key={label+"meter"}><span>{label}</span><output>{value==null?"—":((clamp(value)-1)*40).toFixed(2)+" dB"}</output>
    <div>{keys.map(k=><i key={k} style={{width:(clamp(meter[k]||0)*100)+"%"}}/>)}</div></div>;
}
const db=(min,max)=>v=>(min+(max-min)*v).toFixed(2)+" dB";
const types=["Peak","Hi pass","Lo pass","Hi shelf","Lo shelf"];
const hz=v=>20+19980*v**(1/.3);
const eqX=v=>Math.log(hz(v)/20)/Math.log(1000);

function EqCurve({values,point,bypassed}){
  const context=useRef(null);
  const points=React.useMemo(()=>{
    if(bypassed)return "0,50 100,50";
    const audio=context.current??=new OfflineAudioContext(1,16,48000);
    const frequencies=Float32Array.from({length:161},(_,i)=>20*1000**(i/160));
    const magnitude=new Float32Array(161),phase=new Float32Array(161);
    const gain=new Float32Array(161).fill(((values["eq.25"]??.5)-.5)*24);
    for(let i=0;i<5;i++){
      const key=n=>values["eq."+(5*i+n)];
      if(!key(4))continue;
      const filter=audio.createBiquadFilter(),draft=point?.i===i;
      filter.type=["peaking","highpass","lowpass","highshelf","lowshelf"][Math.round((key(3)||0)*4)];
      filter.frequency.value=draft?20*1000**point.x:hz(key(1)??0);
      filter.gain.value=24*((draft?1-point.y:key(0)??.5)-.5);
      const q=.1+9.9*(key(2)??0);
      filter.Q.value=["lowpass","highpass"].includes(filter.type)?20*Math.log10(q):q;
      filter.getFrequencyResponse(frequencies,magnitude,phase);
      magnitude.forEach((m,j)=>gain[j]+=20*Math.log10(Math.max(m,1e-8)));
    }
    return Array.from(gain,(db,i)=>i*100/160+","+(50-db*100/24)).join(" ");
  },[values,point,bypassed]);
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="white" vectorEffect="non-scaling-stroke"/></svg>;
}

let lastPort="in_port.1";

export default function IOSettings({api,readOnly,close}){
  const [v,set]=useState({}),[meter,setMeter]=useState({}),[port,pick]=useState(lastPort);
  const [usbPage,setUsbPage]=useState(1);
  const [eq,showEQ]=useState(false),[band,selectBand]=useState(0),[busy,wait]=useState(false),[error,report]=useState("");
  const [point,previewPoint]=useState(null),pending=useRef(false),dialog=useRef(null);
  useEffect(()=>{
    let live=true;
    const initial=document.activeElement;
    dialog.current.focus();
    function key(e){
      if(e.key==="Escape"){e.preventDefault();close()}
      if(e.key==="Tab"){
        const buttons=Array.from(dialog.current.querySelectorAll("button:not(:disabled),select:not(:disabled)"));
        if(e.shiftKey && (document.activeElement===buttons[0]||document.activeElement===dialog.current)){e.preventDefault();buttons.at(-1)?.focus()}
        else if(!e.shiftKey && document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus()}
      }
    }
    document.addEventListener("keydown",key);
    api("io-settings").then(data=>{if(live)set(data)}).catch(e=>{if(live)report(e.message)});
    let timer;
    async function poll(){try{const data=await api("io-meter");if(live)setMeter(data)}catch{}finally{if(live)timer=setTimeout(poll,140)}}
    if(!readOnly)poll();
    return ()=>{live=false;clearTimeout(timer);document.removeEventListener("keydown",key);initial?.focus()};
  },[api,readOnly]);
  async function change(entries){
    if(readOnly||pending.current)return;
    pending.current=true;wait(true);report("");
    try{
      let state=v;
      for(const [key,value] of entries){
        if(value===state[key])continue;
        state=await api("io-set",{key,value,previous:state[key]});set(state);
      }
    }catch(e){report(e.message);try{set(await api("io-settings"))}catch{}}
    finally{pending.current=false;wait(false)}
  }
  const locked=readOnly||busy;
  const write=(key,n)=>change([[key,n]]);
  const dial=(key,label,fmt,steps,off=false)=><Dial key={key} label={label} value={v[key]} format={fmt} steps={steps}
    disabled={locked||off} write={n=>write(key,n)}/>;
  const toggle=(key,label,over={})=><Toggle key={label} label={label} on={!!v[key]} disabled={locked||v[key]==null}
    write={n=>write(key,+n)} {...over}/>;
  const linked12=v.xlr1_2_linked,linked34=v.out3_4_linked;
  const selected=groups.flat().find(p=>p[0]===port);
  const num=Number(port.split(".")[1]);
  const out=port.startsWith("out_port");
  const input=port.startsWith("in_port");
  const linked=out && (num<=5?linked12:num<=7?linked34:false);
  const prefix=linked?"out_port."+(num<=5?1:2):port;
  const label=linked?(num<=5?"OUT 1/2":"OUT 3/4"):port==="hp_port"?"Headphones":selected[1];
  const key=name=>prefix+"."+name;
  const ktype=key("input_type"),typ=v[ktype];
  const inKeys={1:"input_1",2:"input_2",4:"return_1",5:"return_2"};
  const outKeys={4:"xlr_1",5:"xlr_2",6:"out_3",7:"out_4",8:"send_1",9:"send_2"};
  const outputMeters=linked?(num<=5?["xlr_1","xlr_2"]:["out_3","out_4"]):[outKeys[num]];
  const base=band*5, ek=i=>"eq."+(base+i), eqOff=v["eq.bypassed"]!==false, shape=Math.round((v[ek(3)]||0)*4);
  const eqSwitch=<button className="io-eq-switch" role="switch" aria-label="Global EQ" aria-checked={!eqOff}
    disabled={locked||v["eq.bypassed"]==null} onClick={()=>write("eq.bypassed",!eqOff)}>{eqOff?"OFF":"ON"}</button>;
  function bandPos(i){return point?.i===i?point:{x:eqX(v["eq."+(i*5+1)]??0),y:1-(v["eq."+(i*5)]??.5)}}
  return <div className="io-shade" onClick={close}><section className="io-dialog" role="dialog" aria-modal="true" aria-label={eq?"Global EQ":"I/O Settings"}
    tabIndex={-1} ref={dialog} onClick={e=>e.stopPropagation()}>
    <div className="io-heading">{!eq && <svg className="io-layers" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m2 8 10-5 10 5-10 5z M2 12l2-1 8 4 8-4 2 1-10 5z M2 16l2-1 8 4 8-4 2 1-10 5z"/></svg>}<span>{eq?"Global EQ":"I/O Settings"}</span><strong>{eq?"Parametric-5":label}</strong>
      {!eq && <span className="io-eq-label">Global EQ</span>}{eqSwitch}
      {eq?<button className="io-done" onClick={()=>showEQ(false)}>DONE</button>:<><button aria-label="Global EQ 설정" onClick={()=>showEQ(true)}><svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 2v16M10 2v16M16 2v16M2 7h4m2 5h4m2-6h4" /></svg></button><button aria-label="닫기" onClick={close}>×</button></>}</div>
    {!eq?<><div className="io-ports">{groups.map((group,i)=><div key={i} className={"io-group "+(group.length===2?"double":"single")}>
      {group.map(([id,name,type],j)=><button key={id} aria-label={id==="hp_port"?"Headphones":name}
        className={"io-port "+type} data-plugged={!!v[id+".plugged"]} aria-pressed={port===id||(linked && id===("out_port."+(num%2===0?num+1:num-1)))}
        onClick={()=>{lastPort=id;pick(id);setUsbPage(1)}}><Socket type={type}/><small>{id==="hp_port"?"🎧":name}</small></button>)}
      {(i===4||i===7) && <button className={"io-link link"+i} disabled={locked||v[i===4?"xlr1_2_linked":"out3_4_linked"]==null} aria-label={i===4?"Link OUT 1/2":"Link OUT 3/4"}
        aria-pressed={!!(i===4?linked12:linked34)} onClick={()=>{const k=i===4?"xlr1_2_linked":"out3_4_linked";write(k,!v[k])}}>∞</button>}
    </div>)}</div>
    {port==="usb_port" && <div className="io-tabs">{[1,2].map(n=><button key={n} aria-label={"USB page "+n} aria-pressed={usbPage===n} onClick={()=>setUsbPage(n)}>{n}</button>)}</div>}
    <div className="io-controls">
      {input && <>{dial(key("level"),label+" LEVEL",db(-12,60))}
        {num<=2 && <>{dial(key("input_zmode"),"IMPEDANCE",n=>["10k","33k","68k","91k","130k","232k","470k","1M","10M"][Math.round(n*8)]+" Ω",9)}
          {toggle(ktype,"TYPE",{on:typ>0,yes:"Mic",no:"Instrument",write:on=>write(ktype,on ? .5 : 0)})}
          {toggle(ktype,"PHANTOM 48V",{on:typ===1,disabled:locked||!typ,write:on=>write(ktype,on?1:.5)})}</>}
        {toggle(key("ground_lift"),"GROUND LIFT")}{meterCell(label+" LEVEL",[inKeys[num]],meter)}</>}
      {out && <>{dial(key("level"),label+" LEVEL",db(-40,12))}
        {num<=5 && toggle(key("ground_lift"),"GROUND LIFT")}
        {meterCell(label+" LEVEL",outputMeters,meter)}{meterCell("LIMITER",outputMeters.map(k=>k+"_limiter"),meter)}
        {num<8 && toggle(key("mute"),"MUTE")}</>}
      {port==="usb_port" && usbPage===2 && toggle("usb_port.dry_wet","DRY - WET",{yes:"3/4 D - 1/2 W",no:"1/2 D - 3/4 W"})}
      {port==="usb_port" && usbPage===1 && <>{dial(key("level"),"USB LEVEL",db(-40,0))}
        {[1,2,3,4].map(i=>meterCell("IN "+(i*2-1)+"/"+i*2,["usb_input_"+i+"l","usb_input_"+i+"r"],meter))}
        {dial(key("hp_select"),"HP SOURCE",n=>["NONE","USB 1/2","USB 3/4","BOTH"][Math.round(n*3)],4)}
        {[1,2,3,4].map(i=>meterCell("OUT "+(i*2-1)+"/"+i*2,["usb_output_"+i+"l","usb_output_"+i+"r"],meter))}</>}
      {port==="hp_port" && <>{dial(key("level"),"HP LEVEL",db(-40,12))}{Object.keys(v).filter(k=>k.startsWith("hp_feed.")).map(k=>dial(k,k==="hp_feed.19.level"?"MULTI OUT":"OUT "+k.split(".")[1],db(-40,12)))}
        <div className="io-break"/>{meterCell("LEVEL",["hp_l","hp_r"],meter)}{meterCell("Multi Out",["grid_xlr_1","grid_xlr_2"],meter)}</>}
      {port==="midi-out" && toggle("midi_port.midi_thru","MIDI Thru")}
      {port.startsWith("exp_port") && <><div className="io-cell io-instruction">Please press the expression pedal up and down to the maximum position then press Save</div>
        {dial(key("level"),"POSITION",n=>n.toFixed(2),0,true)}
        {[["SAVE",false],["RECALIBRATE",true]].map(([text,on])=><button key={text} disabled={locked||!v[key("plugged")]||v[key("calibrating")]==null||!!v[key("calibrating")]===on}
          onClick={()=>write(key("calibrating"),on)}>{text}</button>)}</>}
    </div></>:<>
      <div className="io-eq-graph">
        {[100,1000,10000].map(h=><small key={h} style={{left:100*Math.log(h/20)/Math.log(1000)+"%"}}>{h>=1000?h/1000+"k":h}</small>)}
        <EqCurve values={v} point={point} bypassed={eqOff}/>
        {Array.from({length:5},(_,i)=>{const p=bandPos(i);
          return <button key={i} aria-label={"EQ band "+(i+1)} aria-pressed={band===i} style={{left:p.x*100+"%",top:p.y*100+"%"}}
            onClick={()=>selectBand(i)} onPointerDown={e=>{selectBand(i);if(locked||eqOff)return;e.currentTarget.setPointerCapture(e.pointerId)}}
            onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.parentElement.getBoundingClientRect();previewPoint({i,x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)})}}
            onPointerUp={()=>{if(point?.i===i)change([["eq."+(5*i+1),clamp((20*1000**point.x-20)/19980)**.3],["eq."+(5*i),1-point.y]]);previewPoint(null)}}
            onPointerCancel={()=>previewPoint(null)}>{i+1}</button>})}
      </div><div className="io-controls io-eq-controls">
        <label className="io-cell">{band+1}: TYPE <button aria-label="Band bypass" aria-pressed={!!v[ek(4)]} disabled={locked||eqOff} onClick={()=>write(ek(4),v[ek(4)]?0:1)}>×</button>
          <select aria-label="Filter type" value={shape} disabled={locked||eqOff} onChange={e=>write(ek(3),Number(e.target.value)/4)}>{types.map((t,i)=><option key={t} value={i}>{t}</option>)}</select></label>
        {dial(ek(0),(band+1)+": GAIN",db(-12,12),0,eqOff)}{dial(ek(1),(band+1)+": FREQUENCY",n=>Math.round(hz(n))+" Hz",0,eqOff)}
        {dial(ek(2),(band+1)+": Q",n=>(.1+9.9*n).toFixed(2),0,eqOff)}{dial("eq.25","OUTPUT",db(-12,12),0,eqOff)}
        {[26,27].map((n,i)=><button key={n} className="io-cell" disabled={locked||eqOff} aria-pressed={!!v["eq."+n]} onClick={()=>write("eq."+n,v["eq."+n]?0:1)}>OUT {i?"3/4":"1/2"}<output>ASSIGN</output></button>)}
      </div></>}
      {error && <p role="status">{error}</p>}
      {!eq && <div className="io-actions"><button className="io-done" onClick={close}>DONE</button></div>}
  </section></div>;
}
