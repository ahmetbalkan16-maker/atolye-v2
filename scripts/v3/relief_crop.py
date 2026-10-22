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
    """The reference channel's land colours (Natural Earth's own are pale), with its water filled in by the land round it.

    The map draws this image on its vector land only, over its own sea (map trial, 22 Oct 2026: on a close view the
    image's coarse coast showed as steps of sea inside the land and of land in the sea), so the image needs no sea —
    only land that reaches past its own coast to wherever the vector coast lies.
    """
    import numpy as np
    from PIL import Image, ImageEnhance, ImageFilter

    land = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(1.25)).enhance(1.18)
    a = np.asarray(land).astype(np.float32)
    # Natural Earth's pale yellow lowlands towards the reference's green: less red and blue, the relief kept.
    a *= np.array([0.78, 0.86, 0.66], dtype=np.float32)
    src = np.asarray(im).astype(np.float32)
    water = (src[..., 2] > src[..., 0] + 22) & (src[..., 2] >= src[..., 1])
    if water.any() and not water.all():
        # Water takes the land colour blurred out of the land beside it, wider and wider till every pixel has some.
        keep = (~water).astype(np.float32)
        filled = a.copy()
        todo = water.copy()
        for radius in (4, 16, 64, 256):
            w = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
            c = np.stack([np.asarray(Image.fromarray((a[..., i] * keep).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0 for i in range(3)], axis=2)
            # PIL blurs only 8-bit images: a pixel with little land round it is left for a wider blur, not divided by noise.
            ok = todo & (w > 0.2)
            filled[ok] = (c[ok] * 255.0) / w[ok][:, None]
            todo &= ~ok
            if not todo.any():
                break
        if todo.any():
            filled[todo] = a[~water].mean(axis=0)
        a = filled
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
