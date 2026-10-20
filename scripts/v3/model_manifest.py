"""Atölye V3 — model folder manifest check, shared by the local model servers (ACE-Step, MOSS, VoxCPM).

`<model_dir>/atolye-manifest.json` is written once after a reviewed download (scripts/v3/model-manifest.ts):
the source repository and every file with its size; files that can run or carry code (.py, .pt, .pth, .bin, .ckpt,
.pkl) and small files also with their SHA-256. A server calls `verify(model_dir, repo)` before loading and refuses a
folder whose files were added, removed or changed since the review (the SDXL server does the same).
"""
import hashlib
import json
from pathlib import Path

CODE_SUFFIXES = {".py", ".pt", ".pth", ".bin", ".ckpt", ".pkl"}
HASH_LIMIT = 50 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def verify(model_dir: Path, repo: str) -> None:
    manifest_file = model_dir / "atolye-manifest.json"
    if not manifest_file.is_file():
        raise RuntimeError("MODEL_MANIFEST_MISSING: run scripts/v3/model-manifest.ts after the download is reviewed")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("repository") != repo:
        raise RuntimeError(f"MODEL_UNREVIEWED: manifest is for {manifest.get('repository')}, expected {repo}")
    listed = {r["file"] for r in manifest["files"]}
    for record in manifest["files"]:
        f = (model_dir / record["file"]).resolve()
        if not f.is_relative_to(model_dir.resolve()) or not f.is_file() or f.stat().st_size != record["bytes"]:
            raise RuntimeError(f"MODEL_CHANGED: {record['file']}")
        if record.get("sha256") and sha256(f) != record["sha256"]:
            raise RuntimeError(f"MODEL_CHANGED: {record['file']} (sha256)")
    for f in model_dir.rglob("*"):
        rel = f.relative_to(model_dir).as_posix()
        if f.is_file() and f.suffix.lower() in CODE_SUFFIXES and rel not in listed and not rel.startswith(".cache/"):
            raise RuntimeError(f"MODEL_UNLISTED_CODE: {rel}")
