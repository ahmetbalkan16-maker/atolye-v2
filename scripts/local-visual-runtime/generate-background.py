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
    "COURTYARD_OTTOMAN": "wide empty fifteenth century Ottoman courtyard square, tall warm stone masonry gate and walls, pointed arch windows, modest tiled roofs and distant domes, timber doors, olive trees, ornate shallow fountain on far left, warm afternoon light, detailed stone pavement in perspective, clear broad empty foreground floor",
    "FOREST": "wide empty woodland clearing, lush green layered forest, tall detailed trunks, foliage with dappled sunlight, soft hills in distance, quiet footpath, broad flat empty foreground ground, gentle storybook depth",
    "FOREST_AUTUMN": "wide empty autumn woodland clearing, orange russet and golden foliage, detailed dark tree trunks, distant soft hills, winding footpath, broad flat empty foreground ground with fallen leaves, golden light",
    "FOREST_WINTER": "wide empty winter woodland clearing, snowy branches and detailed bare tree trunks, blue grey distant hills, frosty footpath, broad flat empty foreground snow, soft cold daylight",
    "HARBOR_EARLY": "wide empty sixteenth century Mediterranean wooden harbor, distant wooden sailing ships with plain cream sails and no flags, warm stone warehouses with arched doors and tiled roofs, timber dock pillars and rope, quiet blue sea, clear broad empty stone quay foreground, warm light",
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
    parser.add_argument("--guide")
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
        prompt = "Full-length cute 2D cartoon mascot, big round white face, black oval eyes, happy smile, small body, visible white shoes, standing, isolated on solid magenta background. " + costumes[args.theme][args.role]
        prompt2 = "Full body character design, cute simple rounded cartoon " + costumes[args.theme][args.role] + ", white circular face, black eyes, slim body, colorful cel shaded clothing, bold black outlines, head and feet visible, centered on plain magenta background"
        negative = "portrait, close-up, cropped feet, large head filling frame, multiple characters, sprite sheet, contact sheet, monochrome, pencil sketch, grayscale, 3D, photograph, realistic face, scenery, pattern background, text, watermark, logo, extra limbs, blurry"
        width, height = 768, 1024
    else:
        new_environment = args.theme in {"COURTYARD_OTTOMAN", "FOREST", "FOREST_AUTUMN", "FOREST_WINTER", "HARBOR_EARLY"}
        setting_style = "rich layered scenery" if new_environment else "detailed architecture"
        empty_space = "open landscape" if new_environment else "empty room"
        prompt = "Professional 2D educational cartoon animation background, hand drawn clean outlined illustration, " + setting_style + ", warm pastel colors, elegant soft lighting and shadows, polished high quality cartoon, widescreen composition, " + THEMES[args.theme] + ", " + empty_space + ", no people, no characters, clear open foreground for animated actors, no text, no letters, no logo"
        negative = "people, person, human, character, face, crowd, text, letters, watermark, logo, photorealistic, photograph, blurry, low quality, deformed, distorted perspective, clutter, modern technology"
        width, height = 1024, 576
    # Leave idle time between CUDA steps instead of raising the machine's thermal
    # limits. The parent still owns the hard stop and checks the real sensors.
    def pace_step(_pipeline, _step, _timestep, callback_kwargs):
        torch.cuda.synchronize()
        time.sleep(2.0 if args.kind == "character" else 0.75)
        return callback_kwargs
    extra = {}
    if args.guide:
        guide = Path(args.guide).resolve()
        if args.kind != "character" or not guide.is_relative_to(candidate_root.resolve()) or guide.suffix != ".png" or not guide.is_file() or guide.stat().st_size > 2 * 1024**2:
            raise RuntimeError("LOCAL_VISUAL_GUIDE_REFUSED")
        from PIL import Image
        guide_image = Image.open(guide)
        if guide_image.size != (768, 1024) or guide_image.mode != "RGB":
            raise RuntimeError("LOCAL_VISUAL_GUIDE_SHAPE")
        from diffusers import StableDiffusionXLImg2ImgPipeline
        pipe = StableDiffusionXLImg2ImgPipeline(**pipe.components)
        pipe.enable_model_cpu_offload()
        extra = {"image": guide_image, "strength": 0.55}
        prompt = "Full body 2D cartoon Ottoman sultan, large white round face, black oval eyes, white turban, red kaftan with delicate gold floral embroidery, slim limbs, white gloves, white shoes, clean black outlines, magenta background" if args.theme == "OTTOMAN" and args.role == "RULER" else prompt
        prompt2 = prompt
    generated = pipe(prompt=prompt, prompt_2=prompt2 if args.kind == "character" else prompt, negative_prompt=negative, width=width, height=height, num_inference_steps=40 if args.guide else 24, guidance_scale=7.0, generator=torch.Generator(device="cpu").manual_seed(args.seed), callback_on_step_end=pace_step, output_type="latent" if args.kind == "character" else "pil", **extra).images
    if args.kind == "character":
        # The final large VAE decode caused a thermal spike even with paced
        # denoising. Decode this optional character on CPU, with four threads.
        # Removing only this model's offload hooks prevents a hidden CUDA move.
        from accelerate.hooks import remove_hook_from_module
        latents = generated.detach().to(device="cpu", dtype=torch.float32)
        pipe.maybe_free_model_hooks()
        remove_hook_from_module(pipe.vae, recurse=True)
        pipe.vae.to(device="cpu", dtype=torch.float32)
        if next(pipe.vae.parameters()).device.type != "cpu":
            raise RuntimeError("LOCAL_VISUAL_CPU_DECODE_UNCONFIRMED")
        with torch.inference_mode():
            decoded = pipe.vae.decode(latents / pipe.vae.config.scaling_factor, return_dict=False)[0]
        image = pipe.image_processor.postprocess(decoded, output_type="pil")[0]
    else:
        image = generated[0]
    image.save(output)
    receipt = {"status": "CANDIDATE", "theme": args.theme, "kind": args.kind, "role": args.role if args.kind == "character" else None, "guided": bool(args.guide), "modelRevision": manifest["revision"], "seed": args.seed, "width": width, "height": height, "seconds": round(time.monotonic() - started, 2), "decodeDevice": "cpu" if args.kind == "character" else "cuda", "peakVramGB": round(torch.cuda.max_memory_allocated() / 1024**3, 3), "sha256": hashlib.file_digest(output.open("rb"), "sha256").hexdigest(), "bytes": output.stat().st_size, "paidCalls": 0, "offlineInference": True, "qualityAccepted": False}
    output.with_suffix(".json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt))

if __name__ == "__main__":
    main()
