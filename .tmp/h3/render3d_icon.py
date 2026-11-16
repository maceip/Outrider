import numpy as np, math, time, sys
from PIL import Image

t0 = time.time()
sd_px = np.load(".tmp/h3/emblem_sd.npy")
rgb = np.load(".tmp/h3/emblem_rgb.npy")
ch, cw = sd_px.shape
S = cw / 2.0
sd_obj = sd_px / S

W = H = 1024                      # square app-icon frame
FOV_V = 34.0
THETA_DEG, PHI_DEG = 32.0, 8.0    # vertical-axis turn, slight tilt
HALF_T, BEVEL = 0.052, 0.008
CAM_D, OBJ_Y, EPS = 4.95, 0.0, 0.0012
SAT_BOOST = 1.02                  # keep original chroma; do not acidify

def bil(arr, fx, fy):
    h, w = arr.shape[:2]
    ix = np.floor(fx); iy = np.floor(fy)
    x0 = np.clip(ix.astype(np.int32), 0, w - 1); x1 = np.clip(x0 + 1, 0, w - 1)
    y0 = np.clip(iy.astype(np.int32), 0, h - 1); y1 = np.clip(y0 + 1, 0, h - 1)
    wx = (fx - ix)[..., None] if arr.ndim == 3 else (fx - ix)
    wy = (fy - iy)[..., None] if arr.ndim == 3 else (fy - iy)
    return (arr[y0, x0] * (1 - wx) * (1 - wy) + arr[y0, x1] * wx * (1 - wy)
            + arr[y1, x0] * (1 - wx) * wy + arr[y1, x1] * wx * wy)

def sd3(x, y, z):
    fx = x * S + cw / 2.0
    fy = -y * S + ch / 2.0
    dx = np.maximum(np.maximum(-fx, fx - (cw - 1)), 0.0)
    dy = np.maximum(np.maximum(-fy, fy - (ch - 1)), 0.0)
    d2 = bil(sd_obj, fx, fy) + np.sqrt(dx * dx + dy * dy) / S
    dz = np.abs(z) - HALF_T
    m = np.maximum(d2, dz)
    return (np.linalg.norm(np.maximum(m[..., None], 0), axis=-1)
            + np.minimum(m, 0) - BEVEL)

tan_h = math.tan(math.radians(FOV_V) / 2)
tan_w = tan_h * (W / H)
px, py = np.meshgrid(np.arange(W), np.arange(H))
sx = (px - W / 2) / W * 2 * tan_w
sy = (H / 2 - py) / H * 2 * tan_h
rd_w = np.stack([sx, sy, -np.ones_like(sx)], axis=-1)
rd_w /= np.linalg.norm(rd_w, axis=-1, keepdims=True)
ro_w = np.array([0.0, 0.0, CAM_D])

THETA, PHI = math.radians(THETA_DEG), math.radians(PHI_DEG)
ct, st = math.cos(THETA), math.sin(THETA)
cp, sp = math.cos(PHI), math.sin(PHI)
R = np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]]) @ np.array([[ct,0,st],[0,1,0],[-st,0,ct]])
Rt = R.T
rd_o = rd_w @ Rt
ro_o = (ro_w - np.array([0.0, OBJ_Y, 0.0])) @ Rt

t = np.zeros((H, W)); alive = np.ones((H, W), bool); hitmask = np.zeros((H, W), bool)
for i in range(140):
    q = ro_o + rd_o * t[..., None]
    d = sd3(q[..., 0], q[..., 1], q[..., 2])
    hit = alive & (d < EPS)
    hitmask |= hit
    alive &= ~hit
    t = np.where(alive, t + np.maximum(d, EPS * 0.5), t)
    alive &= (t <= 14.0)
    if not alive.any():
        break
