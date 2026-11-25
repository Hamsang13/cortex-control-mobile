"""Read Quad Cortex USB audio for the tuner and the signal meters."""
from contextlib import ExitStack
import math
import re
import threading
import time

lock = threading.Lock()
worker = None
pitch_channel = 0
pitch_until = 0
meter_until = 0
buffers = {}
levels = {}
error = None


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



def endpoints(sd, channels):
    devices = [(i, d) for i, d in enumerate(sd.query_devices())
               if "quad cortex" in d["name"].lower() and d["max_input_channels"] > 0]
    multichannel = next(((i, d) for i, d in devices if d["max_input_channels"] >= 8), None)
    if multichannel:
        i, device = multichannel
        return [(i, device, range(8))]
    result = []
    for start in range(0, 8, 2):
        if not channels.intersection((start, start + 1)):
            continue
        pair = rf"\(\s*{start + 1}\s*\+\s*{start + 2}\s*\)"
        match = next(((i, d) for i, d in devices if d["max_input_channels"] >= 2
                      and re.search(pair, d["name"])), None)
        if match:
            i, device = match
            result.append((i, device, range(start, start + 2)))
    return result


def capture(channels, rate):
    import numpy as np

    def callback(frames, count, timing, status):
        now = time.monotonic()
        peaks = np.max(np.abs(frames), axis=0)
        with lock:
            for channel, peak in zip(channels, peaks):
                peak = float(peak)
                db = max(-60, min(0, 20 * math.log10(max(peak, .001))))
                previous, clipped, updated = levels.get(channel, (-60, 0, now))
                levels[channel] = (max(db, previous - 75 * (now - updated)),
                                   now + .8 if peak >= .9999 else clipped, now)
            if now < pitch_until and pitch_channel in channels:
                previous, _ = buffers.get(pitch_channel, (np.empty(0), rate))
                data = frames[:, pitch_channel - channels.start]
                buffers[pitch_channel] = (np.concatenate((previous, data))[-4096:], rate)

    return callback


def listen():
    global worker, error
    try:
        import sounddevice as sd

        with ExitStack() as streams:
            opened = set()
            while True:
                now = time.monotonic()
                with lock:
                    channels = set(range(4)) if now < meter_until else set()
                    if now < pitch_until:
                        channels.add(pitch_channel)
                if not channels:
                    break
                for i, device, channel_range in endpoints(sd, channels):
                    if i in opened:
                        continue
                    rate = int(device["default_samplerate"])
                    try:
                        streams.enter_context(sd.InputStream(
                            device=i, samplerate=rate, channels=len(channel_range),
                            dtype="float32", blocksize=1024, callback=capture(channel_range, rate),
                        ))
                    except sd.PortAudioError as exc:
                        with lock:
                            error = str(exc)
                        continue
                    opened.add(i)
                time.sleep(.1 if channels.issubset(levels) else .4)
    except Exception as exc:
        with lock:
            error = str(exc)
    finally:
        with lock:
            levels.clear()
            buffers.clear()
            worker = None


def ensure_worker():
    global worker, error
    if worker is None:
        error = None
        worker = threading.Thread(target=listen, daemon=True)
        worker.start()


def read(selected):
    global pitch_channel, pitch_until
    if type(selected) is not int or not 0 <= selected < 8:
        raise ValueError("Invalid USB audio channel")
    with lock:
        if pitch_channel != selected:
            buffers.clear()
        pitch_channel = selected
        pitch_until = time.monotonic() + 1
        problem = error
        ensure_worker()
        reading = buffers.get(selected)
    if reading and len(reading[0]) == 4096:
        return {"hz": frequency(*reading)}
    return {"errorMessage": problem} if problem else {}


def read_meters():
    global meter_until
    with lock:
        now = time.monotonic()
        meter_until = now + .75
        ensure_worker()
        return {"channels": [
            {"db": round(db, 1), "clip": clip > now}
            if now - updated < .35 else None
            for db, clip, updated in (levels.get(i, (-60, 0, -math.inf)) for i in range(4))
        ]}
