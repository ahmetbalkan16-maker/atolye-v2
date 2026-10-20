"""Atölye V3 — VoxCPM2 voice side process (local, offline, 0 $).

Loads `<ATOLYE_V3_VOXCPM_ROOT>/checkpoints/VoxCPM2` once, then reads one JSON request per stdin line:

  {"id": "...", "mode": "design", "text": "(voice description)Reference sentence.", "seed": 7, "out": "<wav>"}
  {"id": "...", "mode": "clone", "text": "(style)The line.", "reference": "<wav>", "seed": 1234, "out": "<wav>"}
  -> {"id": "...", "ok": true, "seconds": 3.1, "audio_seconds": 4.2}

"design" makes a voice from its description (VoxCPM2 voice design); "clone" reads a line in the timbre of the
reference clip with the style instruction in parentheses (controllable cloning). Nothing is downloaded (HF
offline); the Node caller waits for a cool GPU (73 °C) before every request. License: Apache-2.0 (VoxCPM2).
"""
import json
import os
import sys
import time
from pathlib import Path


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    started = time.monotonic()
    root = Path(os.environ["ATOLYE_V3_VOXCPM_ROOT"]).resolve()
    model_dir = root / "checkpoints" / "VoxCPM2"
    if not (model_dir / "model.safetensors").is_file():
        raise RuntimeError("VOXCPM_MODEL_MISSING")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from model_manifest import verify

    verify(model_dir, "openbmb/VoxCPM2")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    if not torch.cuda.is_available():
        raise RuntimeError("VOXCPM_CUDA_UNAVAILABLE")
    model = VoxCPM.from_pretrained(str(model_dir), load_denoiser=False)
    rate = model.tts_model.sample_rate
    sys.stdout = real_stdout
    reply({"ready": True, "device": "cuda", "load_seconds": round(time.monotonic() - started, 1)})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            if req.get("cmd") == "quit":
                break
            t0 = time.monotonic()
            args = {"text": str(req["text"]), "cfg_value": 2.0, "inference_timesteps": 10, "seed": int(req.get("seed", 0))}
            if req.get("mode") == "clone":
                ref = Path(str(req["reference"]))
                if not ref.is_file():
                    raise FileNotFoundError(f"reference missing: {ref}")
                args["reference_wav_path"] = str(ref)
            sys.stdout = sys.stderr
            try:
                wav = model.generate(**args)
            finally:
                sys.stdout = real_stdout
            sf.write(req["out"], wav, rate)
            reply({"id": req.get("id"), "ok": True, "seconds": round(time.monotonic() - t0, 1), "audio_seconds": round(len(wav) / rate, 2)})
        except Exception as e:  # one bad line never kills the server
            sys.stdout = real_stdout
            reply({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        reply({"ready": False, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
        raise
