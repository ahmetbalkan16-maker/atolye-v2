"""Atölye V3 — terrain relief for drawn maps (Natural Earth I with shaded relief, water and drainages; public domain).

  python relief_crop.py prepare <NE1_HR_LC_SR_W_DR.tif> <tiles_dir>
      Cuts the 21600 x 10800 world image once into 18 x 18 degree JPEG tiles (1080 px), so a map never opens the 700 MB file.
  python relief_crop.py crop <tiles_dir> <west> <east> <south> <north> <out_w> <out_h> <out.jpg>
      The world image between those longitudes/latitudes (plate carree, 60 px a degree), resized to out_w x out_h —
      the caller passes the width already shrunk by cos(latitude), the projection the map builder draws with.

Prints one JSON line. License of the image: public domain (naturalearthdata.com).
"""
import json
import math
import os
import sys

PX_PER_DEG = 60
TILE_DEG = 18
TILE_PX = TILE_DEG * PX_PER_DEG
COLS = 360 // TILE_DEG
ROWS = 180 // TILE_DEG


def prepare(tif, tiles):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    os.makedirs(tiles, exist_ok=True)
    im = Image.open(tif).convert("RGB")
    if im.size != (360 * PX_PER_DEG, 180 * PX_PER_DEG):
        raise RuntimeError(f"unexpected size {im.size}")
    n = 0
    for r in range(ROWS):
        for c in range(COLS):
            out = os.path.join(tiles, f"{r:02d}_{c:02d}.jpg")
            if not os.path.exists(out):
                im.crop((c * TILE_PX, r * TILE_PX, (c + 1) * TILE_PX, (r + 1) * TILE_PX)).save(out, quality=92)
            n += 1
    return {"ok": True, "tiles": n}


def crop(tiles, west, east, south, north, out_w, out_h, out):
    from PIL import Image

    x0, x1 = (west + 180) * PX_PER_DEG, (east + 180) * PX_PER_DEG
    y0, y1 = (90 - north) * PX_PER_DEG, (90 - south) * PX_PER_DEG
    # A world across the 180th meridian (a Pacific map: west < -180 or east > 180) reads the columns round the globe.
    c0, c1 = int(x0 // TILE_PX), int(math.ceil(x1 / TILE_PX)) - 1
    r0, r1 = max(0, int(y0 // TILE_PX)), min(ROWS - 1, int(math.ceil(y1 / TILE_PX)) - 1)
    canvas = Image.new("RGB", ((c1 - c0 + 1) * TILE_PX, (r1 - r0 + 1) * TILE_PX))
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            with Image.open(os.path.join(tiles, f"{r:02d}_{c % COLS:02d}.jpg")) as t:
                canvas.paste(t, ((c - c0) * TILE_PX, (r - r0) * TILE_PX))
    ox, oy = c0 * TILE_PX, r0 * TILE_PX
    part = canvas.crop((round(x0 - ox), round(y0 - oy), round(x1 - ox), round(y1 - oy)))
    big = part.resize((out_w, out_h), Image.LANCZOS)
    if out_w > part.width * 1.2:
        # Enlarged past the source: a light unsharp mask keeps ridges and coasts crisp on a close view.
        from PIL import ImageFilter

        big = big.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    grade(big).save(out, quality=92)
    return {"ok": True, "source_px": [part.width, part.height], "out_px": [out_w, out_h]}


def grade(im):
    """The reference channel's look: richer land colours and a deep blue sea (Natural Earth's own colours are pale)."""
    import numpy as np
    from PIL import ImageEnhance

    land = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(1.25)).enhance(1.18)
    a = np.asarray(land).astype(np.float32)
    # Natural Earth's pale yellow lowlands towards the reference's green: less red and blue, the relief kept.
    a *= np.array([0.78, 0.86, 0.66], dtype=np.float32)
    src = np.asarray(im).astype(np.float32)
    water = (src[..., 2] > src[..., 0] + 22) & (src[..., 2] >= src[..., 1])
    deep = np.array([28, 62, 104], dtype=np.float32)
    # Keep the sea's own relief shading: darken towards the deep blue by its brightness.
    shade = (src[..., :3].mean(axis=2, keepdims=True) / 255.0) * 0.55 + 0.6
    a[water] = (deep * shade[water]).clip(0, 255)
    from PIL import Image

    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def main():
    cmd = sys.argv[1]
    if cmd == "prepare":
        res = prepare(sys.argv[2], sys.argv[3])
    elif cmd == "crop":
        w, e, s, n = (float(v) for v in sys.argv[3:7])
        res = crop(sys.argv[2], w, e, s, n, int(sys.argv[7]), int(sys.argv[8]), sys.argv[9])
    else:
        raise SystemExit("usage: relief_crop.py prepare|crop ...")
    print(json.dumps(res))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # one JSON line either way
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"[:400]}))
        sys.exit(1)
