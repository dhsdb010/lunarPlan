"""Cut a square height tile out of a LOLA 5 m/px South Pole GeoTIFF.

Output format (engine-independent, read by renderer and flight core alike):
  <name>.f32   little-endian float32, row-major, N x N samples, metres above tile datum
  <name>.json  metadata: size, spacing, datum, source window, slope stats

Usage:
  python extract_tile.py SRC.tif OUT_DIR --size-m 2000 [--center-px X Y | --flattest]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import tifffile

SPACING_M = 5.0  # LOLA 5mpp products


def slope_deg(h, spacing):
    gy, gx = np.gradient(h, spacing)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def find_flattest(dem, n, stride):
    """Window (top-left px) whose 95th-percentile slope is lowest; ignores nodata."""
    best = None
    for y in range(0, dem.shape[0] - n, stride):
        for x in range(0, dem.shape[1] - n, stride):
            w = dem[y:y + n, x:x + n]
            if not np.isfinite(w).all():
                continue
            p95 = float(np.percentile(slope_deg(w, SPACING_M)[::4, ::4], 95))
            if best is None or p95 < best[0]:
                best = (p95, x, y)
    return best[1], best[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out_dir")
    ap.add_argument("--size-m", type=float, default=2000)
    ap.add_argument("--center-px", type=int, nargs=2)
    ap.add_argument("--flattest", action="store_true")
    ap.add_argument("--name", default="tile")
    a = ap.parse_args()

    with tifffile.TiffFile(a.src) as tf:
        dem = tf.pages[0].asarray().astype(np.float64)
        tags = {t.name: t.value for t in tf.pages[0].tags.values()}
    dem[dem < -1e30] = np.nan

    n = int(round(a.size_m / SPACING_M)) + 1  # samples incl. both edges
    if a.center_px:
        x0, y0 = a.center_px[0] - n // 2, a.center_px[1] - n // 2
    elif a.flattest:
        x0, y0 = find_flattest(dem, n, stride=n // 4)
    else:
        x0, y0 = (dem.shape[1] - n) // 2, (dem.shape[0] - n) // 2

    h = dem[y0:y0 + n, x0:x0 + n]
    assert np.isfinite(h).all(), "window contains nodata"
    datum = float(h.min())
    rel = (h - datum).astype("<f4")

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rel.tofile(out / f"{a.name}.f32")

    s = slope_deg(h, SPACING_M)
    tie = tags.get("ModelTiepointTag")
    meta = {
        "format": "f32le-rowmajor",
        "samples": n,
        "spacing_m": SPACING_M,
        "size_m": (n - 1) * SPACING_M,
        "datum_m": datum,
        "relief_m": float(rel.max()),
        "slope_deg": {"mean": float(s.mean()), "p95": float(np.percentile(s, 95)), "max": float(s.max())},
        "source": {
            "file": Path(a.src).name,
            "window_px": [int(x0), int(y0), n, n],
            "polar_stereo_tiepoint": list(tie) if tie is not None else None,
            "reference": "LOLA 5 m/px South Pole DEM, Barker et al. 2021, PSS 203, 105119",
        },
    }
    (out / f"{a.name}.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
