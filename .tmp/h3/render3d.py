import numpy as np, math, time
from PIL import Image

t0 = time.time()
sd_px = np.load(".tmp/h3/emblem_sd.npy")
rgb = np.load(".tmp/h3/emblem_rgb.npy")
ch, cw = sd_px.shape
S = cw / 2.0
sd_obj = sd_px / S

W, H = 1440, 2560
FOV_V, THETA_DEG, PHI_DEG = 35.0, 30.0, 8.0
HALF_T, BEVEL, CAM_D, OBJ_Y, EPS = 0.048, 0.007, 7.69, -1.067, 0.0012

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
    # texture rows run top->bottom, object +Y is up  -> flip the row axis
    fx = x * S + cw / 2.0
    fy = -y * S + ch / 2.0
    # outside the grid the true distance is at least the distance to the grid edge
    dx = np.maximum(np.maximum(-fx, fx - (cw - 1)), 0.0)
    dy = np.maximum(np.maximum(-fy, fy - (ch - 1)), 0.0)
    outside = np.sqrt(dx * dx + dy * dy) / S
    d2 = bil(sd_obj, fx, fy) + outside
    dz = np.abs(z) - HALF_T
    m = np.maximum(d2, dz)
    return (np.linalg.norm(np.maximum(m[..., None], 0), axis=-1)
            + np.minimum(m, 0) - BEVEL)

tan_h = math.tan(math.radians(FOV_V) / 2)
tan_w = tan_h * (W / H)   # horizontal tangent = vertical * (W/H)
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
obj_c = np.array([0.0, OBJ_Y, 0.0])
rd_o = rd_w @ Rt
ro_o = (ro_w - obj_c) @ Rt

t = np.zeros((H, W))
alive = np.ones((H, W), dtype=bool)
hitmask = np.zeros((H, W), dtype=bool)
tmax = 14.0
for i in range(140):
    q = ro_o + rd_o * t[..., None]
    d = sd3(q[..., 0], q[..., 1], q[..., 2])
    hit = alive & (d < EPS)
    hitmask |= hit
    alive &= ~hit
    t = np.where(alive, t + np.maximum(d, EPS * 0.5), t)
    alive &= (t <= tmax)
    if not alive.any():
        break
print("march steps", i + 1, "%.1fs" % (time.time() - t0))
t = np.where(hitmask, t, np.inf)
print("hit frac %.3f" % hitmask.mean())

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
n_o = nrm(q[:, 0], q[:, 1], q[:, 2])
n_w = n_o @ Rt
v_w = ro_w - p_w
v_w /= np.linalg.norm(v_w, axis=-1, keepdims=True)

tx = np.clip(q[:, 0] * S + cw / 2.0, 0, cw - 1)
ty = np.clip(-q[:, 1] * S + ch / 2.0, 0, ch - 1)
base = bil(rgb, tx, ty) / 255.0

def L(v):
    v = np.array(v); return v / np.linalg.norm(v)
l1 = L([-0.55, 0.72, 0.45]); l2 = L([0.72, -0.28, 0.38]); l3 = L([0.42, 0.55, -0.78])
n1 = np.clip((n_w * l1).sum(-1), 0, 1)
n2 = np.clip((n_w * l2).sum(-1), 0, 1)
n3 = np.clip((n_w * l3).sum(-1), 0, 1)
nv = np.clip((n_w * v_w).sum(-1), 0, 1)
h1 = l1 + v_w; h1 /= np.linalg.norm(h1, axis=-1, keepdims=True)
h2 = l3 + v_w; h2 /= np.linalg.norm(h2, axis=-1, keepdims=True)
s1 = np.clip((n_w * h1).sum(-1), 0, 1) ** 46
s2 = np.clip((n_w * h2).sum(-1), 0, 1) ** 190

AMB = np.array([0.26, 0.27, 0.33])
diff = base * (AMB + 1.35 * n1[..., None] * np.array([1.0, 0.98, 0.93])
               + 0.30 * n2[..., None] * np.array([0.72, 0.80, 1.0]))
spec = base * (s1[..., None] * 1.25) + np.array([1.0, 0.99, 0.95]) * (s2[..., None] * 2.9)
rim = (1.0 - nv) ** 4 * np.clip((n_w * l3).sum(-1) * 0.5 + 0.5, 0, 1)
col = np.clip(diff + spec + np.array([0.62, 0.78, 1.0]) * rim[..., None] * 0.30, 0, 1) ** (1 / 1.05)

yy = np.linspace(0, 1, H)[:, None, None]
bg = (np.array([0.055, 0.062, 0.085]) * (1 - yy) + np.array([0.012, 0.014, 0.020]) * yy)
bg = np.repeat(bg, W, axis=1)
gx = (px - W / 2) / (W * 0.52); gy = (py - H * 0.62) / (H * 0.30)
bg += np.exp(-(gx ** 2 + gy ** 2) * 1.6)[..., None] * np.array([0.050, 0.072, 0.052])
# tight money-green bloom behind the star, the energy about to ignite
sx2 = (px - W * 0.455) / (W * 0.16); sy2 = (py - H * 0.555) / (H * 0.10)
bg += np.exp(-(sx2 ** 2 + sy2 ** 2) * 1.25)[..., None] * np.array([0.030, 0.085, 0.040])
vign = 1 - 0.42 * (((px - W / 2) / (W / 2)) ** 2 + ((py - H / 2) / (H / 2)) ** 2)
bg = np.clip(bg * np.clip(vign, 0, 1)[..., None], 0, 1)

out = bg.reshape(-1, 3)
out[idx] = col
img = (out.reshape(H, W, 3) * 255).astype(np.uint8)
Image.fromarray(img).save("prepared-media/outrider-emblem-3d-firstframe.jpg", quality=97, subsampling=0)
print("saved", img.shape, "%.1fs" % (time.time() - t0))
