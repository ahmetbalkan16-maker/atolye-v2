"""Atölye V3 — Wan 2.2 TI2V-5B image-to-video trial (owner, 6 Nov 2026: "indirme bittiyse denemeye başla").

TRIAL ONLY: it animates a few of the studio's own backdrops into short clips beside the depth-parallax trial's, and
writes the clips and a report into `--out`. Nothing here is wired into a production.

Memory plan for this PC (RTX A2000 12 GB, 31.7 GB RAM), as the download's notes planned it:
- the weights are the ones `wan22_indir.py` checked (sizes against its model-manifest.json; offline, nothing fetched);
- umt5-xxl (11 GB) encodes every prompt first, on the CPU, and is freed before anything else loads;
- the transformer (Comfy fp16 single file → bf16) runs with block-level group offload: its blocks wait in RAM and come
  to the card a few at a time; Wan 2.2's own VAE (fp32, tiled) sits on the card;
- owner's GPU rule (shared 85 °C stop): the run starts below 78 °C and, between denoising steps, rests at 82 °C until the
  card is back under 78 (as SDXL does); Ollama's loaded models are unloaded first so the two never share the card.

  python.exe -I wan22_dene.py --out <dir> --plan <plan.json> [--kare 73] [--adim 40] [--en 832] [--boy 480]
  plan.json: [{"ad": "s2-pazarlik", "kaynak": "<image>", "istem": "<English prompt>"}, ...]
"""
import argparse
import gc
import hashlib
import json
import os
import subprocess
import sys
import time
import types
import urllib.request
from pathlib import Path

# `python -I` ignores PYTHONIOENCODING: the log stays UTF-8 (Turkish lines) whatever the console's code page.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(os.environ.get("ATOLYE_V3_WAN22_DIR", r"D:\URETIM\Atolye\v3-tools\models\wan22-ti2v-5b"))
TRANSFORMER = "split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"
NEGATIVE = (
    "photorealistic, 3d render, blurry, low quality, jpeg artifacts, distorted faces, extra limbs, deformed hands, "
    "flicker, morphing, melting, text, watermark, subtitles, new characters appearing, scene change, cut"
)
GPU_REST_C = 82
GPU_RESUME_C = 78


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def gpu_temperature():
    """GPU temperature in °C, or None when nvidia-smi cannot be read (an unreadable sensor never blocks)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def cool_down(limit, resume, max_wait_s=900):
    """At or above `limit` the card rests until it is below `resume` (or the wait runs out). Returns seconds rested."""
    t = gpu_temperature()
    if t is None or t < limit:
        return 0.0
    started = time.monotonic()
    while t is not None and t >= resume and time.monotonic() - started < max_wait_s:
        time.sleep(3)
        t = gpu_temperature()
    return time.monotonic() - started


def unload_ollama(base="http://127.0.0.1:11434"):
    """Ollama's loaded models leave the card (keep_alive 0); an Ollama that does not answer is simply not running."""
    try:
        with urllib.request.urlopen(f"{base}/api/ps", timeout=5) as r:
            models = [m["name"] for m in json.load(r).get("models", [])]
    except Exception:
        return []
    for name in models:
        body = json.dumps({"model": name, "keep_alive": 0}).encode()
        try:
            urllib.request.urlopen(urllib.request.Request(f"{base}/api/generate", data=body, headers={"content-type": "application/json"}), timeout=60).read()
        except Exception:
            pass
    return models


