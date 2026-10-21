"""Atölye V3 — VoxCPM2 voice side process (local, offline, 0 $).

Loads `<ATOLYE_V3_VOXCPM_ROOT>/checkpoints/VoxCPM2` once, then reads one JSON request per stdin line:

  {"id": "...", "mode": "design", "text": "(voice description)Reference sentence.", "seed": 7, "out": "<wav>"}
  {"id": "...", "mode": "clone", "text": "(style)The line.", "reference": "<wav>", "seed": 1234, "out": "<wav>"}
  -> {"id": "...", "ok": true, "seconds": 3.1, "audio_seconds": 4.2}

"design" makes a voice from its description (VoxCPM2 voice design); "clone" reads a line in the timbre of the
reference clip with the style instruction in parentheses (controllable cloning). Nothing is downloaded (HF
offline); the Node caller waits for a cool GPU before every request, and inside a line the generation pauses at
`max_temp` until the card is below `resume_below`, checked every second (owner rule: no GPU work at the shared stop;
on 21 Oct 2026, stop 73, a long line reached 74 °C with no check inside and 73 with a check every 2 s at 72 — the card
heats up to 2 °C/s and keeps rising for a moment after the work stops). License: Apache-2.0 (VoxCPM2).
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Defaults when a request names none: the Node caller sends GPU_PAUSE_C / GPU_START_C (stop 85 → 82 / 78).
PAUSE_AT_C = 82
RESUME_BELOW_C = 78
CHECK_EVERY_S = 1.0


def gpu_temperature():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


class Cooling:
    """A pre-hook on the model's per-step decoder: every few seconds of generation it reads the GPU temperature and,
    at `pause`, waits (no new GPU work) until the card is below `resume`, at most 10 minutes per pause."""

    def __init__(self):
        self.last = 0.0
        self.paused_s = 0.0
        self.pause = PAUSE_AT_C
        self.resume = RESUME_BELOW_C

    def __call__(self, _module, _args):
        now = time.monotonic()
        if now - self.last < CHECK_EVERY_S:
            return
        t = gpu_temperature()
        if t is not None and t >= self.pause:
            deadline = now + 600
            while t is not None and t >= self.resume and time.monotonic() < deadline:
                time.sleep(3)
                t = gpu_temperature()
            self.paused_s += time.monotonic() - now
        self.last = time.monotonic()


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
    cooling = Cooling()
    model.tts_model.feat_decoder.register_forward_pre_hook(cooling)
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
            cooling.paused_s = 0.0
            cooling.pause = int(req.get("max_temp", PAUSE_AT_C))
            cooling.resume = int(req.get("resume_below", RESUME_BELOW_C))
            # voxcpm 2.0.3 takes no seed argument: the seed is set before the call (same request, same voice).
            torch.manual_seed(int(req.get("seed", 0)))
            args = {"text": str(req["text"]), "cfg_value": 2.0, "inference_timesteps": 10}
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
            reply({"id": req.get("id"), "ok": True, "seconds": round(time.monotonic() - t0, 1), "audio_seconds": round(len(wav) / rate, 2), "cooled_seconds": round(cooling.paused_s, 1)})
        except Exception as e:  # one bad line never kills the server
            sys.stdout = real_stdout
            reply({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        reply({"ready": False, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
        raise
