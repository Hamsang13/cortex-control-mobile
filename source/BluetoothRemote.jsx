import React, {useState, useRef, useEffect} from "react";

const serviceId = "c0de0001-9b67-47bf-8924-21400b9b8a72";
const controlId = "c0de0002-9b67-47bf-8924-21400b9b8a72";

async function bytes(characteristic) {
  const view = await characteristic.readValue();
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

export async function command(control, secret, op) {
  const sign = async data => new Uint8Array(await crypto.subtle.sign("HMAC", secret, new Uint8Array(data))).slice(0,16);
  const challenge = await bytes(control);
  if (challenge.length !== 17 || challenge[0] !== 67) throw Error("Pi 인증 요청을 확인할 수 없습니다.");
  const message = [...challenge, op];
  const request = new Uint8Array([op, ...await sign(message)]);
  if (control.writeValueWithResponse) await control.writeValueWithResponse(request);
  else await control.writeValue(request);
  const reply = await bytes(control);
  const expected = await sign([...message, ...reply.slice(0,3)]);
  if (reply.length !== 19 || reply[0] !== 82 || reply[1] !== op || !expected.every((v,i)=>v === reply[i+3]))
    throw Error("Pi 응답 인증에 실패했습니다.");
  if (reply[2]) throw Error(op ? "씬 전환을 확인할 수 없습니다. 본체 USB 연결을 확인하세요." : "Pi의 리모트 서비스 응답을 확인하세요.");
}

export default function BluetoothRemote({Scenes}) {
  const [key,setKey] = useState(""), [online,setOnline] = useState(false);
  const [busy,setBusy] = useState(false), [status,setStatus] = useState(""), [scene,setScene] = useState(null);
  const link = useRef(null), pending = useRef(false);
  const supported = window.isSecureContext && !!navigator.bluetooth?.requestDevice && !!crypto.subtle;
  useEffect(()=>()=>link.current?.device.gatt.disconnect(),[]);
  async function connect() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setStatus("Pi를 선택하세요.");
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({filters:[{services:[serviceId]}]});
      device.addEventListener("gattserverdisconnected",()=>{
        if (link.current?.device !== device) return;
        link.current = null; setOnline(false); setScene(null); setStatus("블루투스 연결이 끊겼습니다.");
      },{once:true});
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(serviceId);
      const control = await service.getCharacteristic(controlId);
      const secret = await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      await command(control,secret,0);
      if (!device.gatt.connected) throw Error("연결이 끊겼습니다.");
      link.current = {device,control,secret};
      setKey(""); setOnline(true); setStatus("Pi 연결 및 접속 키 인증 완료");
    } catch (e) {
      device?.gatt?.disconnect(); setStatus("연결 실패 · "+e.message);
    } finally { pending.current = false; setBusy(false); }
  }
  async function select(i) {
    const session = link.current;
    if (pending.current || !session) return;
    pending.current = true; setBusy(true);
    try {
      await command(session.control,session.secret,i+1);
      if (link.current === session) {setScene(i); setStatus("Scene "+String.fromCharCode(65+i)+" 전환 확인");}
    } catch (e) {
      if (link.current === session) {setScene(null); setStatus(e.message);}
    } finally { pending.current = false; setBusy(false); }
  }
  return <main className="ble-remote">
    <h1>Cortex Remote · Bluetooth</h1>
    {!supported ? <p>{window.isSecureContext ? "iPad에서는 Bluefy에서 이 주소를 여세요." : "신뢰된 HTTPS 주소에서 열어 주세요."}</p> :
      online ? <button disabled={busy} onClick={()=>link.current?.device.gatt.disconnect()}>Pi 연결 해제</button> :
      <form onSubmit={e=>{e.preventDefault();connect()}}>
        <label>리모트 접속 키 <input type="password" required autoComplete="off" value={key} disabled={busy} onChange={e=>setKey(e.target.value)}/></label>
        <button disabled={busy || !key}>Pi 연결</button>
      </form>}
    <p role="status">{status}</p>
    <Scenes state={null} current={scene} enabled={online && !busy} select={select}/>
  </main>;
}
