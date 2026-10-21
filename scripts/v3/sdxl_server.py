"""Atölye V3 — SDXL base 1.0 background designer side process (local, offline, 0 $).

Loads the installed SDXL weights once (diffusers layout, fp16), then reads one JSON request per stdin line:

  {"id": "...", "prompt": "...", "prompt_2": "...", "negative": "...", "seed": 1234, "out": "<png>", "steps": 30,
   "width": 1344, "height": 768, "final_width": 1920, "final_height": 1080, "pace": 0.2}
  -> {"id": "...", "ok": true, "seconds": 21.4, "peak_vram_gb": 7.9}

The model folder is checked against its manifest (file names and sizes) before loading; nothing is downloaded
(HF offline). `pace` sleeps between denoising steps, and after every step the card rests while it is at or above
`max_temp` (default 82 °C) until it is below `resume_below` (78): a drawing takes longer, the card never reaches the
owner's shared stop (85 °C). The Node caller also waits for a cool GPU before each image. License: CreativeML Open RAIL++-M.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def gpu_temperature():
    """GPU temperature in °C, or None when nvidia-smi cannot be read (an unreadable sensor never blocks)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def cool_down(limit, resume=None, max_wait_s=600):
    """Owner rule, also DURING a drawing (no GPU work at the 85 °C stop): at or above `limit` (82) the card
    rests between steps until it is below `resume` (78)."""
    deadline = time.monotonic() + max_wait_s
    t = gpu_temperature()
    if t is None or t < limit:
        return
    floor = limit if resume is None else resume
    while t is not None and t >= floor and time.monotonic() < deadline:
        time.sleep(3)
        t = gpu_temperature()


def reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    started = time.monotonic()
    model_dir = Path(os.environ["ATOLYE_V3_SDXL_MODEL"]).resolve()
    manifest = json.loads((model_dir.parent / "model-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("repository") != "stabilityai/stable-diffusion-xl-base-1.0":
        raise RuntimeError("SDXL_MODEL_UNREVIEWED")
    for record in manifest["files"]:
        f = (model_dir / record["file"]).resolve()
        if not f.is_relative_to(model_dir) or not f.is_file() or f.stat().st_size != record["bytes"]:
            raise RuntimeError(f"SDXL_MODEL_CHANGED: {record['file']}")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    import torch
    from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLPipeline
    from PIL import Image

    if not torch.cuda.is_available():
        raise RuntimeError("SDXL_CUDA_UNAVAILABLE")
    pipe = StableDiffusionXLPipeline.from_pretrained(model_dir, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
    pipe.to("cuda")
    pipe.enable_vae_tiling()
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
            torch.cuda.reset_peak_memory_stats()
            pace = float(req.get("pace", 0.2))
            max_temp = int(req.get("max_temp", 82))
            resume_below = int(req.get("resume_below", 78))

            def pace_step(_pipe, _step, _t, kwargs):
                torch.cuda.synchronize()
                time.sleep(pace)
                cool_down(max_temp, resume_below)
                return kwargs

            image = pipe(
                prompt=req["prompt"],
                prompt_2=req.get("prompt_2") or req["prompt"],
                negative_prompt=req.get("negative", ""),
                width=int(req.get("width", 1344)),
                height=int(req.get("height", 768)),
                num_inference_steps=int(req.get("steps", 30)),
                guidance_scale=float(req.get("guidance", 6.0)),
                generator=torch.Generator(device="cpu").manual_seed(int(req.get("seed", 1234))),
                callback_on_step_end=pace_step,
            ).images[0]
            size = (int(req.get("final_width", 1920)), int(req.get("final_height", 1080)))
            if image.size != size:
                image = image.resize(size, Image.LANCZOS)
            out = Path(req["out"])
            tmp = out.with_suffix(".tmp.png")
            image.save(tmp)
            os.replace(tmp, out)
            reply({"id": req.get("id"), "ok": True, "seconds": round(time.monotonic() - t0, 1), "peak_vram_gb": round(torch.cuda.max_memory_allocated() / 1024**3, 2)})
        except Exception as exc:  # report and keep serving the next request
            reply({"id": req.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
