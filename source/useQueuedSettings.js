import {useEffect, useRef, useState} from "react";

// Show each requested value immediately. The device still receives ordered writes
// with the previous value confirmed by the preceding response.
export function useQueuedSettings(scope, values, write, accept, recover) {
  const queue = useRef([]);
  const [draft, setDraft] = useState({});
  useEffect(() => {
    setDraft({});
    return () => { queue.current = []; };
  }, [scope]);
  async function enqueue(entries) {
    if (!scope || !entries.length) return;
    const batch = queue.current;
    const running = batch.length > 0;
    batch.push(...entries);
    setDraft(Object.fromEntries(batch));
    if (running) return;
    let confirmed = values;
    try {
      while (batch.length && queue.current === batch) {
        const [key,value] = batch[0];
        if (confirmed[key] != null && confirmed[key] !== value) {
          confirmed = await write(key,value,confirmed[key]);
          if (queue.current !== batch) return;
          accept(confirmed);
        }
        batch.shift();
        setDraft(Object.fromEntries(batch));
      }
    } catch (error) {
      if (queue.current === batch) {
        try {
          const state = await recover(error);
          if (state && queue.current === batch) accept(state);
        } finally {
          if (queue.current === batch) {
            batch.length = 0;
            setDraft({});
          }
        }
      }
    }
  }
  return {draft, enqueue, queue};
}
