"""Measure the Quad Cortex USB recording stream without occupying the HID worker."""
import threading
import time

lock = threading.Lock()
worker = None
channel = 0
deadline = 0
sample = {}


def frequency(buffer, rate):
    import numpy as np

    x = buffer[::4].astype(float)
    x -= x.mean()
    if np.sqrt(np.mean(x * x)) < .0005:
        return None
    rate /= 4
    low, high = int(rate / 1500), min(int(rate / 27), len(x) // 2)
    corr = np.fft.irfft(abs(np.fft.rfft(x, 2 * len(x))) ** 2)[:high + 2]
    energy = np.r_[0., np.cumsum(x * x)]
    lag = np.arange(high + 2)
    corr = 2 * corr / np.maximum(energy[len(x) - lag] + energy[-1] - energy[lag], 1e-10)
    peaks = [k for k in range(low, high + 1)
             if corr[k-1] < corr[k] >= corr[k+1] and corr[k] > .85]
    if not peaks:
        return None
    threshold = .98 * max(corr[j] for j in peaks)
    k = next(i for i in peaks if corr[i] >= threshold)
    a, b, c = corr[k-1:k+2]
    return rate / (k + .5 * (a - c) / (a - 2*b + c)) if a + c != 2*b else rate / k


def listen(selected):
    global sample, worker
    try:
        import numpy as np
        import sounddevice as sd

        pair = f"({selected // 2 * 2 + 1}+{selected // 2 * 2 + 2})"
        devices = [(i, d) for i, d in enumerate(sd.query_devices())
                   if "quad cortex" in d["name"].lower() and d["max_input_channels"] > 0]
        matches = [(i, selected % 2, d) for i, d in devices if pair in d["name"]]
        matches += [(i, selected, d) for i, d in devices if d["max_input_channels"] >= 8]
        if not matches:
            raise ValueError("Quad Cortex USB 녹음 채널을 열 수 없습니다.")
        i, ch, device = matches[0]
        rate = int(device["default_samplerate"])
        with sd.InputStream(device=i, samplerate=rate, channels=min(8, device["max_input_channels"]), dtype="float32") as stream:
            buf = np.zeros(4096)
            while time.monotonic() < deadline and selected == channel:
                frames, _ = stream.read(1024)
                buf[:-1024] = buf[1024:]
                buf[-1024:] = frames[:, ch]
                hz = frequency(buf, rate)
                with lock:
                    if channel == selected:
                        sample = {"hz": hz}
    except Exception as exc:
        with lock:
            sample = {"errorMessage": str(exc)}
    finally:
        with lock:
            worker = None


def read(selected):
    global worker, channel, deadline, sample
    if type(selected) != int or not 0 <= selected < 8:
        raise ValueError("Invalid USB audio channel")
    with lock:
        deadline = time.monotonic() + 1
        if selected != channel or worker is None:
            channel = selected
            previous = sample
            sample = {}
            if worker is None:
                worker = threading.Thread(target=listen, args=(selected,), daemon=True)
                worker.start()
            return previous if "errorMessage" in previous else {}
        return sample
