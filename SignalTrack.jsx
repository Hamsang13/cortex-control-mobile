import React from "react";

export function meterReading(...channels) {
  const readings = channels.filter(Boolean);
  if (!readings.length) return null;
  return {
    db: Math.max(...readings.map((reading) => reading.db)),
    clip: readings.some((reading) => reading.clip),
  };
}

export const physicalInputs = ["input_1", "input_2"];
export const physicalOutputs = ["xlr_1", "xlr_2", "out_3", "out_4"];

export function hidReading(io, channel) {
  const value = io?.[channel];
  if (!Number.isFinite(value)) return null;
  return { db: (Math.min(1, Math.max(0, value)) - 1) * 40, clip: value >= 1 };
}

const inputs = {
  1: ["input_1"], 2: ["input_2"], 3: physicalInputs,
  4: ["return_1"], 5: ["return_2"], 6: ["return_1", "return_2"],
  8: ["usb_input_3l"], 9: ["usb_input_3r"],
  10: ["usb_input_4l"], 11: ["usb_input_4r"],
  12: ["usb_input_3l", "usb_input_3r"], 13: ["usb_input_4l", "usb_input_4r"],
};

const outputs = {
  1: ["grid_xlr_1", "grid_xlr_2"], 2: ["grid_out_3", "grid_out_4"],
  3: ["grid_send_1", "grid_send_2"], 4: ["grid_xlr_1"], 5: ["grid_xlr_2"],
  6: ["grid_out_3"], 7: ["grid_out_4"], 8: ["grid_send_1"], 9: ["grid_send_2"],
  10: ["usb_output_3l"], 11: ["usb_output_3r"],
  12: ["usb_output_4l"], 13: ["usb_output_4r"],
  14: ["usb_output_3l", "usb_output_3r"], 15: ["usb_output_4l", "usb_output_4r"],
  19: ["grid_xlr_1", "grid_xlr_2", "grid_out_3", "grid_out_4", "usb_output_2l", "usb_output_2r"],
  20: ["usb_output_2l"], 21: ["usb_output_2r"], 22: ["usb_output_2l", "usb_output_2r"],
};

export function inputReadings(port, frame) {
  return (inputs[port] ?? []).map(channel => hidReading(frame.io, channel));
}

export function outputReadings(port, frame) {
  return (outputs[port] ?? []).map(channel => hidReading(frame.io, channel));
}

export function MeterTrack({ reading }) {
  const fill = reading ? ((reading.db + 40) / 40) * 100 : 0;
  return <span className="signal-track" aria-hidden="true"
    style={{ "--signal-fill": fill + "%" }} />;
}
