"""Atölye V3 — CLIP ranker side process (local, offline, CPU, 0 $).

Loads LAION CLIP ViT-B/32 (MIT, safetensors only) from `ATOLYE_V3_CLIP_MODEL` once, on the CPU (small and fast enough;
it never competes with the vision judge for the card), then reads one JSON request per stdin line:

  {"id": "...", "text": "Roman Senate painting. Roman Senate, Rome.", "images": ["<jpg>", ...]}
  -> {"id": "...", "ok": true, "scores": [0.31, 0.18, null, ...]}

A score is the cosine similarity of the image to the text; an image that cannot be read scores null. The folder is
checked against its manifest before loading (scripts/v3/model_manifest.py). License: MIT (LAION CLIP).
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
    model_dir = Path(os.environ["ATOLYE_V3_CLIP_MODEL"]).resolve()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from model_manifest import verify

    verify(model_dir, "laion/CLIP-ViT-B-32-laion2B-s34B-b79K")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor

    model = CLIPModel.from_pretrained(str(model_dir), use_safetensors=True).eval()
    processor = CLIPProcessor.from_pretrained(str(model_dir))
    sys.stdout = real_stdout
    reply({"ready": True, "device": "cpu", "load_seconds": round(time.monotonic() - started, 1)})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            if req.get("cmd") == "quit":
                break
            images, slots = [], []
            for i, p in enumerate(req["images"]):
                try:
                    images.append(Image.open(p).convert("RGB"))
                    slots.append(i)
                except Exception:
                    pass
            scores = [None] * len(req["images"])
            if images:
                with torch.no_grad():
                    inputs = processor(text=[str(req["text"])], images=images, return_tensors="pt", padding=True, truncation=True)
                    out = model(**inputs)
                    img = out.image_embeds / out.image_embeds.norm(dim=-1, keepdim=True)
                    txt = out.text_embeds / out.text_embeds.norm(dim=-1, keepdim=True)
                    sims = (img @ txt.T).squeeze(-1).tolist()
                for slot, s in zip(slots, sims):
                    scores[slot] = round(float(s), 4)
            reply({"id": req.get("id"), "ok": True, "scores": scores})
        except Exception as e:
            reply({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        reply({"ready": False, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
        raise
