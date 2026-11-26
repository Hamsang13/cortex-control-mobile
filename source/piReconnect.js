// Keep watching when the settings dialog closes or the tab resumes after a Wi-Fi change.
const storageKey = "cortex-remote.pending-connection";
let stopWatching;

export function watchPiRestart(target) {
  stopWatching?.();
  const destination = new URL(target.url);
  if (destination.protocol !== "http:" || !/^[a-f0-9]{64}$/.test(target.proof)) return;
  try { sessionStorage.setItem(storageKey, JSON.stringify(target)); } catch {}
  let stopped = false, timer, request;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
  }
  async function check() {
    if (stopped || document.hidden || request) return;
    clearTimeout(timer);
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 3500);
    try {
      const response = await fetch(new URL(target.wifiTicket ? "/wifi-ready/"+encodeURIComponent(target.wifiTicket) : "/pi-ready", destination.origin), {
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
        redirect: "error", signal: request.signal
      });
      if (response.ok && await response.text() === target.proof && !stopped) {
        stop();
        try { sessionStorage.removeItem(storageKey); } catch {}
        if (destination.origin === location.origin) {
          history.replaceState(null, "", destination.href);
          location.reload();
        } else {
          location.replace(destination.href);
        }
      }
    } catch {
      // Expected while the hotspot is restarting or the tablet is changing Wi-Fi.
    } finally {
      clearTimeout(timeout);
      request = null;
      if (!stopped) timer = setTimeout(check, 3000);
    }
  }
  stopWatching = stop;
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  check();
}

try {
  const saved = sessionStorage.getItem(storageKey);
  if (saved) watchPiRestart(JSON.parse(saved));
} catch {}
