#!/usr/bin/env python3
"""
Train a real openWakeWord "AYAS" model (Voice Closure Sprint).

Deterministic, self-contained, CPU-friendly. Positives + most negatives are
synthesised locally with the repo's Piper Turkish voice (bin/piper); false-
positive rate is measured against openWakeWord's 11.3 h precomputed validation
feature set.

  python scripts/wake/train_ayas_wake.py --steps 8000 --n-pos 1400 --out public/wake/ayas.onnx

Honest limits (reported, not hidden):
  * one TTS voice -> synthetic-only positives. Real-speaker recall is unknown
    until a human tests it; the operator tunes the threshold / adds real clips.
  * the 17 GB ACAV100M training-negative feature set is NOT used (impractical to
    fetch here); training negatives are locally synthesised + noise. The model
    is real, but its false-positive robustness is weaker than a full train and
    depends more on the runtime threshold.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

# openWakeWord's dependency chain pins old packages; `acoustics` (pulled in by
# openwakeword.data) imports scipy.special.sph_harm, removed in scipy >= 1.15.
# Shim it so the import chain succeeds — openWakeWord's training path never
# actually evaluates spherical-harmonic directivity.
import scipy.special as _spspecial

if not hasattr(_spspecial, "sph_harm"):
    try:
        from scipy.special import sph_harm_y as _sph_harm_y

        _spspecial.sph_harm = lambda m, n, theta, phi: _sph_harm_y(n, m, phi, theta)
    except Exception:
        _spspecial.sph_harm = lambda *a, **k: 0.0

REPO = Path(__file__).resolve().parents[2]
PIPER_SRC = REPO / "bin" / "piper"
SEED = 1234

TR_FILLER = [
    "kaç proje var", "projeleri göster", "son başarısız aşama neydi", "durum raporu ver",
    "pipeline nerede takıldı", "bugün hava nasıl", "bu dosyayı kontrol et", "video hazır mı",
    "render tamam mı", "kaç tane tamamlandı", "sıradaki adım ne", "atölyede neler oluyor",
    "iyi akşamlar", "teşekkür ederim", "bir saniye bekle", "tekrar dener misin",
    "mikrofonu kapat", "sesi aç", "yardım et", "not al", "hatırlat", "listeyi güncelle",
    "beş dakika sonra", "yarın sabah", "hangi proje aktif", "seo aşaması ne durumda",
]
ADVERSARIAL = [
    "ayaz", "ayla", "ayasız", "hayat", "hayali", "ayakta", "ayarla", "aya bak",
    "ay ışığı", "haya", "aya", "yas", "ays", "a yas", "ayah", "iyas", "eyas",
]
TR_WORDS = [
    "merhaba", "evet", "hayır", "tamam", "proje", "video", "ses", "görsel", "sahne",
    "senaryo", "başlat", "durdur", "devam", "iptal", "kaydet", "sil", "aç", "kapat",
    "istanbul", "ankara", "bugün", "yarın", "sabah", "akşam", "bir", "iki", "üç",
    "dört", "beş", "altı", "yedi", "sekiz", "dokuz", "on", "nasılsın", "ne haber",
    "dinliyorum", "anladım", "bekle", "hazır", "çalışıyor", "bitti", "hata var",
]
POSITIVE_TEXTS = [
    "AYAS", "AYAS.", "AYAS?", "hey AYAS", "AYAS bak", "AYAS dinle",
    "AYAS lütfen", "AYAS merhaba", "AYAS neredesin", "AYAS uyan",
]


def _piper_batch(piper_dir: Path, lines: list[str], out_dir: Path, length_scale: float, noise: float):
    """One piper process, many lines -> many wavs (timestamp-named, in stdin order)."""
    exe = piper_dir / ("piper.exe" if os.name == "nt" else "piper")
    out_dir.mkdir(parents=True, exist_ok=True)
    before = set(out_dir.glob("*.wav"))
    subprocess.run(
        [str(exe), "--model", str(piper_dir / "tr_TR-dfki-medium.onnx"),
         "--espeak_data", str(piper_dir / "espeak-ng-data"),
         "--length_scale", f"{length_scale:.3f}", "--noise_scale", f"{noise:.3f}",
         "--output_dir", str(out_dir)],
        input="\n".join(lines).encode("utf-8"), cwd=str(piper_dir), check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900,
    )
    return sorted(set(out_dir.glob("*.wav")) - before, key=lambda p: p.name)


def _read_wav_16k_mono(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if sr != 16000:
        idx = (np.arange(int(len(x) * 16000 / sr)) * sr / 16000).astype(np.int64)
        idx = idx[idx < len(x)]
        x = x[idx]
    return x


def _fixed(x: np.ndarray, seconds: float = 2.75, jitter: bool = True) -> np.ndarray:
    n = int(seconds * 16000)
    if len(x) >= n:
        start = random.randint(0, len(x) - n) if jitter else 0
        return x[start:start + n]
    pad = n - len(x)
    left = random.randint(0, pad) if jitter else pad // 2
    return np.concatenate([np.zeros(left, np.float32), x, np.zeros(pad - left, np.float32)])


def _augment(x: np.ndarray, rng: random.Random) -> np.ndarray:
    y = x.copy()
    if rng.random() < 0.7:  # gain
        y *= 10 ** (rng.uniform(-8, 4) / 20)
    if rng.random() < 0.6:  # white noise
        y += np.random.normal(0, rng.uniform(0.001, 0.02), size=y.shape).astype(np.float32)
    if rng.random() < 0.4:  # crude reverb (decaying echoes)
        ir = np.zeros(int(16000 * rng.uniform(0.05, 0.25)), np.float32)
        ir[0] = 1.0
        for _ in range(rng.randint(2, 6)):
            p = rng.randint(1, len(ir) - 1)
            ir[p] += rng.uniform(-0.4, 0.4)
        y = np.convolve(y, ir)[: len(x)].astype(np.float32)
    return np.clip(y, -1.0, 1.0)


def synth_set(piper_dir, texts, per_text, rng, seconds, tag):
    """Batched piper synthesis: a few processes (one per prosody bucket) instead
    of one per clip. Each rendered wav is then augmented x2."""
    clips = []
    tmp = Path(tempfile.mkdtemp(prefix=f"awk-{tag}-"))
    lines = [t for t in texts for _ in range(per_text)]
    buckets = [(0.90, 0.55), (1.00, 0.667), (1.15, 0.80)]
    for bi, (ls, ns) in enumerate(buckets):
        d = tmp / f"b{bi}"
        try:
            wavs = _piper_batch(piper_dir, lines, d, ls, ns)
        except Exception as e:
            print(f"  {tag}: piper batch {bi} failed: {e}", flush=True)
            continue
        for w in wavs:
            try:
                base = _read_wav_16k_mono(w)
            except Exception:
                continue
            for _ in range(2):
                clips.append(_fixed(_augment(base, rng), seconds))
        print(f"  {tag}: bucket {bi + 1}/{len(buckets)} -> {len(wavs)} wavs (total clips {len(clips)})", flush=True)
    return np.stack(clips) if clips else np.zeros((0, int(seconds * 16000)), np.float32)


def noise_set(n, rng, seconds):
    out = []
    for _ in range(n):
        kind = rng.random()
        if kind < 0.4:
            y = np.random.normal(0, rng.uniform(0.005, 0.05), int(seconds * 16000)).astype(np.float32)
        elif kind < 0.7:
            t = np.arange(int(seconds * 16000)) / 16000
            y = (0.1 * np.sin(2 * np.pi * rng.uniform(80, 400) * t)).astype(np.float32)
        else:
            y = np.zeros(int(seconds * 16000), np.float32)
        out.append(np.clip(y, -1, 1))
    return np.stack(out)


def windows(emb: np.ndarray, w: int = 16) -> np.ndarray:
    if emb.shape[0] < w:
        return np.zeros((0, w, emb.shape[1]), np.float32)
    return np.stack([emb[i:i + w] for i in range(emb.shape[0] - w + 1)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=8000)
    ap.add_argument("--n-pos", type=int, default=1400)
    ap.add_argument("--out", default=str(REPO / "public" / "wake" / "ayas.onnx"))
    args = ap.parse_args()

    random.seed(SEED)
    np.random.seed(SEED)
    rng = random.Random(SEED)
    import torch
    torch.manual_seed(SEED)

    from openwakeword.utils import AudioFeatures
    from openwakeword.data import generate_adversarial_texts
    from openwakeword.train import Model

    # --- ASCII piper copy (Node/CRT mangles non-ASCII argv on Windows) ---
    ascii_piper = Path(tempfile.mkdtemp(prefix="awk-piper-")) / "piper"
    import shutil
    shutil.copytree(PIPER_SRC, ascii_piper)

    per_pos = max(1, args.n_pos // (len(POSITIVE_TEXTS) * 6))
    print(f"[1/5] synthesising positives (~{args.n_pos})...", flush=True)
    pos_clips = synth_set(ascii_piper, POSITIVE_TEXTS, per_pos, rng, 2.75, "pos")

    print("[2/5] synthesising negatives...", flush=True)
    try:
        adv = list(dict.fromkeys(ADVERSARIAL + list(generate_adversarial_texts("AYAS", 40))))
    except Exception:
        adv = ADVERSARIAL
    neg_clips = np.concatenate([
        synth_set(ascii_piper, TR_FILLER + TR_WORDS, 4, rng, 2.75, "neg-filler"),
        synth_set(ascii_piper, adv, 4, rng, 2.75, "neg-adv"),
        noise_set(700, rng, 2.75),
    ])
    print(f"  positives={len(pos_clips)}  negatives={len(neg_clips)}", flush=True)

    print("[3/5] computing openWakeWord features...", flush=True)
    af = AudioFeatures(ncpu=1)
    to_i16 = lambda a: np.clip(a * 32767.0, -32768, 32767).astype(np.int16)
    pos_emb = af.embed_clips(to_i16(pos_clips), batch_size=64)   # (N, frames, 96)
    neg_emb = af.embed_clips(to_i16(neg_clips), batch_size=64)
    # hold out the last 12 % of CLIPS (before slicing to windows) so held-out
    # recall is measured on unseen utterances, not unseen windows of seen ones.
    p_cut, n_cut = int(len(pos_emb) * 0.88), int(len(neg_emb) * 0.88)
    tr_pos = np.concatenate([windows(e) for e in pos_emb[:p_cut]]).astype(np.float32)
    tr_neg = np.concatenate([windows(e) for e in neg_emb[:n_cut]]).astype(np.float32)
    te_pos = np.concatenate([windows(e) for e in pos_emb[p_cut:]]).astype(np.float32)
    te_neg = np.concatenate([windows(e) for e in neg_emb[n_cut:]]).astype(np.float32)
    te_pos_clips = list(pos_emb[p_cut:])
    print(f"  train windows: pos={len(tr_pos)} neg={len(tr_neg)} | held-out clips: pos={len(te_pos_clips)}", flush=True)
    if len(tr_pos) == 0 or len(tr_neg) == 0:
        raise SystemExit("no training windows — clips too short or synthesis failed")

    val = np.load(REPO / ".venv-wake" / "wake-data" / "validation_set_features.npy", mmap_mode="r")
    val_w = np.stack([np.asarray(val[i:i + 16]) for i in range(0, len(val) - 16, 16)]).astype(np.float32)
    print(f"  FP-validation windows={len(val_w)} (~11.3 h)", flush=True)

    def batch_iter(bs=1024):
        while True:
            pi = np.random.randint(0, len(tr_pos), bs // 2)
            ni = np.random.randint(0, len(tr_neg), bs - bs // 2)
            x = np.concatenate([tr_pos[pi], tr_neg[ni]])
            y = np.concatenate([np.ones(len(pi), np.float32), np.zeros(len(ni), np.float32)])
            p = np.random.permutation(len(x))
            yield torch.from_numpy(x[p]), torch.from_numpy(y[p])

    def val_fp_iter(bs=2048):
        for i in range(0, len(val_w) - bs, bs):
            yield torch.from_numpy(val_w[i:i + bs]), torch.zeros(bs, dtype=torch.float32)

    def xval_iter():
        x = np.concatenate([te_pos, te_neg])
        y = np.concatenate([np.ones(len(te_pos), np.float32), np.zeros(len(te_neg), np.float32)])
        yield torch.from_numpy(x), torch.from_numpy(y)

    print(f"[4/5] training openWakeWord DNN — {args.steps} steps (CPU)", flush=True)
    model = Model(n_classes=1, input_shape=(16, 96), model_type="dnn", layer_dim=128, n_blocks=1)
    steps = args.steps
    weights = np.linspace(1, 800, steps).tolist()
    val_steps = list(np.linspace(int(steps * 0.4), steps - 1, 24).astype(int))
    model.train_model(
        X=batch_iter(), max_steps=steps, warmup_steps=steps // 5, hold_steps=steps // 3,
        false_positive_val_data=list(val_fp_iter()), X_val=list(xval_iter()),
        negative_weight_schedule=weights, val_steps=val_steps, lr=1e-4, val_set_hrs=11.3,
    )
    # Pick the checkpoint with the best (recall - fp_penalty). openWakeWord's
    # _select_best_model throws when no checkpoint clears its FP target (our
    # locally-synthesised negatives are weaker than the 17 GB set), so score
    # every kept checkpoint ourselves against the real 11.3 h validation set.
    val_batches = list(val_fp_iter())
    candidates = list(model.best_models) + [model.model]
    scored = []
    with torch.no_grad():
        for mdl in candidates:
            mdl.eval()
            rc_tp = rc_n = 0
            for e in te_pos_clips:
                ww = windows(e)
                if len(ww) == 0:
                    continue
                rc_n += 1
                if np.max(mdl(torch.from_numpy(ww.astype(np.float32))).squeeze().numpy()) >= 0.5:
                    rc_tp += 1
            rec = rc_tp / max(1, rc_n)
            vfp = sum(int((mdl(xb).squeeze().numpy() >= 0.5).sum()) for xb, _ in val_batches) / 11.3
            scored.append((rec, vfp, mdl))
    scored.sort(key=lambda s: (s[0] - 0.02 * s[1]), reverse=True)
    best_rec, best_fp, best_mdl = scored[0]
    model.model = best_mdl
    print(f"  chosen checkpoint: recall={best_rec:.2f} fp/h@0.5={best_fp:.1f} (of {len(scored)} candidates)", flush=True)

    print("[5/5] exporting + validating...", flush=True)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    model.model.eval()
    model.export_to_onnx(args.out, class_mapping="ayas")
    try:  # consolidate any external-data split into one file (browser onnxruntime-web)
        import onnx as _onnx
        _m = _onnx.load(args.out, load_external_data=True)
        _onnx.save_model(_m, args.out, save_as_external_data=False)
        _d = args.out + ".data"
        if os.path.exists(_d):
            os.remove(_d)
    except Exception as _e:
        print(f"  WARNING: onnx consolidation skipped: {_e}", flush=True)

    # recall + FP/h at several thresholds, so the operator can pick one
    with torch.no_grad():
        pos_scores = []
        for e in te_pos_clips:
            ww = windows(e)
            if len(ww):
                pos_scores.append(float(np.max(model.model(torch.from_numpy(ww.astype(np.float32))).squeeze().numpy())))
        val_max = np.concatenate([model.model(xb).squeeze().numpy() for xb, _ in val_batches])
        thr_table = {}
        for thr in (0.5, 0.7, 0.85, 0.95):
            rec = float(np.mean([s >= thr for s in pos_scores])) if pos_scores else 0.0
            thr_table[str(thr)] = {"recall": round(rec, 3), "fp_per_hour": round(float((val_max >= thr).sum()) / 11.3, 2)}
        recall = thr_table["0.5"]["recall"]
        fp_per_hr = thr_table["0.5"]["fp_per_hour"]

    report = {
        "out": args.out,
        "steps": steps,
        "threshold_table": thr_table,
        "positives_synth": int(len(pos_clips)),
        "negatives_synth": int(len(neg_clips)),
        "held_out_clip_recall_at_0.5": round(recall, 3),
        "false_positives_per_hour_at_0.5": round(fp_per_hr, 2),
        "checkpoints_kept": len(model.best_models),
        "note": "synthetic positives only (1 TTS voice); real-speaker recall + threshold = OPERATOR device test",
    }
    Path(args.out).with_suffix(".report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    shutil.rmtree(ascii_piper.parent, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
