import React from "react";

export function meterReading(...channels) {
  const readings = channels.filter(Boolean);
  if (!readings.length) return null;
  return {
    db: Math.max(...readings.map((reading) => reading.db)),
    clip: readings.some((reading) => reading.clip),
  };
}

export function outputReadings(port, frame) {
  const channels = frame.channels ?? [], io = frame.io ?? {};
  const ports = {1:["grid_xlr_1","grid_xlr_2"],2:["grid_out_3","grid_out_4"],
    3:["grid_send_1","grid_send_2"],4:["grid_xlr_1"],5:["grid_xlr_2"],6:["grid_out_3"],
    7:["grid_out_4"],8:["grid_send_1"],9:["grid_send_2"]};
  const usb = {10:[4],11:[5],12:[6],13:[7],14:[4,5],15:[6,7],19:[2,3],20:[2],21:[3],22:[2,3]};
  if (usb[port]) return usb[port].map(i=>channels[i]);
  return (ports[port]??[]).map(k=>Number.isFinite(io[k])?{db:(io[k]-1)*40,clip:io[k]>=1}:null);
}

export function MeterTrack({ reading }) {
  const fill = reading ? ((reading.db + 60) / 60) * 100 : 0;
  return <span className="signal-track" aria-hidden="true"
    style={{ "--signal-fill": fill + "%" }} />;
}
