"""One offline background candidate, using installed SDXL data and explicit fixed themes.
The caller supervises this owned process with the existing PC health gate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

THEMES = {
    "OTTOMAN": "Ottoman imperial palace reception room, pointed arch windows overlooking Istanbul domes and minarets, ornate blue and white floral Iznik tile wall band, cream marble columns with golden trim, large red carpet, ornate empty red and gold throne on left, polished stone floor",
    "BYZANTINE": "Byzantine imperial palace reception room, domed vault, purple and gold tapestry, gold geometric mosaic wall decorations, marble columns, arched windows overlooking Constantinople, purple carpet, ornate empty purple and gold throne on left",
    "ROMAN": "ancient Roman imperial palace open atrium, fluted white marble columns, Roman red banners with laurel wreath designs, distant classical temples and cypress trees, geometric marble floor, ornate empty throne on left",
    "EGYPTIAN": "ancient Egyptian royal palace hall, massive sandstone columns with lotus capitals, geometric blue and gold wall decoration, rectangular doorways overlooking pyramids and palm trees, ornate empty blue and gold throne on left, warm sunlight",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--theme", choices=THEMES, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seed", type=int, default=1977)
    parser.add_argument("--kind", choices=["background", "character"], default="background")
    parser.add_argument("--role", choices=["RULER", "ADVISOR", "GUARD"], default="RULER")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    runtime = root / "bin" / "ayas-local-visual"
    output = Path(args.output).resolve()
    # Owned generated cache only, never an arbitrary owner file.
    candidate_root = runtime / "candidates"
    candidate_root.mkdir(parents=True, exist_ok=True)
    if not output.is_relative_to(candidate_root.resolve()) or output.suffix.lower() != ".png" or output.exists():
        raise RuntimeError("LOCAL_VISUAL_OUTPUT_REFUSED")
    manifest = json.loads((runtime / "model-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("repository") != "stabilityai/stable-diffusion-xl-base-1.0" or manifest.get("dataOnly") is not True:
        raise RuntimeError("LOCAL_VISUAL_MODEL_UNREVIEWED")
    for record in manifest["files"]:
        file = runtime / "model" / record["file"]
        if not file.resolve().is_relative_to((runtime / "model").resolve()) or hashlib.file_digest(file.open("rb"), "sha256").hexdigest() != record["sha256"]:
            raise RuntimeError("LOCAL_VISUAL_MODEL_CHANGED")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import torch
    from diffusers import StableDiffusionXLPipeline
    if not torch.cuda.is_available():
        raise RuntimeError("LOCAL_VISUAL_CUDA_UNAVAILABLE")
    torch.set_num_threads(4)
    torch.cuda.set_per_process_memory_fraction(0.8)
    started = time.monotonic()
    pipe = StableDiffusionXLPipeline.from_pretrained(runtime / "model", torch_dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True)
    pipe.enable_model_cpu_offload()
    pipe.enable_vae_slicing()
    pipe.enable_vae_tiling()
    if args.kind == "character":
        costumes = {
            "OTTOMAN": {"RULER": "Ottoman sultan, ornate white wrapped turban with a ruby brooch, long red caftan richly embroidered with delicate gold floral patterns, golden belt", "ADVISOR": "Ottoman vizier scholar, white wrapped turban, round black glasses, long dark teal robe with delicate golden embroidered trim", "GUARD": "Ottoman palace guard, white wrapped military headcloth, long dark red and black coat, golden belt, solemn expression"},
            "BYZANTINE": {"RULER": "Byzantine emperor, golden jeweled domed crown, elaborate purple and gold imperial robe, rich cape", "ADVISOR": "Byzantine scholar advisor, dark hood, round glasses, long black robe with gold trim", "GUARD": "Byzantine guard, silver helmet with red plume, silver armor, red and gold tunic"},
            "ROMAN": {"RULER": "Roman emperor, green laurel wreath, white tunic, richly detailed golden armor, flowing red cape", "ADVISOR": "Roman advisor, short brown hair, round glasses, long white toga with red trim", "GUARD": "Roman legionary, silver helmet with red crest, segmented silver armor, red tunic"},
            "EGYPTIAN": {"RULER": "Egyptian pharaoh, blue and gold striped nemes headdress, elaborate gold and blue collar, white linen kilt with golden belt", "ADVISOR": "ancient Egyptian scholar advisor, black bob hairstyle with blue and gold headband, round glasses, long white linen robe, blue and gold collar", "GUARD": "ancient Egyptian guard, black bob hair and blue and gold headband, white linen tunic and kilt, blue and gold collar"},
        }
        prompt = "One single full-body cartoon character sprite, professional cute 2D educational animation character design, friendly stylized stick figure, large pure white round circular face, two simple black oval eyes, simple expressive smiling mouth, tiny black eyebrows, no nose, thin limbs, white cartoon gloves, large white cartoon shoes, clean confident black ink outlines, beautiful detailed costume, subtle cel shading, " + costumes[args.theme][args.role] + ", entire body visible from headdress to shoes, standing front view, arms slightly away from body, both hands visible, character centered with empty margin, isolated on perfectly flat solid bright magenta pink background, no environment, no objects, no weapon, no writing"
        negative = "photorealistic, realistic human face, nose, beard, skin color, photograph, 3d, background scene, palace, scenery, floor, shadow on background, gradient background, multiple people, multiple characters, duplicate person, cropped feet, cropped head, text, letters, logo, watermark, blurry, deformed hands, extra limbs"
        width, height = 1024, 1024
    else:
        prompt = "Professional 2D educational cartoon animation background, hand drawn clean outlined illustration, detailed architecture, warm pastel colors, elegant soft lighting and shadows, polished high quality cartoon, widescreen composition, " + THEMES[args.theme] + ", empty room, no people, no characters, clear open foreground for animated actors, no text, no letters, no logo"
        negative = "people, person, human, character, face, crowd, text, letters, watermark, logo, photorealistic, photograph, blurry, low quality, deformed, distorted perspective, clutter, modern technology"
        width, height = 1024, 576
    image = pipe(prompt=prompt, negative_prompt=negative, width=width, height=height, num_inference_steps=24, guidance_scale=7.0, generator=torch.Generator(device="cpu").manual_seed(args.seed)).images[0]
    image.save(output)
    receipt = {"status": "CANDIDATE", "theme": args.theme, "kind": args.kind, "role": args.role if args.kind == "character" else None, "modelRevision": manifest["revision"], "seed": args.seed, "width": width, "height": height, "seconds": round(time.monotonic() - started, 2), "peakVramGB": round(torch.cuda.max_memory_allocated() / 1024**3, 3), "sha256": hashlib.file_digest(output.open("rb"), "sha256").hexdigest(), "bytes": output.stat().st_size, "paidCalls": 0, "offlineInference": True, "qualityAccepted": False}
    output.with_suffix(".json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt))

if __name__ == "__main__":
    main()
