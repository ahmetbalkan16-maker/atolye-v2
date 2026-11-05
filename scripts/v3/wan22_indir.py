"""Atölye V3 — Wan 2.2 TI2V-5B weights for the image-to-video trial (owner, 5 Nov 2026: "indirmeyi başlat ama pc
kapanırsa sabah kaldığı yerden indirmeye devam etsin ama bizden onay almadan video üretmesin").

DOWNLOAD ONLY. It never loads a model and never makes a video: the trial waits for the owner's approval.

Pinned files, one at a time, each resumed from its partial file after a power-off (Hugging Face's `.incomplete` file
and HTTP Range), into one folder; then every file's size and SHA-256 are checked against the hub's LFS record and
`model-manifest.json` is written (as for SDXL), so a later trial loads it offline and refuses a changed file.
- the transformer: Comfy-Org's fp16 single file (10 GB; its 825 tensors map 1:1 onto WanTransformer3DModel through
  diffusers' convert_wan_transformer_to_diffusers — checked from the file header on 5 Nov 2026) instead of the
  Diffusers repo's fp32 shards (20 GB);
- text encoder (umt5-xxl), VAE (Wan 2.2's own, z 48), tokenizer, scheduler, configs: Wan-AI's Diffusers repo.
Both Apache-2.0. ~24.2 GB on D (an HDD): the PC's other work is unaffected, the card is not used.

The scheduled task "Atolye Wan22 Indir" (`--kur`) starts it hidden at every logon until the download is complete;
then it deletes the task itself. A second start while one runs exits at once (pid lock). A network error waits and
tries again (1 → 10 min); a nearly full disk stops it.

  pythonw.exe -I wan22_indir.py           # download / resume (hidden; the task runs this)
  python.exe  -I wan22_indir.py --durum   # how far it is
  python.exe  -I wan22_indir.py --kur     # register the logon task
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(os.environ.get("ATOLYE_V3_WAN22_DIR", r"D:\URETIM\Atolye\v3-tools\models\wan22-ti2v-5b"))
LOG = Path(os.environ.get("ATOLYE_V3_WAN22_LOG", r"D:\URETIM\private\logs\wan22-indir.log"))
STATE = ROOT / "indirme-durumu.json"
LOCK = ROOT / ".indirme.pid"
TASK = "Atolye Wan22 Indir"
# Free space kept on the drive beside what is still to come (GB).
DISK_RESERVE_GB = 15

COMFY = ("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "ee6f4a40737a995bf5818954cfce6d59443b0f04")
DIFFUSERS = ("Wan-AI/Wan2.2-TI2V-5B-Diffusers", "b8fff7315c768468a5333511427288870b2e9635")
COMFY_FILES = ["split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"]
DIFFUSERS_PREFIXES = ("model_index.json", "scheduler/", "tokenizer/", "text_encoder/", "vae/", "transformer/config.json")

# Plain HTTP with Range (resumable); no progress bars (pythonw has no console); offline nothing else is fetched.
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")


def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


_state_lock = threading.Lock()


def write_state(**kw):
    """The progress file (the reporter thread and the main thread both write it)."""
    with _state_lock:
        ROOT.mkdir(parents=True, exist_ok=True)
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"guncelleme": time.strftime("%Y-%m-%dT%H:%M:%S"), **kw}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE)


def pid_alive(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, timeout=20).stdout
        return str(pid) in out
    except Exception:
        return False


def take_lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        try:
            pid = int(LOCK.read_text().strip())
            if pid != os.getpid() and pid_alive(pid):
                return False
        except ValueError:
            pass
    LOCK.write_text(str(os.getpid()))
    return True


def plan():
    """The pinned files with their size and LFS SHA-256 (small files have no LFS record: size only)."""
    from huggingface_hub import HfApi

    api = HfApi()
    files = []
    info = api.model_info(DIFFUSERS[0], revision=DIFFUSERS[1], files_metadata=True)
    for s in info.siblings:
        if s.rfilename.startswith(DIFFUSERS_PREFIXES):
            files.append({"repo": DIFFUSERS[0], "rev": DIFFUSERS[1], "file": s.rfilename, "bytes": s.size, "sha256": s.lfs.sha256 if s.lfs else None})
    info = api.model_info(COMFY[0], revision=COMFY[1], files_metadata=True)
    for s in info.siblings:
        if s.rfilename in COMFY_FILES:
            files.append({"repo": COMFY[0], "rev": COMFY[1], "file": s.rfilename, "bytes": s.size, "sha256": s.lfs.sha256 if s.lfs else None})
    if len([f for f in files if f["file"] in COMFY_FILES]) != len(COMFY_FILES) or not any(f["file"].startswith("text_encoder/") for f in files):
        raise RuntimeError("WAN22_PLAN_INCOMPLETE")
    # Small files first, then the largest last.
    return sorted(files, key=lambda f: f["bytes"])


def on_disk(f):
    p = ROOT / f["file"]
    return p.stat().st_size if p.is_file() else 0


def partial_bytes():
    """Bytes in Hugging Face's partial files inside the folder (the one being fetched)."""
    d = ROOT / ".cache" / "huggingface" / "download"
    return sum(p.stat().st_size for p in d.rglob("*.incomplete")) if d.is_dir() else 0


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def remove_task():
    r = subprocess.run(["schtasks", "/Delete", "/TN", TASK, "/F"], capture_output=True, text=True)
    log(f"başlangıç görevi kaldırıldı: {TASK}" if r.returncode == 0 else f"başlangıç görevi yoktu/kaldırılamadı: {(r.stderr or r.stdout).strip()[:200]}")


