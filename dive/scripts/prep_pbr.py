"""Prepare CC0 PBR textures (Poly Haven, https://polyhaven.com, CC0) for the game.

Usage: python3 scripts/prep_pbr.py <download_dir> [--jpeg-quality 75]
       python3 scripts/prep_pbr.py --recompress <tex_dir> [--jpeg-quality 75] [--webp-quality 85]
                                    [--alpha-quality 75] [--only NAME ...]
Writes src/assets/tex/pbr_<name>_a.jpg (albedo, mean-normalised so vertex/instance colour drives hue)
and pbr_<name>_n.jpg (OpenGL normal map), 512x512, tileable.

--recompress needs no downloads: it re-encodes the *.jpg and *.webp files found in <tex_dir> into
src/assets/tex under the same names. Re-encoding is lossy and adds up, so <tex_dir> should hold the files
from before the last recompression (e.g. taken out of git history), not the current output.
To give one file its quality back, pass --only NAME with a higher quality.
"""
import argparse, io, os
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('src', help='download dir, or with --recompress the dir holding the files to re-encode')
ap.add_argument('--recompress', action='store_true')
ap.add_argument('--jpeg-quality', type=int, default=75)
ap.add_argument('--webp-quality', type=int, default=85)
ap.add_argument('--alpha-quality', type=int, default=75, help='WebP alpha (the albedo detail of sand/polyp/brain)')
ap.add_argument('--only', nargs='+', help='file names to re-encode (default: all)')
args = ap.parse_args()
SRC = args.src
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'tex')
SETS = {
    'sand': ('aerial_sand', 0.25),       # (source id, saturation kept)
    'rubble': ('coral_gravel', 0.45),
    'reef': ('coral_ground_02', 0.55),
    'rock': ('seaside_rock', 0.35),
    'rust': ('rusty_metal_02', 1.0),
}


def recompress():
    for f in sorted(args.only or os.listdir(SRC)):
        ext = os.path.splitext(f)[1]
        if ext not in ('.jpg', '.webp'):
            continue
        im = Image.open(os.path.join(SRC, f))
        im.load()
        buf = io.BytesIO()
        if ext == '.jpg':
            im.save(buf, 'JPEG', quality=args.jpeg_quality, optimize=True)
        else:
            # exact: RGB is a normal map, so keep it even where alpha is 0
            im.save(buf, 'WEBP', quality=args.webp_quality, alpha_quality=args.alpha_quality, method=6, exact=True)
        before = os.path.getsize(os.path.join(SRC, f))
        with open(os.path.join(OUT, f), 'wb') as out:
            out.write(buf.getvalue())
        print(f, before, '->', len(buf.getvalue()), 'bytes')


if args.recompress:
    recompress()
    raise SystemExit

for name, (sid, sat) in SETS.items():
    a = np.asarray(Image.open(os.path.join(SRC, f'{sid}_diff.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)).astype(np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    a = lum[..., None] + (a - lum[..., None]) * sat           # keep a little natural colour variation
    a = a / max(1e-3, a.mean()) * 0.5                          # mean 0.5 -> shader multiplies by 2
    # widen local contrast a touch so detail survives water fog
    a = np.clip(0.5 + (a - 0.5) * 1.25, 0, 1)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(OUT, f'pbr_{name}_a.jpg'), quality=args.jpeg_quality, optimize=True)
    n = Image.open(os.path.join(SRC, f'{sid}_nor_gl.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
    n.save(os.path.join(OUT, f'pbr_{name}_n.jpg'), quality=args.jpeg_quality, optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, f'pbr_{name}_a.jpg')) // 1024, os.path.getsize(os.path.join(OUT, f'pbr_{name}_n.jpg')) // 1024, 'KB')