print("march", i + 1, "hit frac %.3f" % hitmask.mean(), "%.1fs" % (time.time() - t0))
t = np.where(hitmask, t, np.inf)
idx = np.nonzero(hitmask.ravel())[0]
tflat = t.ravel()[idx]
q = (ro_o + rd_o * t[..., None]).reshape(-1, 3)[idx]
p_w = ro_w + rd_w.reshape(-1, 3)[idx] * tflat[:, None]

e = 0.0015
def nrm(qx, qy, qz):
    nx = sd3(qx + e, qy, qz) - sd3(qx - e, qy, qz)
    ny = sd3(qx, qy + e, qz) - sd3(qx, qy - e, qz)
    nz = sd3(qx, qy, qz + e) - sd3(qx, qy, qz - e)
    v = np.stack([nx, ny, nz], axis=-1)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)
n_o = nrm(q[:, 0], q[:, 1], q[:, 2]); n_w = n_o @ Rt
v_w = ro_w - p_w; v_w /= np.linalg.norm(v_w, axis=-1, keepdims=True)

tx = np.clip(q[:, 0] * S + cw / 2.0, 0, cw - 1)
ty = np.clip(-q[:, 1] * S + ch / 2.0, 0, ch - 1)
base = bil(rgb, tx, ty) / 255.0
lum0 = base.mean(axis=-1, keepdims=True)
base = np.clip(lum0 + (base - lum0) * SAT_BOOST, 0, 1)   # deepen the gold chroma

def L(v):
    v = np.array(v); return v / np.linalg.norm(v)
l1 = L([-0.50, 0.68, 0.53]); l2 = L([0.75, -0.20, 0.42]); l3 = L([0.35, 0.50, -0.79])
n1 = np.clip((n_w * l1).sum(-1), 0, 1); n2 = np.clip((n_w * l2).sum(-1), 0, 1)
n3 = np.clip((n_w * l3).sum(-1), 0, 1); nv = np.clip((n_w * v_w).sum(-1), 0, 1)
h1 = l1 + v_w; h1 /= np.linalg.norm(h1, axis=-1, keepdims=True)
h2 = l3 + v_w; h2 /= np.linalg.norm(h2, axis=-1, keepdims=True)
s1 = np.clip((n_w * h1).sum(-1), 0, 1) ** 60
s2 = np.clip((n_w * h2).sum(-1), 0, 1) ** 220

AMB = np.array([0.26, 0.26, 0.28])          # studio environment, not a wash
diff = base * (AMB + 1.15 * n1[..., None] * np.array([1.0, 0.97, 0.88])
               + 0.34 * n2[..., None] * np.array([0.85, 0.88, 1.0]))
spec = base * (s1[..., None] * 1.5) + np.array([1.0, 0.98, 0.93]) * (s2[..., None] * 3.4)
rim = (1.0 - nv) ** 4 * np.clip((n_w * l3).sum(-1) * 0.5 + 0.5, 0, 1)
col = np.clip(diff + spec + np.array([0.75, 0.85, 1.0]) * rim[..., None] * 0.40, 0, 1) ** (1 / 1.02)

bg = np.ones((H, W, 3))                      # pure white plate for chroma keying
out = bg.reshape(-1, 3); out[idx] = col
img = (out.reshape(H, W, 3) * 255).astype(np.uint8)
Image.fromarray(img).save("prepared-media/outrider-emblem-3d-icon-plate.jpg", quality=97, subsampling=0)

m = img.reshape(-1, 3).astype(float)
sel = m.mean(axis=1) < 250
print("emblem mean RGB:", m[sel].mean(axis=0).round(1))
mm = m[sel]
print("saturation (max-min) mean:", (mm.max(axis=1) - mm.min(axis=1)).mean().round(1))
print("blue channel mean:", mm[:, 2].mean().round(1))
ys, xs = np.nonzero(img.mean(axis=2) < 250)
print("emblem bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max(),
      "-> %.0f%% wide" % (100 * (xs.max() - xs.min()) / W))
print("done %.1fs" % (time.time() - t0))
