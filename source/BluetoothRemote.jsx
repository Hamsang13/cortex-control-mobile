import React, {useState} from "react";
import {connectBluetooth} from "./bleTransport";

export default function BluetoothRemote({children}) {
  const [online,setOnline]=useState(false), [busy,setBusy]=useState(false);
  const [key,setKey]=useState(""), [message,setMessage]=useState("");
  const supported=window.isSecureContext && !!navigator.bluetooth?.requestDevice && !!crypto.subtle;
  async function connect(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);setMessage("Pi를 선택하세요.");
    try {
      await connectBluetooth(key,()=>{
        setOnline(false);setMessage("연결이 끊겼습니다. Pi에 다시 연결하세요.");
      });
      setKey("");setMessage("");setOnline(true);
    } catch(error) {setMessage("연결 실패 · "+error.message);}
    finally {setBusy(false);}
  }
  if (online) return children;
  return <main className="ble-remote"><h1>Cortex Remote · Bluetooth</h1>
    {supported ? <form onSubmit={connect}><label>리모트 접속 키
      <input type="password" autoComplete="off" required disabled={busy} value={key} onChange={e=>setKey(e.target.value)}/>
    </label><button disabled={busy || !key}>Pi 연결</button></form>
    : <p>{window.isSecureContext?"iPad에서는 Bluefy로 이 주소를 여세요.":"Bluetooth 연결에는 신뢰된 HTTPS 주소가 필요합니다."}</p>}
    <p role="status">{message}</p><p>Wi-Fi로 돌아가려면 Pi 네트워크에서 기존 리모트 즐겨찾기를 여세요.</p>
  </main>;
}
