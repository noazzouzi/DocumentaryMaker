"""beats — beat grid, onsets and loudness of a music track (numpy only).

Copied from beats.py of the motion-graphics-music-video skill (scripts/tools/python/beats.py),
MIT License, Copyright (c) 2026 makevoid. The analysis is unchanged (spectral flux, comb search of tempo and
phase over 80-180 BPM, coarse then fine, beats snapped to the strongest onset within +-40 ms, downbeat = the phase of 4
with the most kick-band energy); additions: a half-beat check on the kick band (off-beat hats can win the full-band
comb). The I/O was adapted to the sidecar protocol (SPEC section 8.8) and the reader
accepts 8/16/24/32-bit PCM.

in:  {wav, fps}
out: {duration, fps, bpm, period, phase, beats: [{t, f, n, bar_pos, strength, low}], onsets: [{t, f, strength, low}],
      loudness: [{t, db}]}   (t in seconds; strength/low normalised to the track's 95th percentile)
"""

import os
import wave

from . import SidecarError, progress

HOP = 256
N_FFT = 2048


def read_mono(path):
    import numpy as np

    with wave.open(path, "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        data = v.astype(np.float32) / 8388608.0
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise SidecarError("VALIDATION", f"unsupported sample width {width}")
    return data.reshape(-1, ch).mean(axis=1), rate


def flux(mag, lo, hi):
    import numpy as np

    band = np.log1p(100 * mag[lo:hi])
    d = np.diff(band, axis=1, prepend=band[:, :1])
    return np.maximum(d, 0).sum(axis=0)


def norm(x):
    import numpy as np

    x = x - np.median(x)
    return np.clip(x / (np.percentile(x, 95) + 1e-9), 0, None)


def run(inp: dict) -> dict:
    import numpy as np

    path = inp.get("wav")
    if not path or not os.path.isfile(path):
        raise SidecarError("VALIDATION", f"wav file not found: {path!r}")
    fps = float(inp.get("fps") or 24.0)
    try:
        y, rate = read_mono(path)
    except wave.Error as e:
        raise SidecarError("VALIDATION", f"not a PCM WAV file: {e}") from e
    if len(y) < N_FFT * 4:
        raise SidecarError("VALIDATION", "audio too short for beat tracking")
    progress(0.05, "spectral flux")
    win = np.hanning(N_FFT).astype(np.float32)
    n = 1 + (len(y) - N_FFT) // HOP
    y = np.ascontiguousarray(y)
    frames = np.lib.stride_tricks.as_strided(y, shape=(n, N_FFT), strides=(y.strides[0] * HOP, y.strides[0]))
    mag = np.abs(np.fft.rfft(frames * win, axis=1)).T
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / rate)
    t = (np.arange(n) * HOP + N_FFT / 2) / rate

    full = norm(flux(mag, 1, len(freqs)))
    low = norm(flux(mag, 1, int(np.searchsorted(freqs, 150))))
    env = full + low

    # Tempo + phase: the comb (period, offset) over the whole song that lands on the most onset energy, 80-180 BPM,
    # coarse then fine. (Autocorrelation was ~0.4% off, a beat and a half of drift over a 140s song.)
    frame_rate = rate / HOP

    def comb(period, ph):
        idx = np.round((np.arange(ph, t[-1], period) - t[0]) * frame_rate).astype(int)
        idx = idx[(idx >= 0) & (idx < len(env))]
        return env[idx].mean() if len(idx) else 0.0

    def best(bpms, n_phase):
        cands = []
        for bpm in bpms:
            p = 60 / bpm
            phs = np.linspace(0, p, n_phase, endpoint=False)
            scores = [comb(p, ph) for ph in phs]
            k = int(np.argmax(scores))
            cands.append((scores[k], p, phs[k]))
        return max(cands)

    progress(0.2, "tempo search")
    _, period, _ = best(np.arange(80, 180, 0.25), 48)
    progress(0.7, "phase search")
    _, period, phase = best(np.arange(60 / period - 0.3, 60 / period + 0.3, 0.02), 128)
    # Half-beat disambiguation (addition to the original): bright off-beat hats can out-score the beat itself in the
    # full-band comb; the beat is the half-period phase with more kick-band (< 150 Hz) energy.
    def comb_low(period, ph):
        idx = np.round((np.arange(ph, t[-1], period) - t[0]) * frame_rate).astype(int)
        idx = idx[(idx >= 0) & (idx < len(low))]
        return low[idx].mean() if len(idx) else 0.0

    alt = (phase + period / 2) % period
    if comb_low(period, alt) > 1.25 * comb_low(period, phase) + 1e-6:
        phase = alt
    grid = np.arange(phase, t[-1], period)

    # Snap every grid beat to the strongest onset within +-40 ms (small tempo drift).
    beats = []
    for i, bt in enumerate(grid):
        k = int(round((bt - t[0]) * frame_rate))
        lo_k, hi_k = max(k - 6, 0), min(k + 7, len(env))
        if lo_k >= hi_k:
            continue
        j = lo_k + int(np.argmax(env[lo_k:hi_k]))
        beats.append({"t": round(float(t[j]), 3), "n": i, "strength": round(float(full[j]), 2), "low": round(float(low[j]), 2)})

    # Downbeat: the phase of 4 with the most kick energy.
    bar = int(np.argmax([sum(b["low"] for b in beats if b["n"] % 4 == p) for p in range(4)])) if beats else 0
    for b in beats:
        b["bar_pos"] = (b["n"] - bar) % 4
        b["f"] = int(round(b["t"] * fps))

    # Onsets: local maxima of the envelope above threshold, >= 90 ms apart.
    onsets = []
    thr = 1.2
    last = -1.0
    for j in range(1, len(env) - 1):
        if env[j] >= thr and env[j] >= env[j - 1] and env[j] > env[j + 1] and t[j] - last >= 0.09:
            onsets.append({"t": round(float(t[j]), 3), "f": int(round(t[j] * fps)),
                           "strength": round(float(full[j]), 2), "low": round(float(low[j]), 2)})
            last = t[j]

    step = int(0.25 * rate)
    loud = []
    for i in range(0, len(y) - step + 1, step):
        rms = float(np.sqrt(np.mean(y[i:i + step] ** 2)) + 1e-9)
        loud.append({"t": round(i / rate, 2), "db": round(20 * np.log10(rms), 1)})

    progress(1.0, "done")
    return {"duration": round(len(y) / rate, 3), "fps": fps, "bpm": round(60 / period, 2),
            "period": round(float(period), 4), "phase": round(float(phase), 4),
            "beats": beats, "onsets": onsets, "loudness": loud}
