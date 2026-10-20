"""Atölye V3 — cut a face out of a portrait for a puppet head (local, offline, OpenCV YuNet, MIT).

  python face_cut.py <portrait> <out.png> <yunet.onnx>
  -> stdout JSON: {"ok": true, "mouth_y": 0.71, "mouth_x": 0.55, "eye_y": 0.42, "flipped": false, "score": 0.93, "faces": 1, "box": [x, y, w, h]}
     or {"ok": false, "error": "..."}

The biggest detected face is cropped with room for the forehead and chin, resized to 512 px and given an
elliptical, feathered alpha (the puppet head clips it again). The landmarks give the mouth and eye lines as fractions
of the crop height, so the renderer can split the face for a talking jaw. A light grade (smoothing, a little
colour) helps paintings and old photos sit next to the flat cartoon bodies. Paths are read and written through
numpy buffers, so Unicode folders work.
"""
import json
import sys

import cv2
import numpy as np

SIZE = 512


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(0)


def main():
    src, out, model = sys.argv[1], sys.argv[2], sys.argv[3]
    data = np.fromfile(src, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        fail("image unreadable")
    h, w = img.shape[:2]
    # YuNet works best on images up to ~1500 px; landmarks are scaled back.
    scale = min(1.0, 1500 / max(h, w))
    small = cv2.resize(img, (int(w * scale), int(h * scale))) if scale < 1 else img
    det = cv2.FaceDetectorYN.create(model, "", (small.shape[1], small.shape[0]), score_threshold=0.6)
    _, faces = det.detect(small)
    if faces is None or len(faces) == 0:
        fail("no face found")
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    f = faces[0] / scale
    x, y, fw, fh = f[0], f[1], f[2], f[3]
    if fw < 40 or fh < 40:
        fail(f"face too small ({int(fw)} px)")
    re, le, nose, rm, lm = (f[4:6], f[6:8], f[8:10], f[10:12], f[12:14])
    # Crop: the face box widened, with more room above (forehead, hairline) than below (chin).
    cw, ch = fw * 1.32, fh * 1.5
    cx, cy = x + fw / 2, y + fh / 2 - fh * 0.12
    x0, y0 = int(round(cx - cw / 2)), int(round(cy - ch / 2))
    x1, y1 = int(round(cx + cw / 2)), int(round(cy + ch / 2))
    pad = max(0, -x0, -y0, x1 - w, y1 - h)
    if pad:
        img = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
        x0, y0, x1, y1 = x0 + pad, y0 + pad, x1 + pad, y1 + pad
    crop = img[y0:y1, x0:x1]
    crop = cv2.resize(crop, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    # Puppets face +x (right): a face turned to the left (nose left of the eyes' midpoint) is mirrored.
    flip = bool(nose[0] < (re[0] + le[0]) / 2 - fw * 0.04)
    if flip:
        crop = cv2.flip(crop, 1)
    # Grade: smooth texture (paint cracks, film grain), lift colour a little.
    crop = cv2.bilateralFilter(crop, 9, 40, 9)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.12, 0, 255)
    crop = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    mask = np.zeros((SIZE, SIZE), np.uint8)
    cv2.ellipse(mask, (SIZE // 2, SIZE // 2), (int(SIZE * 0.47), int(SIZE * 0.48)), 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), 6)
    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = mask
    ok, buf = cv2.imencode(".png", rgba)
    if not ok:
        fail("png encode failed")
    buf.tofile(out)
    to_crop_y = lambda py: float((py + pad - y0) / (y1 - y0))
    mouth_x = float(((rm[0] + lm[0]) / 2 + pad - x0) / (x1 - x0))
    print(json.dumps({
        "ok": True,
        "mouth_y": round(to_crop_y((rm[1] + lm[1]) / 2), 4),
        "mouth_x": round(1 - mouth_x if flip else mouth_x, 4),
        "eye_y": round(to_crop_y((re[1] + le[1]) / 2), 4),
        "flipped": flip,
        "score": round(float(faces[0][14]), 3),
        "faces": int(len(faces)),
        "box": [int(x), int(y), int(fw), int(fh)],
    }))


if __name__ == "__main__":
    main()
