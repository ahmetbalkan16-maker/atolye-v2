"""Atölye V3 — ACE-Step 1.5 composer side process (local, offline, 0 $).

Loads the ACE-Step 1.5 turbo DiT once from `<ATOLYE_V3_ACESTEP_ROOT>/checkpoints` (no language model: instrumental
beds need no lyrics planning), then reads one JSON request per stdin line:

  {"id": "...", "caption": "...", "duration": 32, "seed": 1234, "out": "<wav>", "max_temp": 73}
  -> {"id": "...", "ok": true, "seconds": 41.2, "peak_vram_gb": 7.1}

Nothing is downloaded (HF offline). Before every piece the card rests while it is at or above `max_temp` (default
73 °C, the owner's limit); the Node caller waits for a cool GPU too. License: MIT (ACE-Step 1.5).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def gpu_temperature():
    """GPU temperature in °C, or None when nvidia-smi cannot be read (an unreadable sensor never blocks)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def cool_down(limit, max_wait_s=600):
    deadline = time.monotonic() + max_wait_s
    t = gpu_temperature()
    while t is not None and t >= limit and time.monotonic() < deadline:
        time.sleep(3)
        t = gpu_temperature()


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    started = time.monotonic()
    root = Path(os.environ["ATOLYE_V3_ACESTEP_ROOT"]).resolve()
    turbo = root / "checkpoints" / "acestep-v15-turbo"
    if not turbo.is_dir() or not (root / "checkpoints" / "vae").is_dir():
        raise RuntimeError("ACESTEP_MODEL_MISSING")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path.insert(0, str(root))
    # ACE-Step logs to stdout; the line protocol needs stdout for itself.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import torch
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    if not torch.cuda.is_available():
        raise RuntimeError("ACESTEP_CUDA_UNAVAILABLE")
    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root=str(root), config_path="acestep-v15-turbo", device="cuda")
    if not ok:
        raise RuntimeError(f"ACESTEP_INIT_FAILED: {status}")
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
            cool_down(int(req.get("max_temp", 73)))
            t0 = time.monotonic()
            torch.cuda.reset_peak_memory_stats()
            params = GenerationParams(caption=str(req["caption"]), lyrics="", instrumental=True, duration=float(req["duration"]), thinking=False, use_cot_metas=False, use_cot_caption=False, use_cot_language=False)
            config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[int(req.get("seed", 0))], audio_format="wav")
            with tempfile.TemporaryDirectory(dir=os.environ.get("TEMP")) as work:
                sys.stdout = sys.stderr
                try:
                    result = generate_music(dit, None, params, config, save_dir=work)
                finally:
                    sys.stdout = real_stdout
                if not result.success or not result.audios:
                    raise RuntimeError(f"ACESTEP_GENERATION_FAILED: {result.error or result.status_message}")
                shutil.copyfile(result.audios[0]["path"], req["out"])
            reply({"id": req.get("id"), "ok": True, "seconds": round(time.monotonic() - t0, 1), "peak_vram_gb": round(torch.cuda.max_memory_allocated() / 2**30, 1)})
        except Exception as e:  # one bad request never kills the server
            sys.stdout = real_stdout
            reply({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        reply({"ready": False, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
        raise
