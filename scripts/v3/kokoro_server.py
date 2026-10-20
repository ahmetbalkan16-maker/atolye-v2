"""Atölye V3 — Kokoro-82M English TTS side process (Apache-2.0, hexgrad/Kokoro-82M).

Loads the model once, then reads one JSON request per stdin line and answers one JSON line on stdout:

  {"id": "...", "text": "...", "voice": "am_michael" | "am_michael:0.6,am_fenrir:0.4", "speed": 1.0, "out": "<wav>"}
  -> {"id": "...", "ok": true, "duration": 2.41, "sample_rate": 24000}

Voices starting with "a" are American English, "b" British English; a blend uses the first voice's accent.
Pitch, trimming and loudness are done by the Node caller with FFmpeg. Weights are cached under HF_HOME.
"""
import json
import sys
import time

REPO = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24000


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    started = time.monotonic()
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    american = KPipeline(lang_code="a", repo_id=REPO, device=device)
    pipelines = {"a": american, "b": KPipeline(lang_code="b", repo_id=REPO, model=american.model)}
    reply({"ready": True, "device": device, "load_seconds": round(time.monotonic() - started, 1)})

    def voice_of(spec):
        parts = [p.split(":") for p in spec.split(",") if p.strip()]
        names = [p[0].strip() for p in parts]
        accent = names[0][0]
        if accent not in pipelines or any(n[0] != accent for n in names):
            raise ValueError(f"unsupported or mixed-accent voice: {spec}")
        pipeline = pipelines[accent]
        if len(names) == 1:
            return pipeline, names[0]
        weights = [float(p[1]) if len(p) > 1 else 1.0 for p in parts]
        total = sum(weights)
        blend = sum(pipeline.load_voice(n) * (w / total) for n, w in zip(names, weights))
        return pipeline, blend

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            if req.get("cmd") == "quit":
                break
            pipeline, voice = voice_of(req["voice"])
            chunks = [audio.cpu().numpy() if hasattr(audio, "cpu") else np.asarray(audio)
                      for _, _, audio in pipeline(req["text"], voice=voice, speed=float(req.get("speed", 1.0)), split_pattern=r"\n+")
                      if audio is not None]
            if not chunks:
                raise RuntimeError("no audio produced")
            wav = np.concatenate(chunks)
            sf.write(req["out"], wav, SAMPLE_RATE, subtype="PCM_16")
            reply({"id": req.get("id"), "ok": True, "duration": round(len(wav) / SAMPLE_RATE, 4), "sample_rate": SAMPLE_RATE})
        except Exception as exc:  # report and keep serving the next line
            reply({"id": req.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
