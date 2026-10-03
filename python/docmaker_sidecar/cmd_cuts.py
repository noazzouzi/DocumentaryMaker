"""cuts — hard cuts (shot boundaries) of a video.

Port of ``cuts.py`` from motion-graphics-music-video-skill (https://github.com/makevoid/motion-graphics-music-video-skill),
MIT License, Copyright (c) 2026 makevoid. Algorithm unchanged: mean absolute difference of 96x54 grey thumbnails between
consecutive frames; a frame is a cut when its difference is >= ``threshold`` (default 18) and >= 3x the median of its
+-6 neighbours.

in:  {video, ffmpeg?: "ffmpeg", threshold?: 18, fps?: 25, fromMs?: number, toMs?: number}
out: {cuts: [{t, f, score}], frames, fps}
     t = seconds in the SOURCE file (fromMs already added), f = round(t * fps), score = the frame difference (0..255).

Frames are resampled to a fixed ``fps`` so times do not depend on the container's timestamps (VFR sources). numpy is used
when available (it is a sidecar dependency); a pure-Python path keeps the command usable without it.
"""

import os
import statistics
import subprocess

from . import SidecarError, progress

W, H = 96, 54
FRAME = W * H


def _diffs_numpy(raw: bytes) -> list:
    import numpy as np  # noqa: PLC0415 — optional fast path

    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
    if len(frames) == 0:
        return []
    d = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    return [0.0] + [float(x) for x in d]


def _diffs_python(raw: bytes) -> list:
    n = len(raw) // FRAME
    out = [0.0] if n > 0 else []
    for i in range(1, n):
        a = raw[(i - 1) * FRAME:i * FRAME]
        b = raw[i * FRAME:(i + 1) * FRAME]
        out.append(sum(abs(x - y) for x, y in zip(a, b)) / FRAME)
    return out


def find_cuts(diff: list, threshold: float) -> list:
    """Indices i (>= 1) whose difference is >= threshold and >= 3x the median of the +-6 neighbours."""
    cuts = []
    for i in range(1, len(diff)):
        near = diff[max(i - 6, 1):i] + diff[i + 1:i + 7]
        med = statistics.median(near) if near else 0.0
        if diff[i] >= threshold and diff[i] >= 3 * med:
            cuts.append(i)
    return cuts


def run(inp: dict) -> dict:
    video = inp.get("video")
    if not video or not os.path.isfile(video):
        raise SidecarError("VALIDATION", f"video file not found: {video!r}")
    ffmpeg = inp.get("ffmpeg") or "ffmpeg"
    threshold = float(inp.get("threshold") or 18.0)
    fps = float(inp.get("fps") or 25.0)
    if not (1.0 <= fps <= 120.0):
        raise SidecarError("VALIDATION", f"fps out of range: {fps}")
    from_ms = inp.get("fromMs")
    to_ms = inp.get("toMs")
    offset = max(0.0, float(from_ms) / 1000.0) if from_ms is not None else 0.0

    cmd = [ffmpeg, "-v", "error", "-nostdin"]
    if from_ms is not None:
        cmd += ["-ss", f"{offset:.3f}"]
    if to_ms is not None:
        cmd += ["-to", f"{max(offset, float(to_ms) / 1000.0):.3f}"]
    cmd += ["-i", video, "-an", "-vf", f"fps={fps:g},scale={W}:{H}:flags=area,format=gray", "-f", "rawvideo", "-"]
    progress(0.0, "decoding frames")
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False)
    except FileNotFoundError as e:
        raise SidecarError("TOOL_MISSING", f"ffmpeg not found: {ffmpeg}") from e
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-3:]
        raise SidecarError("INTERNAL", "ffmpeg failed: " + " | ".join(tail))
    raw = proc.stdout[: len(proc.stdout) // FRAME * FRAME]
    progress(0.6, "comparing frames")
    try:
        diff = _diffs_numpy(raw)
    except ImportError:
        diff = _diffs_python(raw)
    cuts = []
    for i in find_cuts(diff, threshold):
        t = round(offset + i / fps, 3)
        cuts.append({"t": t, "f": int(round(t * fps)), "score": round(diff[i], 1)})
    progress(1.0, f"{len(cuts)} cuts")
    return {"cuts": cuts, "frames": len(diff), "fps": fps}
