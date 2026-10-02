"""asr — faster-whisper transcription with word timestamps (port of $SP/tts/fw_test.py).

in:  {audio, lang, model, initialPrompt, vad, beamSize, computeType, threads, modelsDir}
out: {words: [{text, startMs, endMs, p}], durationSec, rtf}

Word texts keep faster-whisper's leading space (" word"); a piece without one continues the previous word
(French elisions come back as " l" + "'acteur"). The Node side merges them.
"""

import os
import time

from . import SidecarError, progress

DEFAULT_MODEL = "large-v3-turbo"


def run(inp: dict) -> dict:
    audio = inp.get("audio")
    if not audio or not os.path.isfile(audio):
        raise SidecarError("VALIDATION", f"audio file not found: {audio!r}")
    lang = inp.get("lang") or None
    model_name = inp.get("model") or DEFAULT_MODEL
    models_dir = inp.get("modelsDir") or None
    if models_dir:
        os.makedirs(models_dir, exist_ok=True)

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
        )
    except Exception as e:  # noqa: BLE001
        raise SidecarError("MODEL_MISSING", f"cannot load the faster-whisper model {model_name!r}: {e}") from e
    t1 = time.time()
    segments, info = model.transcribe(
        audio,
        language=lang,
        word_timestamps=True,
        vad_filter=bool(inp.get("vad", True)),
        beam_size=int(inp.get("beamSize") or 5),
        initial_prompt=inp.get("initialPrompt") or None,
    )
    duration = float(info.duration or 0.0)
    words = []
    for seg in segments:  # a generator: transcription happens while iterating
        if duration > 0:
            progress(min(1.0, seg.end / duration), "transcribing")
        for w in seg.words or []:
            words.append({
                "text": w.word,
                "startMs": int(round(w.start * 1000)),
                "endMs": int(round(w.end * 1000)),
                "p": round(float(w.probability), 4),
            })
    elapsed = time.time() - t1
    progress(1.0, f"done in {elapsed:.1f}s (load {t1 - t0:.1f}s)")
    return {"words": words, "durationSec": duration, "rtf": (elapsed / duration) if duration > 0 else 0.0}
