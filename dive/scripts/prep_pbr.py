"""Prepare CC0 PBR textures (Poly Haven, https://polyhaven.com, CC0) for the game.

Usage: python3 scripts/prep_pbr.py <download_dir>
Writes src/assets/tex/pbr_<name>_a.jpg (albedo, mean-normalised so vertex/instance colour drives hue)
and pbr_<name>_n.jpg (OpenGL normal map), 512x512, tileable.
"""
import os, sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'tex')
SETS = {
    'sand': ('aerial_sand', 0.25),       # (source id, saturation kept)
    'rubble': ('coral_gravel', 0.45),
    'reef': ('coral_ground_02', 0.55),
    'rock': ('seaside_rock', 0.35),
    'rust': ('rusty_metal_02', 1.0),
}
for name, (sid, sat) in SETS.items():
    a = np.asarray(Image.open(os.path.join(SRC, f'{sid}_diff.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)).astype(np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    a = lum[..., None] + (a - lum[..., None]) * sat           # keep a little natural colour variation
    a = a / max(1e-3, a.mean()) * 0.5                          # mean 0.5 -> shader multiplies by 2
    # widen local contrast a touch so detail survives water fog
    a = np.clip(0.5 + (a - 0.5) * 1.25, 0, 1)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(OUT, f'pbr_{name}_a.jpg'), quality=86, optimize=True)
    n = Image.open(os.path.join(SRC, f'{sid}_nor_gl.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
    n.save(os.path.join(OUT, f'pbr_{name}_n.jpg'), quality=90, optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, f'pbr_{name}_a.jpg')) // 1024, os.path.getsize(os.path.join(OUT, f'pbr_{name}_n.jpg')) // 1024, 'KB')
