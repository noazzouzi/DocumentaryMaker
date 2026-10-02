"""piper-align — Piper synthesis with exact phoneme alignments grouped into words (port of $SP/tts/piper_align.py).

in:  {model, text, outWav}
out: {sampleRate, words: [{ph, startMs, endMs}]}

piper-tts is GPL-3.0: it only ever runs in this subprocess (optional extra `piper`), never imported by TypeScript.
"""

import os
import wave

from . import SidecarError, progress

WORD_BREAKS = {" ", "^", "$", "_"}
PUNCT = set(".,;:!?…")


def run(inp: dict) -> dict:
    model = inp.get("model")
    text = (inp.get("text") or "").strip()
    out_wav = inp.get("outWav")
    if not model or not os.path.isfile(model):
        raise SidecarError("MODEL_MISSING", f"Piper model not found: {model!r}")
    if not text:
        raise SidecarError("VALIDATION", "empty text")
    if not out_wav:
        raise SidecarError("VALIDATION", "outWav is required")

    from piper import PiperVoice  # optional extra: missing → TOOL_MISSING

    voice = PiperVoice.load(model, include_alignments=True)
    sr = int(voice.config.sample_rate)
    words = []
    t = 0  # samples
    cur, cur_start = "", 0

    def flush() -> None:
        nonlocal cur
        if cur:
            words.append({"ph": cur, "startMs": round(cur_start / sr * 1000), "endMs": round(t / sr * 1000)})
            cur = ""

    os.makedirs(os.path.dirname(os.path.abspath(out_wav)) or ".", exist_ok=True)
    with wave.open(out_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        for chunk in voice.synthesize(text, include_alignments=True):
            wf.writeframes(chunk.audio_int16_bytes)
            for a in chunk.phoneme_alignments or []:
                ph, n = a.phoneme, a.num_samples
                if ph in WORD_BREAKS or ph in PUNCT:
                    flush()
                else:
                    if not cur:
                        cur_start = t
                    cur += ph
                t += n
            flush()
            progress(min(1.0, t / max(1, sr * 60)), "synthesizing")
    progress(1.0, "done")
    return {"sampleRate": sr, "words": words}
