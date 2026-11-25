import React from "react";

export function meterReading(...channels) {
  const readings = channels.filter(Boolean);
  if (!readings.length) return null;
  return {
    db: Math.max(...readings.map((reading) => reading.db)),
    clip: readings.some((reading) => reading.clip),
  };
}

export function MeterTrack({ reading }) {
  const fill = reading ? ((reading.db + 60) / 60) * 100 : 0;
  return <span className="signal-track" aria-hidden="true"
    style={{ "--signal-fill": fill + "%" }} />;
}
