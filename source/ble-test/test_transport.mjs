import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";

globalThis.location=new URL("https://localhost/?transport=ble");
const {connectBluetooth, bluetoothApi}=await import("../bleTransport.js");
const proc=spawn(process.env.PYTHON || "python", [fileURLToPath(new URL("./test_peer.py",import.meta.url))],{stdio:["pipe","pipe","inherit"]});
const lines=createInterface({input:proc.stdout})[Symbol.asyncIterator]();
async function exchange(packet) {
  proc.stdin.write(JSON.stringify(packet)+"\n");
  const result=JSON.parse((await lines.next()).value);
  if (result.error) throw Error(result.error);
  return result;
}
const device=new EventTarget();
device.gatt={
  connected:false,
  disconnect(){this.connected=false;device.dispatchEvent(new Event("gattserverdisconnected"));},
  async connect(){this.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async()=>({
    writeValueWithResponse:async bytes=>exchange([...bytes]),
    readValue:async()=>new DataView(Uint8Array.from(await exchange(null)).buffer),
  })})};}
};
Object.defineProperty(navigator,"bluetooth",{value:{requestDevice:async()=>device}});
try {
  await assert.rejects(connectBluetooth("incorrect",()=>{}));
  let lost=false;
  await connectBluetooth("local-fixture",()=>{lost=true;});
  const [presets,grid]=await Promise.all([bluetoothApi("presets",{}),bluetoothApi("live",{})]);
  assert.ok(presets.length);
  const recalled=await bluetoothApi("recall",{slot:presets.at(-1).slot,rev:grid.rev,scene:grid.scene});
  const block=recalled.blocks.find(b=>b.params.length);
  const change={row:block.row,col:block.col,index:0,value:.42,rev:recalled.rev,scene:recalled.scene};
  let pages=0;
  const edited=await bluetoothApi("edit",change,()=>pages++);
  assert.equal(edited.blocks.find(b=>b.row===block.row && b.col===block.col).params[0].values[0],.42);
  assert.ok(pages>1);
  await assert.rejects(bluetoothApi("edit",change),/State changed/);
  assert.equal((await bluetoothApi("scene",{target:7})).scene,7);
  device.gatt.disconnect();
  assert.ok(lost);
  await assert.rejects(bluetoothApi("live",{}));
  console.log("PASS authentication, concurrent reads, preset recall, multi-page edit, stale revision, scene and disconnect");
} finally {proc.stdin.end();proc.kill();}
