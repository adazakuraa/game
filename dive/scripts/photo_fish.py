"""Build photo-based fish textures + silhouette profiles from PD/CC0 photos.

usage: python3 -I photo_fish.py <config.json> <out_tex_dir> <out_ts>
config: { id: {file, flip?, rot?, crop?[x0,y0,x1,y1] (fractions), wb?, credit:{...}} }
Writes <id>.webp (RGBA, head to the right) and a TS module with silhouette profiles.
"""
import json, sys, os
import numpy as np, cv2

N = 40  # profile columns


_SESSION = None


def segment(img, crop, method='rembg', thr=9):
    """Foreground mask. rembg (IS-Net, MIT) when installed, GrabCut otherwise; restricted to crop rect."""
    global _SESSION
    h, w = img.shape[:2]
    x0, y0, x1, y1 = crop or [0.0, 0.0, 1.0, 1.0]
    m = None
    if method == 'rembg':
        try:
            from rembg import remove, new_session
            from PIL import Image
            if _SESSION is None:
                _SESSION = new_session('isnet-general-use')
            sub = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
            a = np.array(remove(Image.fromarray(cv2.cvtColor(sub, cv2.COLOR_BGR2RGB)), session=_SESSION, only_mask=True))
            m = np.zeros((h, w), np.uint8)
            m[int(y0 * h):int(y0 * h) + a.shape[0], int(x0 * w):int(x0 * w) + a.shape[1]] = np.where(a > 127, 255, 0)
        except ImportError:
            m = None
    if method == 'paper':
        # naturalist plates: uniform paper background -> Lab distance from the border colour
        sub = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
        lab = cv2.cvtColor(cv2.GaussianBlur(sub, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
        border = np.concatenate([lab[:4].reshape(-1, 3), lab[-4:].reshape(-1, 3), lab[:, :4].reshape(-1, 3), lab[:, -4:].reshape(-1, 3)])
        ref = np.median(border, 0)
        dist = np.linalg.norm((lab - ref) * np.array([0.5, 1.0, 1.0], np.float32), axis=2)
        a = np.where(dist > thr, 255, 0).astype(np.uint8)
        a = cv2.morphologyEx(a, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        m = np.zeros((h, w), np.uint8)
        m[int(y0 * h):int(y0 * h) + a.shape[0], int(x0 * w):int(x0 * w) + a.shape[1]] = a
    if m is None:
        cx0, cy0, cx1, cy1 = crop or [0.04, 0.06, 0.96, 0.94]
        rect = (int(cx0 * w), int(cy0 * h), int((cx1 - cx0) * w), int((cy1 - cy0) * h))
        mask = np.zeros((h, w), np.uint8)
        bg = np.zeros((1, 65), np.float64); fg = np.zeros((1, 65), np.float64)
        cv2.grabCut(img, mask, rect, bg, fg, 6, cv2.GC_INIT_WITH_RECT)
        m = np.where((mask == 1) | (mask == 3), 255, 0).astype(np.uint8)
    # keep largest component, fill holes
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        m = np.where(lab == k, 255, 0).astype(np.uint8)
    inv = 255 - m
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv)
    for k in range(1, n):
        x, y, ww, hh, a = st[k]
        if x > 0 and y > 0 and x + ww < w and y + hh < h:
            m[lab == k] = 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m


def process(cfg, src_img):
    img = src_img
    if cfg.get('rot'):
        h, w = img.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), cfg['rot'], 1.0)
        img = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
    if cfg.get('flip'):
        img = img[:, ::-1].copy()
    if cfg.get('seg') == 'hull':
        # rembg outline + paper-difference pixels inside its convex hull (keeps pale bellies on paper)
        a = segment(img, cfg.get('crop'), 'rembg')
        b = segment(img, cfg.get('crop'), 'paper', cfg.get('thr', 6))
        n, lab, st, _ = cv2.connectedComponentsWithStats(a)
        a = np.where(lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])), 255, 0).astype(np.uint8)
        hull = np.zeros_like(a)
        cv2.fillPoly(hull, [cv2.convexHull(cv2.findNonZero(a))], 255)
        b = cv2.morphologyEx(b & hull, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        m = a | b
    else:
        m = segment(img, cfg.get('crop'), cfg.get('seg', 'rembg'), cfg.get('thr', 9))
    if cfg.get('close'):
        # pale bellies on paper get lost: close the outline, then fill enclosed holes
        k = max(3, int(min(m.shape) * cfg['close']) | 1)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        ff = m.copy(); hh, ww = m.shape
        cv2.floodFill(ff, np.zeros((hh + 2, ww + 2), np.uint8), (0, 0), 255)
        m = m | (255 - ff)
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    img = img[y0:y1, x0:x1]; m = m[y0:y1, x0:x1]
    h, w = m.shape
    # colour: partial white balance on fish pixels + flatten baked lighting
    f = img.astype(np.float32) / 255
    sel = m > 0
    mean = f[sel].mean(0)
    g = mean.mean()
    wb = cfg.get('wb', 0.6)
    f = f * ((g / np.maximum(mean, 1e-3)) ** wb)
    lum = (f @ np.array([0.11, 0.59, 0.3], np.float32))
    lw = cv2.GaussianBlur(np.where(sel, lum, 0), (0, 0), max(w, h) / 10)
    ww = cv2.GaussianBlur(sel.astype(np.float32), (0, 0), max(w, h) / 10)
    low = lw / np.maximum(ww, 1e-3)
    flat = cfg.get('flat', 0.55)
    f = f * ((np.median(lum[sel]) / np.maximum(low, 0.03)) ** flat)[..., None]
    lum2 = f @ np.array([0.11, 0.59, 0.3], np.float32)
    f = np.clip(f * (cfg.get('target', 0.5) / max(1e-3, float(np.median(lum2[sel])))) * cfg.get('gain', 1.0), 0, 1)
    # mild saturation recovery (water strips colour)
    gr = (f @ np.array([0.11, 0.59, 0.3], np.float32))[..., None]
    f = np.clip(gr + (f - gr) * cfg.get('sat', 1.15), 0, 1)
    # bleed colour outward to avoid halos
    out = (f * 255).astype(np.uint8)
    cur = m.copy()
    for _ in range(12):
        dil = cv2.dilate(cur, np.ones((3, 3), np.uint8))
        ring = (dil > 0) & (cur == 0)
        if not ring.any():
            break
        blur = cv2.blur(out * (cur > 0)[..., None], (3, 3)).astype(np.float32)
        wgt = cv2.blur((cur > 0).astype(np.float32), (3, 3))
        out[ring] = (blur[ring] / np.maximum(wgt[ring], 1e-3)[..., None]).astype(np.uint8)
        cur = dil
    # texture size
    TW = 512
    TH = int(min(512, max(64, round(TW * h / w / 8) * 8)))
    tex = cv2.resize(out, (TW, TH), interpolation=cv2.INTER_AREA)
    a = cv2.resize(m, (TW, TH), interpolation=cv2.INTER_AREA)
    a = cv2.GaussianBlur(a, (3, 3), 0)
    rgba = np.dstack([tex, a])
    # profiles: silhouette and fin-less core. The core comes from the distance transform: in each column the
    # largest inscribed circle sits in the body, while fins (thin membranes) never hold a big circle.
    dt = cv2.distanceTransform((m > 0).astype(np.uint8), cv2.DIST_L2, 5)
    dt = cv2.GaussianBlur(dt, (0, 0), max(1.0, w / 200))
    prof = []
    kc = cfg.get('core', 1.15)
    for i in range(N + 1):
        cx = min(w - 1, int(i / N * (w - 1)))
        sl = slice(max(0, cx - 1), min(w, cx + 2))
        col = m[:, sl].max(1) > 0
        idx = np.nonzero(col)[0]
        if len(idx) == 0:
            prof.append([0.5, 0.5, 0.5, 0.5]); continue
        top, bot = 1 - idx.min() / h, 1 - (idx.max() + 1) / h
        d = dt[:, cx]
        yc = int(np.argmax(d)); r = min(float(d[yc]), cfg.get('rmax', 1.0) * h) * kc
        ct = min(top, 1 - (yc - r) / h); cb = max(bot, 1 - (yc + r) / h)
        prof.append([round(top, 3), round(bot, 3), round(ct, 3), round(cb, 3)])
    return rgba, prof, w / h


def main():
    cfgs = json.load(open(sys.argv[1]))
    od = sys.argv[2]
    os.makedirs(od, exist_ok=True)
    res = {}
    for sid, cfg in cfgs.items():
        img = cv2.imread(cfg['file'], cv2.IMREAD_COLOR)
        if img is None:
            print('missing', sid); continue
        sc = 900 / max(img.shape[:2])
        if sc < 1:
            img = cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
        rgba, prof, aspect = process(cfg, img)
        cv2.imwrite(f'{od}/{sid}.webp', rgba, [cv2.IMWRITE_WEBP_QUALITY, 82])
        res[sid] = {'aspect': round(aspect, 3), 'prof': prof}
        print(sid, rgba.shape, round(aspect, 2), flush=True)
    if len(sys.argv) > 3:
        with open(sys.argv[3], 'w') as fh:
            fh.write('// generated by scripts/photo_fish.py: silhouette profiles [top, bottom, coreTop, coreBottom] (0..1, head at the end)\n')
            fh.write('export const PHOTO_PROFILES: Record<string, { aspect: number; prof: number[][] }> = ')
            fh.write(json.dumps(res, separators=(',', ':')))
            fh.write(';\n')


if __name__ == '__main__':
    main()
