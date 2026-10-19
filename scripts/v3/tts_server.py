"""Atölye V3 — Chatterbox Multilingual TTS side process.

Loads the model once, then reads one JSON request per stdin line and answers one JSON line on stdout:

  {"id": "...", "text": "...", "ref": "<wav>", "out": "<wav>", "exaggeration": 0.5, "cfg": 0.5,
   "temperature": 0.8, "seed": 1234}
  -> {"id": "...", "ok": true, "duration": 2.41, "sample_rate": 24000}

Everything else (pitch, tempo, trimming, loudness) is done by the Node caller with FFmpeg. Model files are
cached under HF_HOME (set by the caller to the V3 tools folder). License: Chatterbox is MIT; its output
carries Resemble's inaudible Perth watermark.
"""
import json
import sys
import time


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    started = time.monotonic()
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    reply({"ready": True, "device": device, "load_seconds": round(time.monotonic() - started, 1)})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            if req.get("cmd") == "quit":
                break
            seed = int(req.get("seed", 1234))
            torch.manual_seed(seed)
            if device == "cuda":
                torch.cuda.manual_seed_all(seed)
            wav = model.generate(
                req["text"],
                language_id=req.get("lang") or "tr",
                audio_prompt_path=req.get("ref") or None,
                exaggeration=float(req.get("exaggeration", 0.5)),
                cfg_weight=float(req.get("cfg", 0.5)),
                temperature=float(req.get("temperature", 0.8)),
            )
            torchaudio.save(req["out"], wav.cpu(), model.sr)
            reply({"id": req.get("id"), "ok": True, "duration": round(wav.shape[-1] / model.sr, 4), "sample_rate": model.sr})
        except Exception as exc:  # report and keep serving the next line
            reply({"id": req.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
