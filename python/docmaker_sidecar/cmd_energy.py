"""energy — loudness and vocal-band presence per window of a WAV file.

Copied from audio_energy.py of the motion-graphics-music-video skill (scripts/tools/python/audio_energy.py),
MIT License, Copyright (c) 2026 makevoid. The analysis is unchanged; the I/O follows the sidecar protocol
(SPEC section 8.8) and the reader (shared with `beats`) accepts 8/16/24/32-bit PCM.

in:  {wav, windowSec}
out: {duration, rate, windows: [{t, rms_db, vocal_ratio}], silence_tail_s}
vocal_ratio = energy share in 300-3400 Hz (rough proxy for sung vocals).
"""

import os
import wave

from . import SidecarError, progress
from .cmd_beats import read_mono


def run(inp: dict) -> dict:
    import numpy as np

    path = inp.get("wav")
    if not path or not os.path.isfile(path):
        raise SidecarError("VALIDATION", f"wav file not found: {path!r}")
    win_s = float(inp.get("windowSec") or 0.5)
    if not (0.01 <= win_s <= 60):
        raise SidecarError("VALIDATION", f"windowSec out of range: {win_s}")
    try:
        data, rate = read_mono(path)
    except wave.Error as e:
        raise SidecarError("VALIDATION", f"not a PCM WAV file: {e}") from e
    n = int(rate * win_s)
    freqs = np.fft.rfftfreq(n, 1.0 / rate)
    band = (freqs >= 300) & (freqs <= 3400)
    windows = []
    total = max(len(data) - n + 1, 1)
    for i in range(0, total, n):
        chunk = data[i:i + n]
        if len(chunk) < n:
            chunk = np.pad(chunk, (0, n - len(chunk)))
        rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
        spec = np.abs(np.fft.rfft(chunk * np.hanning(n))) ** 2
        ratio = float(spec[band].sum() / (spec.sum() + 1e-12))
        windows.append({"t": round(i / rate, 2), "rms_db": round(20 * np.log10(rms), 1), "vocal_ratio": round(ratio, 3)})
        if len(windows) % 200 == 0:
            progress(i / total, "energy")
    tail = 0.0
    for wdw in reversed(windows):
        if wdw["rms_db"] < -45:
            tail += win_s
        else:
            break
    progress(1.0, "done")
    return {"duration": round(len(data) / rate, 3), "rate": rate, "windows": windows, "silence_tail_s": round(tail, 3)}