def register_task():
    pyw = Path(sys.executable).with_name("pythonw.exe")
    cmd = f'"{pyw}" -I "{Path(__file__).resolve()}"'
    r = subprocess.run(["schtasks", "/Create", "/TN", TASK, "/SC", "ONLOGON", "/TR", cmd, "/RL", "LIMITED", "/F"], capture_output=True, text=True)
    print((r.stdout or r.stderr).strip())
    return r.returncode


def download():
    from huggingface_hub import hf_hub_download

    files = plan()
    total = sum(f["bytes"] for f in files)
    log(f"başladı (pid {os.getpid()}): {len(files)} dosya, {total / 1e9:.2f} GB → {ROOT}")
    stop = threading.Event()
    current = {"file": None}

    def reporter():
        while not stop.wait(30):
            done = sum(on_disk(f) for f in files) + partial_bytes()
            write_state(durum="indiriliyor", indirilen=done, toplam=total, yuzde=round(100 * done / total, 1), dosya=current["file"], pid=os.getpid())

    threading.Thread(target=reporter, daemon=True).start()
    try:
        for f in files:
            current["file"] = f["file"]
            target = ROOT / f["file"]
            if target.is_file() and target.stat().st_size == f["bytes"]:
                continue
            delay = 60
            while True:
                left = sum(max(0, g["bytes"] - on_disk(g)) for g in files)
                free = shutil.disk_usage(ROOT).free
                if free < left + DISK_RESERVE_GB * 1e9:
                    write_state(durum="disk", hata=f"D'de {free / 1e9:.0f} GB boş, {left / 1e9:.0f} GB + {DISK_RESERVE_GB} GB gerekli", toplam=total)
                    log(f"DURDU: disk yetmiyor ({free / 1e9:.0f} GB boş)")
                    return 2
                try:
                    t0 = time.monotonic()
                    before = partial_bytes()
                    hf_hub_download(f["repo"], f["file"], revision=f["rev"], local_dir=ROOT)
                    log(f"indi: {f['file']} ({f['bytes'] / 1e9:.2f} GB{f', yarımdan sürdü: {before / 1e9:.2f} GB' if before else ''}; {time.monotonic() - t0:.0f} sn)")
                    break
                except Exception as e:  # network, hub hiccup: wait and try again (resumes the partial file)
                    log(f"hata, {delay // 60} dk sonra yeniden (kaldığı yerden): {f['file']}: {type(e).__name__}: {str(e)[:200]}")
                    write_state(durum="bekliyor", hata=f"{type(e).__name__}: {str(e)[:200]}", dosya=f["file"], toplam=total)
                    time.sleep(delay)
                    delay = min(delay * 2, 600)
        stop.set()
        write_state(durum="dogrulaniyor", toplam=total)
        manifest = []
        for f in files:
            p = ROOT / f["file"]
            if p.stat().st_size != f["bytes"]:
                raise RuntimeError(f"WAN22_SIZE_MISMATCH: {f['file']}")
            got = sha256(p) if f["sha256"] else None
            if f["sha256"] and got != f["sha256"]:
                p.unlink()
                raise RuntimeError(f"WAN22_SHA_MISMATCH: {f['file']} silindi, bir sonraki başlangıçta yeniden iner")
            manifest.append({"repository": f["repo"], "revision": f["rev"], "file": f["file"], "bytes": f["bytes"], **({"sha256": got} if got else {})})
        (ROOT / "model-manifest.json").write_text(json.dumps({"model": "Wan2.2-TI2V-5B", "license": "Apache-2.0", "files": manifest, "verified": time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False, indent=2), encoding="utf-8")
        write_state(durum="tamam", indirilen=total, toplam=total, yuzde=100.0, not_="indirildi ve doğrulandı; video denemesi owner onayı bekliyor")
        log(f"TAMAM: {len(files)} dosya, boyut + SHA-256 doğrulandı; model-manifest.json yazıldı. Video üretilmedi (owner onayı gerekir).")
        remove_task()
        return 0
    finally:
        stop.set()


def main():
    if "--durum" in sys.argv:
        print(STATE.read_text(encoding="utf-8") if STATE.exists() else "henüz başlamadı")
        return 0
    if "--kur" in sys.argv:
        return register_task()
    if (ROOT / "model-manifest.json").exists():
        remove_task()
        return 0
    if sys.stderr is None:  # pythonw: library warnings go to the log instead of nowhere
        LOG.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(LOG, "a", encoding="utf-8", buffering=1)
    if not take_lock():
        return 0
    try:
        return download()
    except Exception as e:
        log(f"HATA: {type(e).__name__}: {str(e)[:300]}")
        write_state(durum="hata", hata=f"{type(e).__name__}: {str(e)[:300]}")
        return 1
    finally:
        try:
            if LOCK.exists() and LOCK.read_text().strip() == str(os.getpid()):
                LOCK.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
