"""Atölye V3 — faces in portrait candidates (OpenCV YuNet, face_detection_yunet_2023mar.onnx, MIT).

  python face_count.py <yunet.onnx> <image> [<image> ...]

Prints one JSON line: [{"file": ..., "w": ..., "h": ..., "faces": [[face_height_px, score], ...]}, ...], the faces
largest first. An image that cannot be read gets "error". Files are read as bytes (np.fromfile), so Unicode paths work.
"""
import json
import sys

import cv2
import numpy as np

MIN_SCORE = 0.6


def faces(detector, path):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"file": path, "error": "unreadable"}
    h, w = img.shape[:2]
    # YuNet looks at the image at its own size; a small preview is enlarged so small faces are not missed.
    scale = max(1.0, 640 / max(h, w))
    if scale > 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_CUBIC)
    ih, iw = img.shape[:2]
    detector.setInputSize((iw, ih))
    _, found = detector.detect(img)
    out = []
    for f in found if found is not None else []:
        if float(f[14]) >= MIN_SCORE:
            out.append([round(float(f[3]) / scale, 1), round(float(f[14]), 3)])
    out.sort(key=lambda x: -x[0])
    return {"file": path, "w": w, "h": h, "faces": out}


def main():
    model, files = sys.argv[1], sys.argv[2:]
    detector = cv2.FaceDetectorYN.create(model, "", (320, 320), MIN_SCORE, 0.3, 5000)
    print(json.dumps([faces(detector, f) for f in files]))


if __name__ == "__main__":
    main()
