"""Atölye V3 — depth parallax trial (owner, 5 Nov 2026: "1. maddeyi dene"; docs/research/2026-11-05-ucretsiz-ai-video-*).

The research found the studio's camera gap ("yakın plan, zoom, pan az") could be met by a 2.5D move: a relative depth
map from Depth Anything V2 Small (Apache-2.0, 99 MB) and a camera move in which near things travel further than far
ones. This trial renders, for every still, the same move twice — flat (today's zoom/pan) and with depth — so the two
can be watched side by side. A portrait still gets a vertical 1080x1920 clip (a Short), a landscape one 1920x1080.

Owner rule (PC health): everything runs on the processor with a bounded thread count; the card is not used at all.
Nothing is downloaded (HF offline, local snapshot only); files are written only into --out.

Production (owner, 6 Nov 2026: Wan was too heavy — "bizim sistemimizde yok mu böyle birşey, ona entegre edelim"): with
`--harita <jobs.json>` it only writes each period image's displacement map, which the renderer moves the picture by
(src/lib/v3/render/DepthMaps.ts → remotion-v3 DepthFilter). One line of JSON per image on stdout.

  python derinlik_parallax.py --model <snapshot dir> --out <dir> [--ffmpeg ffmpeg] [--saniye 6] [--fps 30] <image> ...
  python derinlik_parallax.py --model <snapshot dir> --harita <jobs.json>
      jobs.json: [{"kaynak": <image>, "cikti": <png>, "mod": "kapla" | "sigdir", "en": <px>, "boy": <px>}, ...]
"""
import argparse
import json
import math
import os
import subprocess
import time
from pathlib import Path

# Before torch loads: no hub access, and a processor share that leaves the PC usable.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
THREADS = 8

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from PIL import Image  # noqa: E402

torch.set_num_threads(THREADS)

# The move, in grid units (the frame is 2 wide): a slow push-in and a sideways drift, eased in and out.
ZOOM_START, ZOOM_END = 1.06, 1.14
# Sideways travel of the nearest thing against the focus plane, and the extra scale near things get on the push-in.
PARALLAX, NEAR_SCALE = 0.06, 0.06
# The plane that stays put (0 = farthest, 1 = nearest): the background drifts a little against the move.
FOCUS = 0.35


