"""Bake tileable surface textures for BLUE DEPTHS (no external services).

Each output is an RGBA PNG: RGB = tangent-space normal map, A = albedo detail (0..1).
Run: python3 scripts/gen_textures.py  -> src/assets/tex/*.png
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)


def fft_noise(n, beta, seed, lo=1.0, hi=None):
    """Tileable 1/f^beta noise via FFT (periodic by construction). Returns 0..1."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1
    amp = 1.0 / r ** (beta / 2)
    amp[r < lo] = 0
    if hi:
        amp *= np.exp(-((r / hi) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    out -= out.min()
    return out / out.max()


def worley(n, cells, seed):
    """Tileable Worley noise: returns (F1, F2, cell_id) in cell units."""
    rng = np.random.default_rng(seed)
    pts = rng.random((cells, cells, 2))
    ids = rng.random((cells, cells))
    y, x = np.mgrid[0:n, 0:n] / n * cells
    cx = np.floor(x).astype(int)
    cy = np.floor(y).astype(int)
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    cid = np.zeros((n, n))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            gx = cx + dx
            gy = cy + dy
            p = pts[gy % cells, gx % cells]
            px = gx + p[..., 0]
            py = gy + p[..., 1]
            d = np.sqrt((px - x) ** 2 + (py - y) ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids[gy % cells, gx % cells], cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def blur(a, k=1):
    out = a.copy()
    for _ in range(k):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5
    return out


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx ** 2 + dy ** 2 + nz ** 2)
    return np.stack([-dx / l, dy / l, nz / l], -1)


def save(name, h, albedo, strength):
    nm = normal_map(h, strength)
    rgba = np.zeros(h.shape + (4,), np.uint8)
    rgba[..., :3] = np.clip((nm * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(albedo * 255, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, name + '.png'), optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name + '.png')) // 1024, 'KB')


def sand(n=512):
    rng = np.random.default_rng(1)
    grains = blur(rng.random((n, n)), 1)
    fine = fft_noise(n, 1.4, 2, lo=8)
    mid = fft_noise(n, 2.6, 3, lo=1.5)
    # small wind/current ripplets (tileable: integer wave counts)
    y, x = np.mgrid[0:n, 0:n] / n
    warp = (fft_noise(n, 3.0, 4, lo=1) - 0.5) * 1.2
    rip = 0.5 + 0.5 * np.sin(2 * np.pi * (x * 9 + y * 2) + warp * 6)
    rip = rip ** 1.8
    # shell fragments and pebbles
    f1, f2, cid = worley(n, 22, 5)
    shells = np.where(cid > 0.86, np.clip(1 - f1 / 0.22, 0, 1), 0)
    dark = np.where((cid < 0.08), np.clip(1 - f1 / 0.12, 0, 1), 0)
    h = mid * 0.9 + rip * 0.45 + grains * 0.25 + fine * 0.25 + shells * 0.5 - dark * 0.2
    alb = 0.72 + (grains - 0.5) * 0.28 + (fine - 0.5) * 0.15 + (mid - 0.5) * 0.12 + shells * 0.22 - dark * 0.35
    # trough darkening (finer, darker grains collect in ripple troughs)
    alb -= (1 - rip) * 0.06
    save('sand', h, np.clip(alb, 0, 1), 6.0)


def rock(n=512):
    base = fft_noise(n, 2.4, 11, lo=1)
    mid = fft_noise(n, 2.0, 12, lo=3)
    ridged = 1 - np.abs(fft_noise(n, 2.2, 16, lo=2) * 2 - 1)
    f1, f2, cid = worley(n, 9, 13)
    mask = fft_noise(n, 3.0, 17, lo=1) > 0.55
    cracks = np.where(mask, np.clip((f2 - f1) / 0.035, 0, 1), 1.0)
    g1, g2, gid = worley(n, 30, 14)
    pits = np.clip(1 - g1 / 0.3, 0, 1) ** 2 * (gid > 0.6)
    rng = np.random.default_rng(15)
    grit = blur(rng.random((n, n)), 1)
    fine = fft_noise(n, 1.2, 18, lo=12)
    h = base * 1.1 + ridged * 0.45 + mid * 0.35 - (1 - cracks) * 0.35 - pits * 0.35 + grit * 0.1 + fine * 0.15
    cav = blur(h, 5) - h
    alb = 0.6 + (mid - 0.5) * 0.35 + (ridged - 0.5) * 0.15 - np.clip(cav * 3.5, 0, 0.3) - (1 - cracks) * 0.2 - pits * 0.18 + (grit - 0.5) * 0.14
    save('rock', h, np.clip(alb, 0, 1), 5.0)


def polyps(n=256):
    f1, f2, cid = worley(n, 18, 21)
    walls = 1 - np.clip((f2 - f1) / 0.16, 0, 1)
    cup = np.clip(1 - f1 / 0.45, 0, 1) ** 1.5
    rng = np.random.default_rng(22)
    grit = blur(rng.random((n, n)), 1)
    h = walls * 0.8 - cup * 0.45 + grit * 0.08
    alb = 0.62 + walls * 0.3 - cup * 0.35 + (cid - 0.5) * 0.08
    save('polyp', h, np.clip(alb, 0, 1), 6.0)


def brain(n=256):
    a = fft_noise(n, 3.0, 31, lo=2, hi=10)
    b = fft_noise(n, 3.0, 32, lo=2, hi=10)
    v = np.sin((a * 7 + b * 4) * np.pi * 2)
    ridge = np.abs(v)
    groove = 1 - ridge
    h = ridge ** 0.5 + fft_noise(n, 1.2, 33, lo=12) * 0.08
    alb = 0.5 + ridge * 0.45 - groove ** 3 * 0.2
    save('brain', h, np.clip(alb, 0, 1), 5.0)


if __name__ == '__main__':
    sand()
    rock()
    polyps()
    brain()
