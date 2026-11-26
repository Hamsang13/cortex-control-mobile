const serviceId = "c0de0001-9b67-47bf-8924-21400b9b8a72";
const remoteId = serviceId.replace("0001-", "0003-");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const bluetoothMode = new URLSearchParams(location.search).get("transport") === "ble";
let session;

async function transfer({control, key}, action, body, onProgress) {
  async function write(bytes) {
    if (control.writeValueWithResponse) await control.writeValueWithResponse(bytes);
    else await control.writeValue(bytes);
  }
  async function read() {
    const view = await control.readValue();
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  }
  await write(Uint8Array.of(78));
  const challenge = await read();
  if (challenge.length !== 13 || challenge[0] !== 67) throw Error("Pi 인증 요청이 올바르지 않습니다.");
  const iv = challenge.slice(1);
  const request = encoder.encode(JSON.stringify({action, body, gzip:typeof DecompressionStream === "function"}));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode("remote-request")},key,request));
  for (let i=0;i<sealed.length;i+=19) await write(Uint8Array.of(68,...sealed.subarray(i,i+19)));
  await write(Uint8Array.of(88));
  const deadline = Date.now()+130000;
  let frame = await read();
  while (frame[0] === 87 && Date.now()<deadline) {
    await pause(80);
    frame = await read();
  }
  let result, offset=0;
  do {
    if (frame[0]!==82 || frame.length<=5) throw Error("Pi 응답을 끝까지 읽지 못했습니다.");
    const size=new DataView(frame.buffer).getUint32(1);
    if (!result && size>0 && size<=32*1024*1024) result=new Uint8Array(size);
    if (result?.length!==size || offset+frame.length-5>size) throw Error("Pi 응답 길이가 올바르지 않습니다.");
    result.set(frame.subarray(5), offset);
    offset+=frame.length-5;
    onProgress?.(offset/size);
    if (offset<size) {
      const cursor=Uint8Array.of(80,0,0,0,0);
      new DataView(cursor.buffer).setUint32(1,offset);
      await write(cursor);
      frame=await read();
    }
  } while (offset<result.length);
  iv[0]|=128;
  let plain=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:encoder.encode("remote-reply")},key,result));
  if (plain[0]===90) {
    const stream=new Blob([plain.subarray(1)]).stream().pipeThrough(new DecompressionStream("gzip"));
    plain=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const text=decoder.decode(plain.subarray(1));
  if (plain[0]!==79) throw Error(text || "Pi 명령 실패");
  return JSON.parse(text);
}

export async function connectBluetooth(password, disconnected) {
  const device=await navigator.bluetooth.requestDevice({filters:[{services:[serviceId]}]});
  const lost=()=>{
    if (session?.device === device) {session=null; disconnected();}
  };
  device.addEventListener("gattserverdisconnected",lost,{once:true});
  try {
    const server=await device.gatt.connect();
    const service=await server.getPrimaryService(serviceId);
    const control=await service.getCharacteristic(remoteId);
    const digest=await crypto.subtle.digest("SHA-256",encoder.encode(password));
    const key=await crypto.subtle.importKey("raw",digest,"AES-GCM",false,["encrypt","decrypt"]);
    const next={device,control,key,queue:Promise.resolve()};
    await transfer(next,"update-status",{});
    if (!device.gatt.connected) throw Error("Pi 연결이 끊겼습니다.");
    session=next;
  } catch(error) {
    device.removeEventListener("gattserverdisconnected",lost);
    device.gatt?.disconnect();
    throw error;
  }
}

export function bluetoothApi(action, body, onProgress) {
  const active=session;
  if (!active) return Promise.reject(Error("Bluetooth 연결이 필요합니다."));
  const result=active.queue.then(()=>{
    if (session!==active) throw Error("Bluetooth 연결이 끊겼습니다.");
    return transfer(active,action,body,onProgress);
  });
  active.queue=result.catch(()=>{});
  return result;
}
