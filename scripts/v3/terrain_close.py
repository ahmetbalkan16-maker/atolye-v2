"""Atölye V3 — the close battle map's ground from real elevation (owner, 22 Oct 2026: a close map of the place).

  python terrain_close.py <tiles_dir> <z> <x0> <y0> <x1> <y1> <west> <east> <south> <north> <out_w> <out_h> <out.jpg>
      Terrarium elevation tiles (AWS Open Data, Mapzen terrain: SRTM, GMTED, ETOPO1 and others) z/x0..x1/y0..y1 in
      tiles_dir/z/x/y.png, stitched, decoded (R*256 + G + B/256 - 32768 m), resampled from Web Mercator to the map's
      own projection (longitude and latitude both linear) between those bounds, and painted like an atlas's close map:
      greens in the lowlands through yellow to tan on the heights (the ramp spread over the place's own range), with
      hillshade from the north-west. Water is not drawn (the map draws its own sea and lakes over the vector coast).

  Owner, 12 Nov 2026 ("harita ortamı daha gerçekçi"): a flat plain like Cannae read as a bare gradient. So the ground is
  painted like a battle atlas's plate: meadow, grass and bare-soil patches and a fine grain mottle the colour (value
  noise seeded from the bounds, so a place always looks the same), the relief is exaggerated by the place's own
  slopes (a 40 m plain shows its rises, mountains are not overdone) under a soft light whose shadows stay coloured,
  and faint brown contour lines (about 6-12 across the place's range) are drawn. Everything is baked once per scene.

Prints one JSON line.
"""
import hashlib
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
# Contour intervals an atlas would use (m); the one giving ~8 lines across the place's range is taken.
INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
CONTOUR_RGB = (92, 66, 40)
LIGHT_RGB = (255, 250, 228)  # warm sunlit slopes
SHADOW_RGB = (64, 74, 92)  # cool, coloured shadows (never black)


def merc_y(lat, n):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def blur(a, passes):
    """A cheap gaussian-like blur of a small array: `passes` 1-2-1 binomial passes per axis, edges held."""
    import numpy as np

    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = (p[:-2, 1:-1] + 2 * p[1:-1, 1:-1] + p[2:, 1:-1]) / 4
        p = np.pad(a, 1, mode="edge")
        a = (p[1:-1, :-2] + 2 * p[1:-1, 1:-1] + p[1:-1, 2:]) / 4
    return a


def upsample(a, box, size):
    """`box` (x0, y0, x1, y1 in `a`'s pixel edges) of a float array resampled bicubically to `size` (w, h)."""
    import numpy as np
    from PIL import Image

    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BICUBIC, box=box), dtype=np.float32)