def cover_crop(img, width, height):
    """The still cut to the frame's shape around its centre and resized to it."""
    w, h = img.size
    target = width / height
    if w / h > target:
        nw = round(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize((width, height), Image.LANCZOS)


def depth_map(model, processor, img, width, height, grow=7, blur=41):
    """Relative nearness 0..1 (1 = nearest) at the frame's size: robustly normalised, near edges grown, smoothed.

    Thin lines against the sky (an engraving's rigging, 5 Nov 2026 trial) drag the sky with them where the depth
    changes sharply: a wider blur makes them travel with their surroundings instead of leaving ghost lines.
    """
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        pred = model(**inputs).predicted_depth  # relative inverse depth: larger is nearer
    d = F.interpolate(pred.unsqueeze(1), size=(height, width), mode="bicubic", align_corners=False)[0, 0]
    lo, hi = torch.quantile(d.flatten()[:: max(1, d.numel() // 200_000)], torch.tensor([0.02, 0.98]))
    d = ((d - lo) / (hi - lo + 1e-6)).clamp(0, 1)[None, None]
    # A near object's edge is grown a little so its outline moves with it instead of tearing into the background.
    d = F.max_pool2d(d, kernel_size=grow, stride=1, padding=grow // 2)
    for _ in range(3 if blur > 9 else 2):
        d = F.avg_pool2d(d, kernel_size=blur, stride=1, padding=blur // 2, count_include_pad=False)
    return d


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


# The displacement map's strength against the focus plane, and the share of each edge that fades to no shift.
GAIN = 0.8
EDGE = 0.06


def displacement_map(depth):
    """The depth as the renderer's displacement map (SVG feDisplacementMap): red = 0.5 + (nearness - FOCUS) * GAIN, so
    the focus plane stays put, near things travel with the move and far ones a little against it; it fades to 0.5 (no
    shift) at the picture's edges so no gap ever opens there. Green 0.5 (no vertical shift), blue = red."""
    d = depth[0, 0]
    h, w = d.shape

    def ramp(t):
        t = (torch.minimum(t, 1 - t) / EDGE).clamp(0, 1)
        return t * t * (3 - 2 * t)

    window = ramp(torch.linspace(0, 1, h))[:, None] * ramp(torch.linspace(0, 1, w))[None, :]
    r = (0.5 + (d - FOCUS) * GAIN * window).clamp(0, 1)
    rgb = torch.stack([r, torch.full_like(r, 0.5), r], dim=-1)
    return Image.fromarray((rgb * 255).round().to(torch.uint8).numpy())


def odd(n):
    return n if n % 2 else n + 1


def make_maps(job_file, model, processor, grow, blur):
    """Each job's displacement map: `kapla` = cut to the frame's shape (a background drawn with object-fit cover), `sigdir`
    = the whole picture (a cut-in drawn with contain); `en` is the frame's width (kapla) or the longer side (sigdir). The
    smoothing scales with the size (7/41 were tuned at 1920 px)."""
    jobs = json.loads(Path(job_file).read_text(encoding="utf-8"))
    for j in jobs:
        t = time.monotonic()
        try:
            img = Image.open(j["kaynak"]).convert("RGB")
            if j["mod"] == "kapla":
                w, h = int(j["en"]), int(j["boy"])
                still = cover_crop(img, w, h)
            else:
                s = int(j["en"]) / max(img.size)
                w, h = max(2, round(img.width * s)), max(2, round(img.height * s))
                still = img.resize((w, h), Image.LANCZOS)
            k = max(w, h) / 1920
            depth = depth_map(model, processor, still, w, h, odd(max(3, round(grow * k))), odd(max(5, round(blur * k))))
            out = Path(j["cikti"])
            out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_name(f"{out.stem}.tmp.png")
            displacement_map(depth).save(tmp)
            os.replace(tmp, out)
            print(json.dumps({"cikti": j["cikti"], "ok": True, "sn": round(time.monotonic() - t, 2), "boyut": f"{w}x{h}"}), flush=True)
        except Exception as e:  # one bad picture never stops the others
            print(json.dumps({"cikti": j.get("cikti"), "ok": False, "hata": f"{type(e).__name__}: {str(e)[:200]}"}), flush=True)


def render(frame, depth, out, ffmpeg, seconds, fps, flat):
    """One clip: every output pixel looks up where it came from (a few fixed-point steps through the depth)."""
    _, _, h, w = frame.shape
    n = round(seconds * fps)
    ys, xs = torch.meshgrid(torch.linspace(-1, 1, h), torch.linspace(-1, 1, w), indexing="ij")
    u = torch.stack([xs, ys], dim=-1)[None]  # 1,h,w,2 (x, y)
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE,
    )
    try:
        for i in range(n):
            e = ease(i / (n - 1))
            zoom = ZOOM_START + (ZOOM_END - ZOOM_START) * e
            cam = -1 + 2 * e  # left to right
            if flat:
                # Today's move: the whole picture as one plane at middle depth.
                rel = torch.full_like(u[..., :1], 0.5 - FOCUS)
                s = (u - torch.tensor([cam * PARALLAX * (0.5 - FOCUS), 0.0])) / (zoom * (1 + NEAR_SCALE * rel))
            else:
                s = u / zoom
                for _ in range(4):
                    d = F.grid_sample(depth, s, mode="bilinear", padding_mode="border", align_corners=False)[0, 0][None, ..., None]
                    rel = d - FOCUS
                    shift = torch.cat([cam * PARALLAX * rel, torch.zeros_like(rel)], dim=-1)
                    s = (u - shift) / (zoom * (1 + NEAR_SCALE * rel))
            img = F.grid_sample(frame, s, mode="bilinear", padding_mode="border", align_corners=False)
            proc.stdin.write((img[0].permute(1, 2, 0).clamp(0, 1) * 255).round().to(torch.uint8).numpy().tobytes())
    finally:
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed for {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out")
    ap.add_argument("--harita", help="jobs.json: write displacement maps only (production)")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--saniye", type=float, default=6.0)
    ap.add_argument("--fps", type=int, default=30)
    # Depth smoothing (odd kernels, pixels): how far a near edge grows, and the blur's width. 15/9 left ghost rigging
    # lines in the sky of the Zanzibar engraving on 5 Nov 2026; 7/41 removed them and kept the painting's depth.
    ap.add_argument("--genislet", type=int, default=7)
    ap.add_argument("--bulanik", type=int, default=41)
    ap.add_argument("--ek", default="", help="suffix for the clip names (a second variant beside the first)")
    ap.add_argument("images", nargs="*")
    a = ap.parse_args()

    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    model_dir = Path(a.model).resolve()
    t0 = time.monotonic()
    processor = AutoImageProcessor.from_pretrained(model_dir, local_files_only=True)
    model = AutoModelForDepthEstimation.from_pretrained(model_dir, local_files_only=True).eval()
    if a.harita:
        make_maps(a.harita, model, processor, a.genislet, a.bulanik)
        return
    if not a.out or not a.images:
        ap.error("--out and images are needed without --harita")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"model": str(model_dir), "device": "cpu", "threads": THREADS, "load_seconds": round(time.monotonic() - t0, 1), "clips": []}

    for src in a.images:
        src = Path(src)
        img = Image.open(src).convert("RGB")
        width, height = (1080, 1920) if img.height > img.width else (1920, 1080)
        still = cover_crop(img, width, height)
        t = time.monotonic()
        depth = depth_map(model, processor, still, width, height, a.genislet, a.bulanik)
        depth_s = round(time.monotonic() - t, 1)
        Image.fromarray((depth[0, 0].numpy() * 255).astype(np.uint8)).save(out / f"{src.stem}-derinlik{a.ek}.png")
        frame = torch.from_numpy(np.asarray(still, dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
        clip = {"kaynak": str(src), "boyut": f"{width}x{height}", "genislet": a.genislet, "bulanik": a.bulanik, "derinlik_sn": depth_s}
        # The flat clip does not depend on the depth: a second variant renders only the depth clip.
        for flat, name in ((True, "duz"), (False, "derinlikli")) if not a.ek else ((False, "derinlikli"),):
            t = time.monotonic()
            render(frame, depth, out / f"{src.stem}-{name}{a.ek}.mp4", a.ffmpeg, a.saniye, a.fps, flat)
            clip[f"{name}_sn"] = round(time.monotonic() - t, 1)
        report["clips"].append(clip)
        print(json.dumps(clip, ensure_ascii=False), flush=True)
    (out / f"rapor{a.ek}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
