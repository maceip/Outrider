"""Render the app-icon spin as a real 3D animation.

The H3 route was measured at ~0.2 rev/s with the metal blowing out to grey on
every edge-on pass, and the model cannot count revolutions so it lands at an
arbitrary angle. Rendering it directly makes the rate and the final pose exact
by construction: the spin profile is normalised so the total turns is an exact
integer number of revolutions, which guarantees the emblem stops facing the
camera.
"""
import numpy as np, math, time, os, sys
from PIL import Image

RENDER = 640          # supersampled source, downsampled to 512 at encode time
OUT = 512
FPS = 30
DUR = 6.0
REVOLUTIONS = 6       # integer -> ends exactly facing the camera
SHUTTER = 0.020       # seconds of exposure -> tight real rotational blur
SUBSAMPLES = 4
FOV_V, HALF_T, BEVEL = 34.0, 0.052, 0.008
CAM_D, EPS = 4.95, 0.0012

sd_px = np.load(".tmp/h3/emblem_sd.npy")
rgb = np.load(".tmp/h3/emblem_rgb.npy")
ch, cw = sd_px.shape
S = cw / 2.0
sd_obj = sd_px / S
W = H = RENDER

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

# ---------- spin profile: normalised velocity, integer total revolutions ----------
def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)

T_START, T_UP, T_PLATEAU, T_DOWN, T_STOP = 0.30, 0.55, 3.00, 2.00, 5.00

def vel_norm(t):
    up = smoothstep((t - T_START) / T_UP)
    down = 1.0 - smoothstep((t - T_PLATEAU) / T_DOWN)
    return up * down

_ts = np.linspace(0, DUR, 20001)
_vs = vel_norm(_ts)
INTEG = np.trapezoid(_vs, _ts)
print("profile integral %.4f s -> peak rate %.2f rev/s" % (INTEG, REVOLUTIONS / INTEG))

def angle_deg(t):
    """total rotation in degrees, ends on an exact multiple of 360"""
    grid = np.linspace(0, t, max(int(t * 4000), 2) + 1)
    return 360.0 * REVOLUTIONS * np.trapezoid(vel_norm(grid), grid) / INTEG