def value_noise(rng, w, h, cell, octaves, falloff=0.5):
    """Multi-octave value noise of about unit spread: random grids `cell` px apart (halved each octave), bicubic-smoothed."""
    import numpy as np

    total = np.zeros((h, w), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for _ in range(octaves):
        c = max(2.0, cell)
        gw, gh = int(w / c) + 3, int(h / c) + 3
        g = rng.standard_normal((gh, gw)).astype(np.float32)
        total += amp * upsample(g, (1, 1, 1 + w / c, 1 + h / c), (w, h))
        norm += amp * amp
        amp *= falloff
        cell /= 2
    return total / math.sqrt(norm)


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
    # Rows resampled from Mercator to linear latitude at the source's own resolution (columns are linear in
    # longitude already), then the bounds' box enlarged bicubically: smooth slopes, no bilinear facets in the shade.
    sx0 = (west + 180) / 360 * n * 256 - x0 * 256
    sx1 = (east + 180) / 360 * n * 256 - x0 * 256
    syn, sys_ = merc_y(north, n) * 256 - y0 * 256, merc_y(south, n) * 256 - y0 * 256
    m = max(2, int(math.ceil(sys_ - syn)) + 4)
    pad = 2
    lat_rows = north - (np.arange(m + 2 * pad) + 0.5 - pad) * (north - south) / m
    sy = np.array([merc_y(min(85.0, max(-85.0, v)), n) for v in lat_rows]) * 256 - y0 * 256 - 0.5
    sy = np.clip(sy, 0, elev.shape[0] - 1.001)
    iy = np.floor(sy).astype(int)
    fy = (sy - iy)[:, None].astype(np.float32)
    lin = elev[iy] * (1 - fy) + elev[iy + 1] * fy
    box = (sx0, pad, sx1, pad + m)
    # The relief's exaggeration from the place's own slopes (measured at the source's resolution on a calmed
    # surface): the steeper tenth of the ground is lifted to a readable slope, so a 40 m plain's rises show and
    # mountains stay mountains. The more it is lifted, the more SRTM's speckle (crops, roofs, canopy) is smoothed
    # away first, or a plain turns into lumps; the contours come from a calmer surface still.
    mid = math.radians((north + south) / 2)
    sdx = (east - west) * 111320 * math.cos(mid) / max(1e-6, sx1 - sx0)
    sdy = (north - south) * 110570 / m
    base = blur(lin, 6)
    by, bx = np.gradient(base, sdy, sdx)
    i0, i1 = int(max(0, math.floor(sx0))), int(min(lin.shape[1], math.ceil(sx1)))
    inner = (slice(pad, pad + m), slice(i0, max(i0 + 1, i1)))
    sl = np.hypot(bx, by)[inner][lin[inner] > 0.5]
    steep = float(np.percentile(sl, 90)) if sl.size else 0.1
    exag = float(np.clip(0.2 / max(steep, 1e-4), 1.5, 10.0))
    e = upsample(blur(lin, 1), box, (out_w, out_h))
    er = upsample(blur(lin, int(round(2 + 1.2 * exag))), box, (out_w, out_h))
    ec = upsample(blur(lin, 20), box, (out_w, out_h))

    land = e > 0.5
    # The ramp over the place's own heights (a low plain still shows its rises), at least 60 m.
    step = max(1, int(math.sqrt(out_w * out_h / 1_000_000)))  # percentiles from a sample: same answer, less sorting
    sample = e[::step, ::step][land[::step, ::step]]
    if sample.size:
        lo = float(np.percentile(sample, 2))
        hi = float(np.percentile(sample, 99))
    else:
        lo, hi = 0.0, 60.0
    hi = max(hi, lo + 60)
    t = np.clip((e - lo) / (hi - lo), 0, 1)
    col = np.empty((out_h, out_w, 3), dtype=np.float32)
    for c in range(3):
        col[..., c] = np.interp(t, [a for a, _ in RAMP], [rgb[c] for _, rgb in RAMP])
    del t

    # Painted texture, the same for the same place: meadow/grass/bare-soil patches (low frequency, hue and value),
    # a meadow mottle (middle) and a fine grain. Sizes in the image's px, a little larger on a big zoomable ground.
    seed = int(hashlib.sha256(json.dumps([round(v, 4) for v in (west, east, south, north)]).encode()).hexdigest()[:16], 16)
    rng = np.random.default_rng(seed)
    k = max(1.0, math.sqrt(out_w / 1920))
    patches = value_noise(rng, out_w, out_h, 320 * k, 3, 0.5)
    soil = np.clip(value_noise(rng, out_w, out_h, 140 * k, 3, 0.5) * 1.4 - 0.55, 0, 1)
    mottle = value_noise(rng, out_w, out_h, 26 * k, 2, 0.5)
    grain = value_noise(rng, out_w, out_h, 1.6, 1)
    green = np.array((-0.03, 0.012, -0.03), dtype=np.float32)  # lusher grass
    earth = np.array((0.035, 0.022, -0.045), dtype=np.float32)  # dry, bare soil
    col *= 1 + patches[..., None] * green + soil[..., None] * earth
    col *= (1 + 0.025 * patches + 0.012 * mottle + 0.022 * grain)[..., None]

    # Hillshade (sun from the north-west, 45° high) on the lifted relief, under a soft light: flat ground keeps the
    # ramp's colour, sunlit slopes warm up, shaded ones go to a cool coloured shadow, never to black.
    dx = (east - west) * 111320 * math.cos(mid) / out_w
    dy = (north - south) * 110570 / out_h
    gy, gx = np.gradient(er, dy, dx)
    del er
    gx *= exag
    gy *= exag
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    del slope, aspect, gx, gy
    d = shade - math.sin(alt)  # 0 on flat ground: the ramp's colour stays as it is there
    d = np.sign(d) * np.maximum(np.abs(d) - 0.015, 0)  # the faintest ripples (data noise) are left unshaded
    lit = np.clip(d * 1.9, 0, 0.45)[..., None]
    dark = np.clip(-d * 1.35, 0, 0.55)[..., None]
    col += (np.array(LIGHT_RGB, dtype=np.float32) - col) * lit
    col += (np.array(SHADOW_RGB, dtype=np.float32) - col) * dark
    del lit, dark, shade, d

    # Contours: an atlas interval for the range, anti-aliased by the distance to the level in px; every fifth
    # line a little stronger; where lines would crowd closer than ~3 px they fade (a cliff is not a black band).
    rng_m = hi - lo
    interval = min(INTERVALS, key=lambda v: abs(rng_m / v - 8))
    f = ec / interval
    cy, cx = np.gradient(f)
    g = np.hypot(cx, cy) + 1e-6
    del cx, cy
    lv = np.round(f)
    dist = np.abs(f - lv) / g
    lw = 0.55 * k
    alpha = np.clip(lw + 0.5 - dist, 0, 1) * np.clip((0.33 - g) / 0.15, 0, 1) * land
    alpha *= np.where(np.mod(lv, 5) == 0, np.float32(0.28), np.float32(0.17))
    col += (np.array(CONTOUR_RGB, dtype=np.float32) - col) * alpha[..., None]

    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(out, quality=92)
    return {"ok": True, "range_m": [round(lo), round(hi)], "out_px": [out_w, out_h], "exag": round(exag, 1), "contour_m": interval}


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