def check_weights():
    """Every file the downloader recorded is there with its size (the SHA-256 was checked when it finished)."""
    manifest = json.loads((ROOT / "model-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("model") != "Wan2.2-TI2V-5B":
        raise RuntimeError("WAN22_MODEL_UNREVIEWED")
    for record in manifest["files"]:
        f = (ROOT / record["file"]).resolve()
        if not f.is_relative_to(ROOT.resolve()) or not f.is_file() or f.stat().st_size != record["bytes"]:
            raise RuntimeError(f"WAN22_MODEL_CHANGED: {record['file']}")
    return len(manifest["files"])


def free_ram_gb():
    """Free physical memory (Windows), or None when it cannot be read."""
    import ctypes

    class MemoryStatus(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    try:
        s = MemoryStatus()
        s.dwLength = ctypes.sizeof(MemoryStatus)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
        return s.ullAvailPhys / 2**30
    except Exception:
        return None


def need_ram(gb, what):
    """Owner rule (5 Nov 2026: "pc sağlığına her zaman dikkat edilecek"; 6 Nov: "bellek %99 oluyor"): a step that loads
    `gb` of weights starts only with that much RAM free plus 4 GB for the rest of the PC, else the trial stops."""
    free = free_ram_gb()
    if free is not None and free < gb + 4:
        raise RuntimeError(f"WAN22_RAM_AZ: {what} için {gb + 4:.0f} GB boş RAM gerekir, {free:.1f} GB var; deneme durdu")
    return free


SHARDS = ROOT / "transformer"
SHARD_GB = 2.0


def prepare_transformer():
    """The Comfy fp16 single file as Diffusers bf16 shards beside its config, once, one tensor at a time.

    Loading the single file kept its 10 GB and the converted 10 GB copy in RAM together (6 Nov 2026: the PC hit 99 %
    memory). Diffusers' own conversion only renames the keys, so here each tensor is read, renamed, cast and written
    alone; later runs load the shards one by one. Returns the shard count."""
    import torch
    from diffusers.loaders.single_file_utils import convert_wan_transformer_to_diffusers
    from safetensors import safe_open
    from safetensors.torch import save_file

    index = SHARDS / "diffusion_pytorch_model.safetensors.index.json"
    if index.is_file():
        return len(set(json.loads(index.read_text(encoding="utf-8"))["weight_map"].values()))
    src = ROOT / TRANSFORMER
    with safe_open(str(src), framework="pt") as f:
        keys = list(f.keys())
        # The converter renames a dict's keys and moves its values: given each key as its own value, it says where it goes.
        renamed = convert_wan_transformer_to_diffusers({k: k for k in keys})
        if len(renamed) != len(keys):
            raise RuntimeError(f"WAN22_CONVERT: {len(keys)} anahtar → {len(renamed)}")
        # Each shard is written as soon as it is full and dropped (its final name needs the count, given at the end).
        written, current, size, total = [], {}, 0, 0

        def flush():
            part = SHARDS / f"parca-{len(written) + 1:05d}.tmp"
            save_file(current, str(part), metadata={"format": "pt"})
            written.append((part, list(current)))

        for new_key, old_key in renamed.items():
            t = f.get_tensor(old_key).to(torch.bfloat16).contiguous()
            current[new_key] = t
            size += t.numel() * 2
            total += t.numel() * 2
            if size >= SHARD_GB * 2**30:
                flush()
                current, size = {}, 0
                gc.collect()
        if current:
            flush()
            current = {}
    weight_map = {}
    for i, (part, names) in enumerate(written, 1):
        name = f"diffusion_pytorch_model-{i:05d}-of-{len(written):05d}.safetensors"
        os.replace(part, SHARDS / name)
        weight_map.update({k: name for k in names})
    tmp = index.with_suffix(".tmp")
    tmp.write_text(json.dumps({"metadata": {"total_size": total, "kaynak": TRANSFORMER}, "weight_map": weight_map}, indent=1), encoding="utf-8")
    os.replace(tmp, index)
    return len(written)


def fit(img, width, height):
    """The image cropped to the clip's shape around its centre, then resized (nothing stretched)."""
    from PIL import Image

    img = img.convert("RGB")
    want = width / height
    w, h = img.size
    if w / h > want:
        nw = round(h * want)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / want)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize((width, height), Image.LANCZOS)


def write_mp4(frames, path, fps, ffmpeg):
    """float frames (F, H, W, 3) in 0..1 → H.264 mp4 through ffmpeg's stdin."""
    import numpy as np

    f, h, w, _ = frames.shape
    data = (np.clip(frames, 0, 1) * 255).round().astype(np.uint8)
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart", str(path)]
    p = subprocess.run(cmd, input=data.tobytes(), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg: {p.stderr.decode('utf-8', 'replace')[-300:]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--kare", type=int, default=73, help="frames (4k+1; 73 = about 3 s at 24 fps)")
    ap.add_argument("--adim", type=int, default=40, help="denoising steps")
    ap.add_argument("--en", type=int, default=832, help="width of a landscape clip (a portrait one swaps the two)")
    ap.add_argument("--boy", type=int, default=480)
    ap.add_argument("--rehber", type=float, default=5.0, help="guidance scale")
    ap.add_argument("--tohum", type=int, default=42)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--blok", type=int, default=2, help="transformer blocks on the card at a time")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
    report = {"model": "Wan2.2-TI2V-5B (Comfy fp16 → bf16)", "kare": a.kare, "adim": a.adim, "rehber": a.rehber, "tohum": a.tohum, "fps": a.fps, "klipler": []}
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    report["dosya_sayisi"] = check_weights()
    report["ollama_bosaltilan"] = unload_ollama()
    log(f"ağırlıklar tamam ({report['dosya_sayisi']} dosya); Ollama boşaltıldı: {report['ollama_bosaltilan'] or 'yüklü model yoktu'}")

    import torch
    import diffusers.pipelines.wan.pipeline_wan_i2v as wan_i2v
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanImageToVideoPipeline, WanTransformer3DModel
    from PIL import Image
    from transformers import AutoTokenizer, UMT5EncoderModel

    # diffusers cleans prompts with ftfy (mojibake repair), which gen-venv does not have; the trial's prompts are plain
    # ASCII, so there is nothing to repair and no package is added for it.
    if not hasattr(wan_i2v, "ftfy"):
        bad = [c["ad"] for c in plan if not (c["istem"].isascii() and NEGATIVE.isascii())]
        if bad:
            raise RuntimeError(f"WAN22_PROMPT_NOT_ASCII: {bad}")
        wan_i2v.ftfy = types.SimpleNamespace(fix_text=lambda s: s)
    torch.set_num_threads(max(1, (os.cpu_count() or 8) - 2))

    # 1. Every prompt through umt5 on the CPU, then the encoder is gone. bf16 on this CPU is slow (6 prompts took 10
    # minutes on 6 Nov 2026), so the embeddings are kept beside the clips, keyed by the prompts, for the next run.
    t0 = time.monotonic()
    key = hashlib.sha256(json.dumps([[c["istem"] for c in plan], NEGATIVE]).encode()).hexdigest()[:16]
    cache = out / f"istem-gomme-{key}.pt"
    if cache.is_file():
        saved = torch.load(cache)
        prompt_embeds, negative_embeds = saved["olumlu"], saved["olumsuz"]
        log("istemler önceki çalışmadan okundu")
    else:
        from diffusers.hooks import apply_group_offloading

        tokenizer = AutoTokenizer.from_pretrained(ROOT / "tokenizer", local_files_only=True)

        def encode(on_card):
            encoder = UMT5EncoderModel.from_pretrained(ROOT / "text_encoder", torch_dtype=torch.bfloat16, local_files_only=True)
            encoder.eval()
            if on_card:
                # Its blocks visit the card four at a time (11 GB of weights never sit there together).
                apply_group_offloading(encoder, onload_device=torch.device("cuda"), offload_device=torch.device("cpu"), offload_type="block_level", num_blocks_per_group=4)
            text_pipe = WanImageToVideoPipeline(tokenizer=tokenizer, text_encoder=encoder, vae=None, scheduler=None, transformer=None, expand_timesteps=True)
            try:
                with torch.inference_mode():
                    pe, ne = text_pipe.encode_prompt(
                        prompt=[c["istem"] for c in plan], negative_prompt=[NEGATIVE] * len(plan), do_classifier_free_guidance=True,
                        max_sequence_length=512, device=torch.device("cuda" if on_card else "cpu"), dtype=torch.bfloat16)
                return pe.cpu(), ne.cpu()
            finally:
                del text_pipe, encoder
                gc.collect()
                torch.cuda.empty_cache()

        need_ram(12, "metin kodlayıcı (11 GB)")
        try:
            cool_down(GPU_RESUME_C, GPU_RESUME_C)
            prompt_embeds, negative_embeds = encode(True)
            report["metin_yer"] = "ekran kartı"
        except Exception as e:
            log(f"istemler kartta kodlanamadı ({type(e).__name__}: {str(e)[:120]}); işlemcide kodlanıyor")
            prompt_embeds, negative_embeds = encode(False)
            report["metin_yer"] = "işlemci"
        torch.save({"olumlu": prompt_embeds, "olumsuz": negative_embeds}, cache)
        del tokenizer
    report["metin_sn"] = round(time.monotonic() - t0, 1)
    log(f"istemler hazır ({len(plan)} klip, {report['metin_sn']} sn, {report.get('metin_yer', 'önceki çalışmadan')}); umt5 bırakıldı")

    # 2. The VAE on the card, the transformer's blocks a few at a time.
    t0 = time.monotonic()
    cuda = torch.device("cuda")
    # No tiling: Wan 2.2's VAE patchifies its input, and diffusers 0.35's tiled encode fed it the raw 3 channels
    # (6 Nov 2026: "expected 12 channels, but got 3"); at 480p the whole frame fits the card.
    vae = AutoencoderKLWan.from_pretrained(ROOT / "vae", torch_dtype=torch.float32, local_files_only=True).to(cuda)
    need_ram(4, "dönüştürme")
    t1 = time.monotonic()
    shards = prepare_transformer()
    report["parca"] = shards
    log(f"dönüştürücü bf16 parçaları hazır ({shards} parça, {time.monotonic() - t1:.0f} sn)")
    report["ram_once_gb"] = round(need_ram(11, "dönüştürücü (10 GB)") or 0, 1)
    transformer = WanTransformer3DModel.from_pretrained(SHARDS, torch_dtype=torch.bfloat16, local_files_only=True, low_cpu_mem_usage=True)
    # Without a CUDA stream: the streamed offload pins its RAM copy, and pinning failed on this Windows PC with "CUDA
    # error: resource already mapped" (6 Nov 2026); the plain one moves each group as it is needed — a little slower.
    transformer.enable_group_offload(onload_device=cuda, offload_device=torch.device("cpu"), offload_type="block_level", num_blocks_per_group=a.blok, use_stream=False)
    scheduler = UniPCMultistepScheduler.from_pretrained(ROOT / "scheduler", local_files_only=True)
    pipe = WanImageToVideoPipeline(tokenizer=None, text_encoder=None, vae=vae, scheduler=scheduler, transformer=transformer, expand_timesteps=True)
    report["yukleme_sn"] = round(time.monotonic() - t0, 1)
    log(f"model yüklendi ({report['yukleme_sn']} sn)")

    for k, clip in enumerate(plan):
        src = Path(clip["kaynak"])
        img = Image.open(src)
        portrait = img.size[1] > img.size[0]
        width, height = (a.boy, a.en) if portrait else (a.en, a.boy)
        first = fit(img, width, height)
        first.save(out / f"{clip['ad']}-ilk-kare.png")
        rested = cool_down(GPU_RESUME_C, GPU_RESUME_C)
        temps = []
        state = {"dinlenme": rested, "son": time.monotonic()}

        def on_step(p, i, t, kwargs):
            now = time.monotonic()
            temp = gpu_temperature()
            temps.append(temp)
            state["dinlenme"] += cool_down(GPU_REST_C, GPU_RESUME_C)
            log(f"  {clip['ad']}: adım {i + 1}/{a.adim} ({now - state['son']:.1f} sn, GPU {temp} °C)")
            state["son"] = time.monotonic()
            return {}

        torch.cuda.reset_peak_memory_stats()
        t0 = time.monotonic()
        log(f"klip {k + 1}/{len(plan)}: {clip['ad']} ({width}x{height}, {a.kare} kare)")
        with torch.inference_mode():
            frames = pipe(
                image=first, prompt_embeds=prompt_embeds[k:k + 1], negative_prompt_embeds=negative_embeds[k:k + 1],
                height=height, width=width, num_frames=a.kare, num_inference_steps=a.adim, guidance_scale=a.rehber,
                generator=torch.Generator("cpu").manual_seed(a.tohum), output_type="np", callback_on_step_end=on_step,
            ).frames[0]
        seconds = time.monotonic() - t0
        mp4 = out / f"{clip['ad']}-wan22.mp4"
        write_mp4(frames, mp4, a.fps, a.ffmpeg)
        known = [x for x in temps if x is not None]
        entry = {"ad": clip["ad"], "kaynak": str(src), "istem": clip["istem"], "boyut": f"{width}x{height}", "saniye_video": round(a.kare / a.fps, 2),
                 "uretim_sn": round(seconds, 1), "dinlenme_sn": round(state["dinlenme"], 1), "en_yuksek_gpu_c": max(known) if known else None,
                 "en_yuksek_vram_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2), "dosya": str(mp4)}
        report["klipler"].append(entry)
        (out / "rapor.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"klip hazır: {mp4.name} ({seconds:.0f} sn, en yüksek {entry['en_yuksek_gpu_c']} °C, VRAM {entry['en_yuksek_vram_gb']} GB)")
        del frames
        gc.collect()
        torch.cuda.empty_cache()
    log("deneme bitti")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"HATA: {type(e).__name__}: {e}")
        raise