def render(theta_deg, phi_deg):
    tan_h = math.tan(math.radians(FOV_V) / 2)
    tan_w = tan_h * (W / H)
    px, py = np.meshgrid(np.arange(W), np.arange(H))
    sx = (px - W / 2) / W * 2 * tan_w
    sy = (H / 2 - py) / H * 2 * tan_h
    rd_w = np.stack([sx, sy, -np.ones_like(sx)], axis=-1)
    rd_w /= np.linalg.norm(rd_w, axis=-1, keepdims=True)
    ro_w = np.array([0.0, 0.0, CAM_D])
    THETA, PHI = math.radians(theta_deg), math.radians(phi_deg)
    ct, st = math.cos(THETA), math.sin(THETA)
    cp, sp = math.cos(PHI), math.sin(PHI)
    R = np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]]) @ np.array([[ct,0,st],[0,1,0],[-st,0,ct]])
    Rt = R.T
    rd_o = rd_w @ Rt
    ro_o = ro_w @ Rt

    # slab intersection: the solid only occupies a thin slab in z
    half = HALF_T + BEVEL + 0.01
    dz = rd_o[..., 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        ta = (-half - ro_o[2]) / dz
        tb = (half - ro_o[2]) / dz
    t_enter = np.nanmin(np.stack([ta, tb]), axis=0)
    t_exit = np.nanmax(np.stack([ta, tb]), axis=0)
    t_enter = np.where(np.isfinite(t_enter), t_enter, 0.0)
    t_exit = np.where(np.isfinite(t_exit), t_exit, 1e9)

    t = np.maximum(t_enter, 0.0)
    alive = np.ones((H, W), bool)
    hitmask = np.zeros((H, W), bool)
    # index-based march: only evaluate live rays, they die off fast
    t_flat = t.ravel().copy()
    exit_flat = t_exit.ravel()
    live = np.arange(H * W)
    for _ in range(90):
        if live.size == 0:
            break
        q = ro_o.reshape(1, 3) + rd_o.reshape(-1, 3)[live] * t_flat[live][:, None]
        d = sd3(q[:, 0], q[:, 1], q[:, 2])
        hit = d < EPS
        if hit.any():
            hitmask.ravel()[live[hit]] = True
        keep = ~hit
        live = live[keep]
        if live.size == 0:
            break
        t_flat[live] += np.maximum(d[keep], EPS * 0.4)
        live = live[t_flat[live] <= exit_flat[live]]
    hitmask &= (t_flat <= exit_flat).reshape(H, W)
    t = np.where(hitmask.ravel(), t_flat, np.inf).reshape(H, W)
    idx = np.nonzero(hitmask.ravel())[0]
    if len(idx) == 0:
        return np.ones((H * W, 3)), np.zeros((H * W,))
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
    n_w = nrm(q[:, 0], q[:, 1], q[:, 2]) @ Rt
    v_w = ro_w - p_w; v_w /= np.linalg.norm(v_w, axis=-1, keepdims=True)
    tx = np.clip(q[:, 0] * S + cw / 2.0, 0, cw - 1)
    ty = np.clip(-q[:, 1] * S + ch / 2.0, 0, ch - 1)
    base = bil(rgb, tx, ty) / 255.0
    lum0 = base.mean(axis=-1, keepdims=True)
    base = np.clip(lum0 + (base - lum0) * 1.02, 0, 1)
    def L(v):
        v = np.array(v); return v / np.linalg.norm(v)
    l1 = L([-0.50, 0.68, 0.53]); l2 = L([0.82, -0.12, 0.40]); l3 = L([0.35, 0.50, -0.79])
    n1 = np.clip((n_w * l1).sum(-1), 0, 1); n2 = np.clip((n_w * l2).sum(-1), 0, 1)
    n3 = np.clip((n_w * l3).sum(-1), 0, 1); nv = np.clip((n_w * v_w).sum(-1), 0, 1)
    h1 = l1 + v_w; h1 /= np.linalg.norm(h1, axis=-1, keepdims=True)
    h2 = l3 + v_w; h2 /= np.linalg.norm(h2, axis=-1, keepdims=True)
    s1 = np.clip((n_w * h1).sum(-1), 0, 1) ** 60
    s2 = np.clip((n_w * h2).sum(-1), 0, 1) ** 220
    AMB = np.array([0.33, 0.33, 0.35])
    diff = base * (AMB + 1.15 * n1[..., None] * np.array([1.0, 0.97, 0.88])
                   + 0.50 * n2[..., None] * np.array([0.85, 0.88, 1.0]))
    spec = base * (s1[..., None] * 1.5) + np.array([1.0, 0.98, 0.93]) * (s2[..., None] * 3.4)
    rim = (1.0 - nv) ** 4 * np.clip((n_w * l3).sum(-1) * 0.5 + 0.5, 0, 1)
    col = np.clip(diff + spec + np.array([0.75, 0.85, 1.0]) * rim[..., None] * 0.40, 0, 1) ** (1 / 1.02)
    alpha = hitmask.ravel().astype(np.float64)
    outc = np.ones((H * W, 3)); outc[idx] = col
    return outc, alpha

def frame_rgba(t):
    """shutter-integrated frame: averages sub-angles, premultiplied, with true alpha"""
    a_center = angle_deg(t)
    peak_rate = REVOLUTIONS / INTEG * 360.0          # deg/s
    half_arc = peak_rate * SHUTTER / 2.0
    acc_c = np.zeros((H * W, 3)); acc_a = np.zeros((H * W))
    w = np.linspace(-1, 1, SUBSAMPLES)
    for wi in w:
        col, al = render(a_center + wi * half_arc, 6.0)
        acc_c += col * al[..., None]; acc_a += al
    a_out = np.clip(acc_a, 0, 1)
    c_out = np.where(acc_a[..., None] > 1e-6, acc_c / np.maximum(acc_a[..., None], 1e-6), 1.0)
    c_out = np.clip(c_out, 0, 1)
    img = np.concatenate([c_out, a_out[..., None]], axis=-1)
    return img.reshape(H, W, 4)

if __name__ == "__main__":
    os.makedirs(".tmp/spin", exist_ok=True)
    t0 = time.time()
    n = int(FPS * DUR)
    for i in range(n):
        t = i / FPS
        img = frame_rgba(t)
        # save at 512 with a box/Lanczos downsample for clean edges
        im = Image.fromarray((img * 255).astype(np.uint8), "RGBA").resize((OUT, OUT), Image.LANCZOS)
        im.save(".tmp/spin/f_%04d.png" % i)
        if i % 10 == 0:
            el = time.time() - t0
            print("frame %3d/%d  t=%.2f  angle=%6.1f deg  %.0fs elapsed, eta %.0fs"
                  % (i, n, t, angle_deg(t), el, el / max(i + 1, 1) * (n - i - 1)), flush=True)
    print("frames done %.1fs" % (time.time() - t0))
