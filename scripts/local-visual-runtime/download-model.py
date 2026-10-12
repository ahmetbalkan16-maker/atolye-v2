"""Fetch only reviewed SDXL fp16 data files from the official, pinned repository.
No remote Python, pickle, token, alternate model or automatic installation.
"""
import hashlib
import json
import os
from pathlib import Path
import urllib.request
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "bin" / "ayas-local-visual" / "model"
REPO = "stabilityai/stable-diffusion-xl-base-1.0"
FILES = ["model_index.json", "scheduler/scheduler_config.json", "text_encoder/config.json", "text_encoder/model.fp16.safetensors", "text_encoder_2/config.json", "text_encoder_2/model.fp16.safetensors", "tokenizer/merges.txt", "tokenizer/special_tokens_map.json", "tokenizer/tokenizer_config.json", "tokenizer/vocab.json", "tokenizer_2/merges.txt", "tokenizer_2/special_tokens_map.json", "tokenizer_2/tokenizer_config.json", "tokenizer_2/vocab.json", "unet/config.json", "unet/diffusion_pytorch_model.fp16.safetensors", "vae/config.json", "vae/diffusion_pytorch_model.fp16.safetensors", "LICENSE.md"]

def main():
    # Revision is recorded before download; LFS sha256 is checked after download.
    request = urllib.request.Request(f"https://huggingface.co/api/models/{REPO}?blobs=true", headers={"User-Agent": "Atolye-local-visual-audit/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        metadata = json.load(response)
    revision = metadata["sha"]
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise RuntimeError("MODEL_REVISION_INVALID")
    siblings = {item["rfilename"]: item for item in metadata["siblings"]}
    selected = [name for name in FILES if name in siblings]
    required = [name for name in FILES if name != "LICENSE.md"]
    if any(name not in siblings for name in required):
        raise RuntimeError("MODEL_REVIEWED_FILE_MISSING")
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    DEST.mkdir(parents=True, exist_ok=True)
    # Stream with a fixed bound instead of the client whose >4GB download stalled on this Windows host.
    for name in selected:
        file = DEST / name
        info = siblings[name]
        expected = info.get("lfs", {}).get("sha256")
        def verified():
            if not file.is_file():
                return False
            if expected:
                with file.open("rb") as handle:
                    return hashlib.file_digest(handle, "sha256").hexdigest() == expected
            data = file.read_bytes()
            return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest() == info.get("blobId")
        if verified():
            print(f"Verified cached {name}", flush=True)
            continue
        file.parent.mkdir(parents=True, exist_ok=True)
        partial = file.with_suffix(file.suffix + ".atolye-part")
        url = f"https://huggingface.co/{REPO}/resolve/{revision}/{quote(name, safe='/')}"
        request = urllib.request.Request(url, headers={"User-Agent": "Atolye-local-visual-audit/1", "Accept-Encoding": "identity"})
        count = 0
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as handle:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                count += len(block)
                if count > 6 * 1024**3:
                    raise RuntimeError("MODEL_DOWNLOAD_SIZE_REFUSED")
                handle.write(block)
                if count % (128 * 1024 * 1024) == 0:
                    print(f"Downloading {name}: {count // (1024 * 1024)} MiB", flush=True)
        partial.replace(file)
        if not verified():
            raise RuntimeError("MODEL_DOWNLOAD_HASH_MISMATCH")
    records = []
    for name in selected:
        file = DEST / name
        if not file.is_file() or file.resolve().is_relative_to(DEST.resolve()) is False:
            raise RuntimeError("MODEL_FILE_OUTSIDE_ROOT")
        digest = hashlib.file_digest(file.open("rb"), "sha256").hexdigest()
        lfs = siblings[name].get("lfs", {})
        expected = lfs.get("sha256")
        if name.endswith(".safetensors") and (not expected or digest != expected):
            raise RuntimeError("MODEL_LFS_SHA256_MISMATCH")
        records.append({"file": name, "bytes": file.stat().st_size, "sha256": digest, "officialLfsVerified": bool(expected and digest == expected)})
    receipt = {"schema": 1, "repository": REPO, "revision": revision, "dataOnly": True, "paidCalls": 0, "files": records}
    (DEST.parent / "model-manifest.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"status": "PASS", "revision": revision, "files": len(records), "bytes": sum(r["bytes"] for r in records), "paidCalls": 0}))

if __name__ == "__main__":
    main()
