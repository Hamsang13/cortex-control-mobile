import React,{useState} from "react";
import {bluetoothMode} from "./bleTransport";

export default function ConnectionChoice({piUrl}) {
  const [target,setTarget]=useState(null), [address,setAddress]=useState(""), [error,setError]=useState("");
  const mode=bluetoothMode?"ble":"wifi";
  function choose(next) {
    setError("");setTarget(null);
    if (next===mode) return;
    if (next==="ble" && window.isSecureContext) {
      const url=new URL(location.href);
      url.searchParams.set("transport","ble");location.assign(url);return;
    }
    setTarget(next);
    setAddress(next==="wifi" ? (piUrl || "http://10.42.0.1:8765/") : "");
  }
  function open(e) {
    e.preventDefault();
    try {
      const url=new URL(address);
      if (target==="ble") {
        if (url.protocol!=="https:") throw Error("HTTPS 주소를 입력하세요.");
        url.hash="";url.searchParams.set("transport","ble");
      } else if (!["http:","https:"].includes(url.protocol) || !url.hash.slice(1)) {
        throw Error("웹 접속 키가 포함된 Pi 주소를 입력하세요.");
      }
      location.assign(url);
    } catch(e) {setError(e.message);}
  }
  return <div><label>리모트 연결 <select value={target||mode} onChange={e=>choose(e.target.value)}>
    <option value="wifi">Wi-Fi</option><option value="ble">Bluetooth</option>
  </select></label>{target && <form onSubmit={open}><label>
    {target==="ble"?"Bluefy에서 열 신뢰된 HTTPS 리모트 주소":"키가 포함된 Pi Wi-Fi 접속 주소"}
    <input type={target==="ble"?"url":"password"} required autoComplete="off" value={address} onChange={e=>setAddress(e.target.value)}/>
  </label><button>열기</button></form>}{error && <p role="alert">{error}</p>}</div>;
}
