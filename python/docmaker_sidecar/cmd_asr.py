"""asr — faster-whisper transcription with word timestamps (port of $SP/tts/fw_test.py).

in:  {audio | audios: [path], lang, model, initialPrompt, vad, beamSize, computeType, threads, modelsDir, localFilesOnly}
out: {words: [{text, startMs, endMs, p}], durationSec, rtf}  — or {results: [that, ...]} for ``audios`` (one model load)

localFilesOnly: never download (HF_HUB_OFFLINE=1 + local_files_only); a missing model is MODEL_MISSING.

Word texts keep faster-whisper's leading space (" word"); a piece without one continues the previous word
(French elisions come back as " l" + "'acteur"). The Node side merges them.
"""

import os
import time

from . import SidecarError, progress

DEFAULT_MODEL = "large-v3-turbo"


def _transcribe(model, audio: str, inp: dict, frac0: float, frac1: float) -> dict:
    t1 = time.time()
    segments, info = model.transcribe(
        audio,
        language=inp.get("lang") or None,
        word_timestamps=True,
        vad_filter=bool(inp.get("vad", True)),
        beam_size=int(inp.get("beamSize") or 5),
        initial_prompt=inp.get("initialPrompt") or None,
    )
    duration = float(info.duration or 0.0)
    words = []
    for seg in segments:  # a generator: transcription happens while iterating
        if duration > 0:
            progress(frac0 + (frac1 - frac0) * min(1.0, seg.end / duration), "transcribing")
        for w in seg.words or []:
            words.append({
                "text": w.word,
                "startMs": int(round(w.start * 1000)),
                "endMs": int(round(w.end * 1000)),
                "p": round(float(w.probability), 4),
            })
    elapsed = time.time() - t1
    return {"words": words, "durationSec": duration, "rtf": (elapsed / duration) if duration > 0 else 0.0}


def run(inp: dict) -> dict:
    batch = inp.get("audios")
    if batch is not None:
        if not isinstance(batch, list) or not batch:
            raise SidecarError("VALIDATION", "audios must be a non-empty list of paths")
        audios = batch
    else:
        audios = [inp.get("audio")]
    for audio in audios:
        if not audio or not isinstance(audio, str) or not os.path.isfile(audio):
            raise SidecarError("VALIDATION", f"audio file not found: {audio!r}")
    model_name = inp.get("model") or DEFAULT_MODEL
    models_dir = inp.get("modelsDir") or None
    local_only = bool(inp.get("localFilesOnly", False))
    if models_dir:
        os.makedirs(models_dir, exist_ok=True)
    if local_only:
        os.environ["HF_HUB_OFFLINE"] = "1"  # before huggingface_hub is imported: never touch the network

    from faster_whisper import WhisperModel  # imported late: a missing package becomes TOOL_MISSING

    progress(0.0, f"loading {model_name}")
    t0 = time.time()
    try:
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type=inp.get("computeType") or "int8",
            cpu_threads=int(inp.get("threads") or 4),
            download_root=models_dir,
            local_files_only=local_only,
        )
    except Exception as e:  # noqa: BLE001
        where = " (not downloaded; local files only)" if local_only else ""
        raise SidecarError("MODEL_MISSING", f"cannot load the faster-whisper model {model_name!r}{where}: {e}") from e
    load = time.time() - t0
    results = []
    n = len(audios)
    for k, audio in enumerate(audios):
        results.append(_transcribe(model, audio, inp, k / n, (k + 1) / n))
    progress(1.0, f"done in {time.time() - t0:.1f}s (load {load:.1f}s, {n} file(s))")
    return {"results": results} if batch is not None else results[0]
