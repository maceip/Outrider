import numpy as np, json
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = "/Users/mac/.minimax/v2/assets/2026/11/15/11-44-31-261-asset_20261115-114431-261_7da3da62d765_442429d4-outrider-logo-olive-subtle-shine.jpg"
M_PATH = ".tmp/h3/M.npy"

# ---------- 1. matte + texture extraction (logo only, shadows excluded) ----------
im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(np.float64)
H, W, _ = a.shape
M = np.load(M_PATH)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
colormask = ((g - b) > 20) & (r > 50)
lum = lambda z: 0.2126 * z[..., 0] + 0.7152 * z[..., 1] + 0.0722 * z[..., 2]
alpha = np.clip((lum(a) - lum(M) - 12.0) / 16.0, 0, 1)
alpha[~colormask] = 0.0
lab, n = ndimage.label(alpha > 0.5)
sizes = ndimage.sum(alpha > 0.5, lab, range(1, n + 1))
keep = [i + 1 for i, s in enumerate(sizes) if s > 4000]
mask = ndimage.binary_fill_holes(np.isin(lab, keep))
alpha = ndimage.maximum_filter(alpha * mask, size=3)
al = alpha[..., None]
F = np.clip(np.where(al > 0.20, (a - (1 - al) * M) / np.maximum(al, 1e-6), a), 0, 255)

ys, xs = np.nonzero(mask)
pad = 24
x0, x1 = max(0, xs.min() - pad), min(W - 1, xs.max() + pad)
y0, y1 = max(0, ys.min() - pad), min(H - 1, ys.max() + pad)
cropA = alpha[y0:y1 + 1, x0:x1 + 1]
cropF = F[y0:y1 + 1, x0:x1 + 1]
ch, cw = cropA.shape

# ---------- 2b. flatten the photo's baked-in lighting into uniform albedo ----------
# fit log-LUMINANCE plane over the logo and divide it out with a SCALAR, so the
# gold->olive variety and the chroma relationships survive untouched
op = cropA > 0.9
chh, cww = cropA.shape
yy2, xx2 = np.mgrid[0:chh, 0:cww].astype(np.float64)
X = (xx2 - cww / 2) / (cww / 2); Y = (yy2 - chh / 2) / (chh / 2)
lumT = 0.2126 * cropF[..., 0] + 0.7152 * cropF[..., 1] + 0.0722 * cropF[..., 2]
A = np.stack([np.ones_like(X), X, Y], axis=-1)[op]
coef, *_ = np.linalg.lstsq(A, np.log(np.maximum(lumT[op], 1.0)), rcond=None)
illum = np.exp(coef[0] + coef[1] * X + coef[2] * Y)          # scalar field
flat = cropF / np.maximum(illum, 1e-3)[..., None]            # scalar divide: hue preserved
flat = np.clip(flat, 0, 255)
m0 = flat[op].mean()
flat *= (150.0 / max(m0, 1e-3))
flat = np.clip(flat, 0, 255)
print("albedo plane coef", np.round(coef, 4), "mean albedo", round(flat[op].mean(), 1))
mm = flat[op]
print("albedo mean RGB", mm.mean(axis=0).round(1),
      "sat", round((mm.max(axis=1) - mm.min(axis=1)).mean(), 1))

cropF = flat

# ---------- 2. signed distance field of the 2D emblem shape ----------
solid = cropA > 0.5
d_in = ndimage.distance_transform_edt(solid)      # distance to background, inside
d_out = ndimage.distance_transform_edt(~solid)    # distance to logo, outside
sd = d_out - d_in                                # negative inside
sd[~solid] = sd[~solid]
EXT = 0.18          # extra margin in object units
sd = ndimage.gaussian_filter(sd, 0.6)
np.save(".tmp/h3/emblem_sd.npy", sd)
np.save(".tmp/h3/emblem_rgb.npy", cropF)
np.save(".tmp/h3/emblem_a.npy", cropA)
print("emblem grid", sd.shape, "inside px", solid.sum())
ys2, xs2 = np.nonzero(sd < 0)
print("sdf extent rows", ys2.min(), ys2.max(), "cols", xs2.min(), xs2.max())
