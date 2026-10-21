"""Atölye V3 — MOSS-SoundEffect v2 sound designer side process (local, offline, 0 $).

Loads `<ATOLYE_V3_MOSS_ROOT>/checkpoints/MOSS-SoundEffect-v2.0` once. The 12 GB card cannot hold all three parts in
bf16 (DiT 5.7 GB + Qwen3 text encoder 4.1 GB + DAC VAE 1.5 GB), so the text encoder stays on the CPU in float32 (one
pass per prompt) and only the DiT and the VAE go to the card. Then reads one JSON request per stdin line:

  {"id": "...", "prompt": "...", "seconds": 3.0, "seed": 1234, "out": "<wav>", "max_temp": 73}
  -> {"id": "...", "ok": true, "seconds": 18.2, "peak_vram_gb": 7.6}

Nothing is downloaded (HF offline); torch.compile is off (no Triton on Windows). Before every sound the card rests
while it is at or above `max_temp` (73 °C, the owner's limit). License: Apache-2.0 (MOSS-SoundEffect v2).
"""
import gc
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def gpu_temperature():
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
    root = Path(os.environ["ATOLYE_V3_MOSS_ROOT"]).resolve()
    model_dir = root / "checkpoints" / "MOSS-SoundEffect-v2.0"
    for part in ("transformer", "text_encoder", "vae", "tokenizer"):
        if not (model_dir / part).is_dir():
            raise RuntimeError(f"MOSS_MODEL_MISSING: {part}")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from model_manifest import verify

    verify(model_dir, "OpenMOSS-Team/MOSS-SoundEffect-v2.0")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TORCHDYNAMO_DISABLE"] = "1"
    sys.path.insert(0, str(root))
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import torch
    from moss_soundeffect_v2 import MossSoundEffectPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("MOSS_CUDA_UNAVAILABLE")
    # RAM: the DiT's 5.4 GB float32 weight file is read straight onto the card (MOSS builds the model on the CPU and then
    # copies these weights in; reading them into RAM as well made a ~16 GB peak that left 2 GB free). Precision unchanged.
    from moss_soundeffect_v2.diffsynth.pipelines import wan_audio

    read_weights = wan_audio.load_file
    wan_audio.load_file = lambda path, device="cpu": read_weights(path, device="cuda")
    pipe = MossSoundEffectPipeline.from_pretrained(str(model_dir), torch_dtype=torch.bfloat16, device="cpu")
    wan_audio.load_file = read_weights
    torch.cuda.empty_cache()
    engine = pipe.engine
    # RAM peak (the first real test left 1.9 GB free): the DiT and the VAE go to the card at once, freeing their CPU
    # copies; the text encoder stays bf16 on the CPU (widening it to float32 cost another ~4 GB of RAM).
    engine.dit.to("cuda")
    engine.vae.to("cuda")
    gc.collect()
    engine.device = "cuda"
    encode = engine.prompter.encode_prompt

    def encode_on_cpu(prompt, positive=True, device="cuda"):
        with torch.autocast("cpu", enabled=False):
            emb = encode(prompt, positive=positive, device="cpu")
        return emb.to(device=device, dtype=torch.bfloat16)

    engine.prompter.encode_prompt = encode_on_cpu
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
            limit = int(req.get("max_temp", 73))
            cool_down(limit)

            def cooling_steps(iterable, **_):
                # Owner rule DURING a sound too (the first test reached 76 °C over 60 steps): every third step the card
                # rests while it is at or above the limit.
                for i, item in enumerate(iterable):
                    if i % 3 == 0:
                        cool_down(limit)
                    yield item

            t0 = time.monotonic()
            torch.cuda.reset_peak_memory_stats()
            sys.stdout = sys.stderr
            try:
                audio = pipe(prompt=str(req["prompt"]), seconds=float(req["seconds"]), num_inference_steps=int(req.get("steps", 60)), cfg_scale=4.0, seed=int(req.get("seed", 0)), max_inference_seconds=int(req.get("window", 30)), progress_bar_cmd=cooling_steps)
                pipe.save_audio(audio, req["out"])
            finally:
                sys.stdout = real_stdout
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
