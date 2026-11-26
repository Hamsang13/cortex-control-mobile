import React from "react";

export default function SaveIcon({size=22}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" style={{display:"block"}}>
      <path d="M4 2.5h13.5l4 4V20a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 20V4A1.5 1.5 0 0 1 4 2.5Z"/>
      <path d="M7 2.5v8h9v-8M13 4.5v4"/>
    </svg>
  );
}
