"""Atölye V3 — the close battle map's ground from real elevation (owner, 22 Oct 2026: a close map of the place).

  python terrain_close.py <tiles_dir> <z> <x0> <y0> <x1> <y1> <west> <east> <south> <north> <out_w> <out_h> <out.jpg>
      Terrarium elevation tiles (AWS Open Data, Mapzen terrain: SRTM, GMTED, ETOPO1 and others) z/x0..x1/y0..y1 in
      tiles_dir/z/x/y.png, stitched, decoded (R*256 + G + B/256 - 32768 m), resampled from Web Mercator to the map's
      own projection (longitude and latitude both linear) between those bounds, and painted like an atlas's close map:
      greens in the lowlands through yellow to tan on the heights (the ramp spread over the place's own range), with
      hillshade from the north-west. Water is not drawn (the map draws its own sea and lakes over the vector coast).

Prints one JSON line.
"""
import json
import math
import os
import sys

# Elevation ramp, as fractions of the place's own range: atlas greens to tans.
RAMP = [
    (0.00, (150, 184, 120)),
    (0.15, (171, 196, 132)),
    (0.35, (199, 205, 146)),
    (0.55, (222, 218, 165)),
    (0.75, (219, 200, 150)),
    (1.00, (196, 170, 125)),
]


def merc_y(lat, n):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def build(tiles, z, x0, y0, x1, y1, west, east, south, north, out_w, out_h, out):
    import numpy as np
    from PIL import Image

    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    elev = np.zeros((rows * 256, cols * 256), dtype=np.float32)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            f = os.path.join(tiles, str(z), str(tx), f"{ty}.png")
            if not os.path.exists(f):
                continue
            a = np.asarray(Image.open(f).convert("RGB")).astype(np.float32)
            elev[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    n = 2 ** z
    # Output pixel centres in source pixels: x linear in longitude, y through the Mercator formula.
    lon = west + (np.arange(out_w) + 0.5) / out_w * (east - west)
    lat = north - (np.arange(out_h) + 0.5) / out_h * (north - south)
    sx = (lon + 180) / 360 * n * 256 - x0 * 256
    sy = np.array([merc_y(v, n) for v in lat]) * 256 - y0 * 256
    sx = np.clip(sx, 0, elev.shape[1] - 1.001)
    sy = np.clip(sy, 0, elev.shape[0] - 1.001)
    ix, iy = np.floor(sx).astype(int), np.floor(sy).astype(int)
    fx, fy = (sx - ix)[None, :], (sy - iy)[:, None]
    e00 = elev[iy][:, ix]
    e01 = elev[iy][:, ix + 1]
    e10 = elev[iy + 1][:, ix]
    e11 = elev[iy + 1][:, ix + 1]
    e = (e00 * (1 - fx) + e01 * fx) * (1 - fy) + (e10 * (1 - fx) + e11 * fx) * fy
    land = e > 0.5
    # The ramp over the place's own heights (a low plain still shows its rises), at least 60 m.
    if land.any():
        lo = float(np.percentile(e[land], 2))
        hi = float(np.percentile(e[land], 99))
    else:
        lo, hi = 0.0, 60.0
    hi = max(hi, lo + 60)
    t = np.clip((e - lo) / (hi - lo), 0, 1)
    col = np.zeros((out_h, out_w, 3), dtype=np.float32)
    for (a, ca), (b, cb) in zip(RAMP[:-1], RAMP[1:]):
        m = (t >= a) & (t <= b)
        u = ((t - a) / (b - a))[m][:, None]
        col[m] = np.array(ca, dtype=np.float32) * (1 - u) + np.array(cb, dtype=np.float32) * u
    # Hillshade (sun from the north-west, 45° high), relief exaggerated so low hills read.
    mid = math.radians((north + south) / 2)
    dx = (east - west) * 111320 * math.cos(mid) / out_w
    dy = (north - south) * 110570 / out_h
    gy, gx = np.gradient(e * 2.2, dy, dx)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    col *= (0.55 + 0.6 * shade)[..., None]
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(out, quality=92)
    return {"ok": True, "range_m": [round(lo), round(hi)], "out_px": [out_w, out_h]}


def main():
    a = sys.argv[1:]
    res = build(a[0], int(a[1]), int(a[2]), int(a[3]), int(a[4]), int(a[5]), float(a[6]), float(a[7]), float(a[8]), float(a[9]), int(a[10]), int(a[11]), a[12])
    print(json.dumps(res))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # one JSON line either way
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"[:400]}))
        sys.exit(1)
