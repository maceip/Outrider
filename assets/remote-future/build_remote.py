#!/usr/bin/env python3
"""
Rebuild the "Futuristic Neon AI Controller" remote as a simplified GLB.

The source GLB was a single 281,790-triangle relief mesh whose base-colour
texture was almost entirely black, so every neon-green button was lost in the
render.  This script rebuilds the asset from the original concept render:

  * clean, low-poly body lofted from the render's alpha silhouette
  * 9 raised buttons (8 icon buttons + 1 large logo button) with real glass
    faces that carry the icons as base-colour + emissive maps
  * a bright emissive status LED at the top
  * 6 named parts instead of 1 monolithic mesh

Run:  python3 assets/remote-future/build_remote.py
"""

import json
import os

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

HERE = os.path.dirname(os.path.abspath(__file__))
REF = ("/Users/mac/.minimax/v2/assets/2026/11/15/08-42-22-727-"
       "asset_20261115-084222-727_36dcbd2123b4_9dfbca00-"
       "Futuristic Neon AI Controller.png")
OUT_GLB = os.path.join(HERE, "futuristic_neon_remote_v2.glb")
OUT_ATLAS = os.path.join(HERE, "button_face_atlas.png")
OUT_EMISSIVE = os.path.join(HERE, "button_face_emissive.png")
OUT_JSON = os.path.join(HERE, "build_report.json")
OUT_STL = os.path.join(HERE, "futuristic_neon_remote_v2.stl")

# ---------------------------------------------------------------- parameters
S = 0.0011          # model units per reference pixel (keeps the original GLB scale)
CX = 627.5          # reference-image centre column
CY = 624.0          # reference-image centre row
BODY_TOP, BODY_BOT = 168, 1080

# z layers of the lofted shell (model units, +Z is the front face)
LAYERS = [           # (z, xy-scale)
    (-0.0960, 0.930),   # back cap
    (-0.0760, 1.000),   # back chamfer -> main wall
    (0.0200, 1.000),    # main wall -> front chamfer
    (0.0340, 0.985),    # front chamfer -> front face
]

# name, centre x/y (px), outer radius (px), inner/face radius (px)
BUTTONS = [
    ("btn_starburst", 557, 321, 54, 49),
    ("btn_terminal", 698, 321, 54, 49),
    ("btn_cloud", 558, 462, 52, 47),
    ("btn_git", 697, 462, 52, 47),
    ("btn_database", 577, 604, 37, 32),
    ("btn_gear", 678, 604, 37, 32),
    ("btn_chatgpt", 570, 754, 53, 48),
    ("btn_waveform", 685, 754, 53, 48),
    ("btn_logo", 627, 923, 87, 81),
]
LED = (627, 186, 20, 6)      # centre x/y, half width, half height (px)

# ------------------------------------------------------------------ helpers


def px(x, y):
    """reference pixels -> model (x, y)"""
    return ((x - CX) * S, (CY - y) * S)


def smooth(a, k):
    ker = np.ones(k) / k
    return np.convolve(np.pad(a, (k // 2, k // 2), mode="edge"), ker, mode="valid")


def _edge(row, thr=128, left=True):
    """sub-pixel silhouette edge from the alpha ramp"""
    idx = np.nonzero(row >= thr)[0]
    if len(idx) == 0:
        return None
    if left:
        i = idx[0]
        if i == 0:
            return 0.0
        a0, a1 = float(row[i - 1]), float(row[i])
        frac = (thr - a0) / (a1 - a0) if a1 != a0 else 0.0
        return (i - 1) + frac
    i = idx[-1]
    if i == len(row) - 1:
        return float(len(row) - 1)
    a0, a1 = float(row[i]), float(row[i + 1])
    frac = (a0 - thr) / (a0 - a1) if a0 != a1 else 0.0
    return i + frac


def body_profile(alpha):
    """half width of the body silhouette for every reference row (sub-pixel)"""
    rows = np.arange(BODY_TOP, BODY_BOT + 1)
    hw = np.zeros(len(rows))
    for i, y in enumerate(rows):
        row = alpha[y]
        l = _edge(row, 128, True)
        r = _edge(row, 128, False)
        if l is None or r is None:
            xs = np.nonzero(row > 16)[0]
            if len(xs) == 0:
                hw[i] = 0.0
                continue
            l, r = float(xs.min()), float(xs.max())
        hw[i] = (r - l) / 2.0
    hw = smooth(hw, 41)
    step = 2                                    # decimate rows: shape is smooth enough
    rows = rows[::step]
    hw = hw[::step]
    if rows[-1] != BODY_BOT:
        rows = np.append(rows, BODY_BOT)
        hw = np.append(hw, smooth(hw, 5)[-1])
    return rows, hw


def scaled_rows(rows, hw, scale):
    """rows/half-widths scaled about the body centre (for the chamfer rings)"""
    ys = CY + (rows - CY) * scale
    xs = hw * scale
    return ys, xs


def cap_mesh(ys, hws, z, flip=False):
    """triangulate a vertically-convex region (the body silhouette) as a cap"""
    verts, faces = [], []
    for y, hw in zip(ys, hws):
        verts.append((*px(CX - hw, y), z))
        verts.append((*px(CX + hw, y), z))
    for i in range(len(ys) - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        faces += [(a, b, c), (a, c, d)]
    if flip:
        faces = [tuple(reversed(f)) for f in faces]
    return np.array(verts, dtype=np.float64), faces


def loop_from(ys, hws, z):
    """closed boundary loop: right edge top->bottom, left edge bottom->top"""
    verts = []
    for y, hw in zip(ys, hws):
        verts.append((*px(CX + hw, y), z))
    for y, hw in zip(reversed(ys), reversed(hws)):
        verts.append((*px(CX - hw, y), z))
    return np.array(verts, dtype=np.float64)


def wall_between(loop_a, loop_b):
    """triangle band between two matching loops, wound outward"""
    faces, n = [], len(loop_a)
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, n + j, j), (i, n + i, n + j)]
    return faces


def orient(mesh, probe=None):
    """make a closed mesh outward-facing and give it smooth vertex normals

    probe(mesh) -> float: positive when the mesh already faces outward
    """
    if probe is not None:
        try:
            if probe(mesh) < 0:
                mesh.invert()
        except Exception:
            pass
    else:
        try:
            if mesh.volume < 0:
                mesh.invert()
        except Exception:
            pass
    mesh._cache.cache.pop("vertex_normals", None)
    mesh._cache.cache.pop("face_normals", None)
    mesh.vertex_normals        # recompute from this mesh's own faces
    return mesh


def _probe_outward_x(mesh):
    """normal at the +x extreme must point +x"""
    v, n = np.asarray(mesh.vertices), np.asarray(mesh.vertex_normals)
    i = int(np.argmax(v[:, 0]))
    return float(n[i, 0])


def _probe_outward_radial(mesh, cx, cy):
    """normal at the outermost vertex must point away from (cx, cy)"""
    v, n = np.asarray(mesh.vertices), np.asarray(mesh.vertex_normals)
    d = v[:, :2] - np.array([cx, cy])
    r = np.linalg.norm(d, axis=1)
    i = int(np.argmax(r))
    return float(np.dot(n[i, :2], d[i] / max(r[i], 1e-9)))


def _probe_top(mesh, z):
    """mean normal of the cap at height z must point +z"""
    v, n = np.asarray(mesh.vertices), np.asarray(mesh.vertex_normals)
    sel = np.abs(v[:, 2] - z) < 1e-6
    if not sel.any():
        return 0.0
    return float(n[sel, 2].mean())


def build_body(alpha):
    """returns (shell, face_plate) - the front cap is split off for its own material"""
    rows, hw = body_profile(alpha)
    rings = []
    for z, sc in LAYERS:
        ys, xs = scaled_rows(rows, hw, sc)
        rings.append((loop_from(ys, xs, z), ys, xs, z))

    verts, faces = [], []

    def add(v, f):
        base = len(verts)
        verts.extend(v)
        faces.extend([tuple(base + i for i in face) for face in f])

    bot = rings[0]
    v, f = cap_mesh(bot[1], bot[2], bot[3], flip=False)    # back cap faces -Z
    add(v, f)

    for k in range(len(rings) - 1):                         # chamfer / side bands
        a, b = rings[k], rings[k + 1]
        add(a[0], wall_between(a[0], b[0]))

    top = rings[-1]
    v, f = cap_mesh(top[1], top[2], top[3], flip=True)     # front face plate faces +Z
    plate_start = len(faces)
    add(v, f)

    body = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    orient(body, probe=_probe_outward_x)
    shell_faces = np.ones(len(body.faces), dtype=bool)
    shell_faces[plate_start:] = False
    shell = trimesh.Trimesh(vertices=body.vertices.copy(),
                            faces=body.faces[shell_faces].copy(), process=True)
    plate = trimesh.Trimesh(vertices=body.vertices.copy(),
                            faces=body.faces[~shell_faces].copy(), process=True)
    orient(shell, probe=_probe_outward_x)
    orient(plate, probe=_probe_top)
    return shell, plate


def build_ring(cx, cy, r_out, r_in, z0, z1, segs=48):
    """closed annulus prism: outer wall, top face, inner wall, bottom face"""
    verts, faces = [], []
    for r, z in ((r_out, z0), (r_out, z1), (r_in, z1), (r_in, z0)):
        for i in range(segs):
            a = 2 * np.pi * i / segs
            verts.append((*px(cx + r * np.cos(a), cy + r * np.sin(a)), z))
    for k in range(4):
        nxt = (k + 1) % 4
        for i in range(segs):
            j = (i + 1) % segs
            a, b = k * segs + i, k * segs + j
            c, d = nxt * segs + j, nxt * segs + i
            faces.append((a, b, c))
            faces.append((a, c, d))
    mesh = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    orient(mesh, probe=lambda m: _probe_outward_radial(m, *px(cx, cy)))
    return mesh


def build_dome(cx, cy, r, z0, height, uv_rect, radial=3, segs=48):
    """shallow convex glass face carrying an atlas-mapped icon"""
    u0, v0, u1, v1 = uv_rect
    du, dv = u1 - u0, v1 - v0
    verts, uvs, faces = [], [], []

    def uv_for(dx, dy):
        g = 0.5 + dx / (2 * r)                      # 0 left  -> 1 right
        f = 0.5 - dy / (2 * r)                      # 0 top   -> 1 bottom
        return (u0 + g * du, 1.0 - (v0 + f * dv))    # trimesh UV = bottom-left origin

    mx, my = px(cx, cy)
    verts.append((mx, my, z0 + height))
    uvs.append(uv_for(0.0, 0.0))
    for ring in range(1, radial + 1):
        rr = r * ring / radial
        zz = z0 + height * (1 - (rr / r) ** 2)
        for i in range(segs):
            a = 2 * np.pi * i / segs
            dx, dy = rr * np.cos(a), rr * np.sin(a)
            vx, vy = px(cx + dx, cy + dy)
            verts.append((vx, vy, zz))
            uvs.append(uv_for(dx * S, -dy * S))
    # model-space winding is clockwise in image space -> reverse for +Z normals
    for i in range(segs):
        faces.append((0, 1 + (i + 1) % segs, 1 + i))
    for ring in range(radial - 1):
        a0 = 1 + ring * segs
        b0 = 1 + (ring + 1) * segs
        for i in range(segs):
            j = (i + 1) % segs
            faces.append((a0 + i, b0 + j, b0 + i))
            faces.append((a0 + i, a0 + j, b0 + j))
    mesh = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    # analytic paraboloid normals
    v = np.asarray(mesh.vertices)
    n = np.stack([2 * height * v[:, 0] / (r * S) ** 2,
                  2 * height * v[:, 1] / (r * S) ** 2,
                  np.ones(len(v))], axis=1)
    n /= np.linalg.norm(n, axis=1)[:, None]
    mesh.vertex_normals = n
    # UVs from the final (merged) vertex positions - order independent
    rm = r * S
    dx = v[:, 0] - px(cx, cy)[0]
    dy = v[:, 1] - px(cx, cy)[1]
    g = np.clip(0.5 + dx / (2 * rm), 0.0, 1.0)
    f = np.clip(0.5 - dy / (2 * rm), 0.0, 1.0)
    uvs = np.stack([u0 + g * du, 1.0 - (v0 + f * dv)], axis=1)
    return mesh, uvs


def build_led(cx, cy, hw, hh, z0, z1):
    """small stadium-shaped status LED"""
    segs = 10
    outline = []
    for i in range(segs + 1):                      # right cap
        a = -np.pi / 2 + np.pi * i / segs
        outline.append((cx + hw - hh + hh * np.cos(a), cy + hh * np.sin(a)))
    for i in range(segs + 1):                      # left cap
        a = np.pi / 2 + np.pi * i / segs
        outline.append((cx - hw + hh + hh * np.cos(a), cy + hh * np.sin(a)))
    n = len(outline)
    verts, faces = [], []
    for z in (z0, z1):
        for x, y in outline:
            verts.append((*px(x, y), z))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j))
        faces.append((i, n + j, n + i))
    for z, base in ((z0, 0), (z1, n)):             # fan-triangulated caps
        c = len(verts)
        verts.append((px(cx, cy)[0], px(cx, cy)[1], z))
        for i in range(n):
            j = (i + 1) % n
            faces.append((c, base + j, base + i) if z == z1 else (c, base + i, base + j))
    mesh = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    orient(mesh, probe=lambda m: _probe_top(m, z1))
    return mesh


def build_atlas(ref_rgb, buttons):
    """3x3 atlas of button faces: base-colour map + lit-only emissive map"""
    cell, cols = 192, 3
    rows = int(np.ceil(len(buttons) / cols))
    atlas = Image.new("RGBA", (cell * cols, cell * rows), (0, 0, 0, 255))
    emissive = Image.new("RGB", (cell * cols, cell * rows), (0, 0, 0))
    rects = []
    for idx, (_name, cx, cy, _ro, ri) in enumerate(buttons):
        half = ri * 1.02                         # the glass face disc
        crop = ref_rgb.crop((cx - half, cy - half, cx + half, cy + half)).resize(
            (cell, cell), Image.LANCZOS)
        arr = np.asarray(crop).astype(np.float32) / 255.0
        # saturate, then force the lit pixels to stay green (never clip to white)
        lum = arr.mean(axis=2, keepdims=True)
        arr = np.clip(lum + (arr - lum) * 1.30, 0, 1)
        g = arr[..., 1].copy()
        lit = (g > 0.18) & (arr.max(axis=2) > 0.28)
        if idx < len(buttons) - 1:
            # icon buttons: force a saturated neon green that cannot clip to white
            arr[..., 0] = np.where(lit, np.minimum(arr[..., 0], g * 0.30), arr[..., 0])
            arr[..., 2] = np.where(lit, np.minimum(arr[..., 2], g * 0.40), arr[..., 2])
            arr[..., 1] = np.where(lit, np.clip(g * 0.98, 0, 1), arr[..., 1])
            em_src = arr.copy()
            # diffuse response stays below the tone-mapping knee; the emissive
            # map carries the brightness instead
            arr[..., 1] = np.where(lit, np.clip(g * 0.85, 0, 1), arr[..., 1])
        crop = Image.fromarray((arr * 255).astype(np.uint8)).convert("RGBA")
        # emissive map: only the bright, saturated (lit) pixels glow
        src = np.asarray(crop.convert("RGB")).astype(np.float32) / 255.0
        if idx < len(buttons) - 1:
            src = em_src
        mx = src.max(axis=2)
        mn = src.min(axis=2)
        sat = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
        em_lit = (mx > 0.30) & ((sat > 0.30) | (src[..., 1] >= mx - 1e-6))
        em = np.clip(src * em_lit[..., None], 0, 1)

        col, row = idx % cols, idx // cols
        atlas.paste(crop, (col * cell, row * cell))
        emissive.paste(Image.fromarray((em * 255).astype(np.uint8)).convert("RGB"),
                       (col * cell, row * cell))
        rects.append((col * cell / atlas.width, row * cell / atlas.height,
                      (col + 1) * cell / atlas.width, (row + 1) * cell / atlas.height))
    atlas.save(OUT_ATLAS)
    emissive.save(OUT_EMISSIVE)
    return rects


def postprocess_glb(path):
    """tame the glass specular and drop any duplicated embedded image"""
    import struct
    data = open(path, "rb").read()
    off, chunks = 12, []
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunks.append([ctype, off + 8, clen])
        off += 8 + clen
    j = json.loads(data[chunks[0][1]:chunks[0][1] + chunks[0][2]].decode("utf-8"))

    # tame the dielectric specular on the neon glass so the icons stay green
    # in bright environments instead of being washed out by reflections
    for mat in j.get("materials", []):
        if mat.get("name") == "Neon Button Glass":
            mat.setdefault("extensions", {})["KHR_materials_specular"] = {"specularFactor": 0.30}
            if "KHR_materials_specular" not in j.setdefault("extensionsUsed", []):
                j["extensionsUsed"].append("KHR_materials_specular")

    # trimesh can embed the same image twice -> keep one copy
    images = j.get("images", [])
    if len(images) >= 2:
        canonical = {}
        for i, im in enumerate(images):
            canonical[i] = canonical.setdefault(im.get("bufferView"), i)
        if len(set(canonical.values())) != len(images):
            keep_idx = sorted(set(canonical.values()))
            new_pos = {old: new for new, old in enumerate(keep_idx)}
            for t in j.get("textures", []):
                if t.get("source") in canonical:
                    t["source"] = new_pos[canonical[t["source"]]]
            drop = [i for i in range(len(images)) if canonical[i] != i]
            drop_bv = {images[i]["bufferView"] for i in drop}
            j["images"] = [images[i] for i in keep_idx]
            views = j.get("bufferViews", [])
            if drop_bv and all(bv == views[-1].get("bufferView") for bv in drop_bv):
                views.pop()
                j["bufferViews"] = views
                cut = chunks[1][1] + views[-1]["byteOffset"]
                data = data[:cut]
                j["buffers"][0]["byteLength"] = views[-1]["byteOffset"] + views[-1]["byteLength"]

    js = json.dumps(j, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + (len(data) - chunks[1][1])
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(data) - chunks[1][1], 0x4E4942) + data[chunks[1][1]:]
    open(path, "wb").write(out)


def apply_material(mesh, material):
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh.vertices), 2)), material=material)
    return mesh


def main():
    ref = Image.open(REF).convert("RGBA")
    alpha = np.asarray(ref)[..., 3]
    ref_rgb = ref.convert("RGB")

    rects = build_atlas(ref_rgb, BUTTONS)
    atlas = Image.open(OUT_ATLAS)                 # reopen so .format == 'PNG'
    emissive = Image.open(OUT_EMISSIVE)

    # --- materials
    mat_shell = PBRMaterial(
        name="Shell Satin Black",
        baseColorFactor=[0.038, 0.043, 0.042, 1.0],
        metallicFactor=0.70, roughnessFactor=0.38)
    mat_face = PBRMaterial(
        name="Face Gloss Black",
        baseColorFactor=[0.012, 0.022, 0.018, 1.0],
        metallicFactor=0.30, roughnessFactor=0.22)
    mat_bezel = PBRMaterial(
        name="Button Bezel Metal",
        baseColorFactor=[0.070, 0.078, 0.080, 1.0],
        metallicFactor=0.70, roughnessFactor=0.30)
    mat_neon = PBRMaterial(
        name="Neon Button Glass",
        baseColorTexture=atlas,
        emissiveTexture=emissive,
        emissiveFactor=[0.06, 1.15, 0.10],
        metallicFactor=0.0, roughnessFactor=0.18)
    mat_led = PBRMaterial(
        name="Status LED Green",
        baseColorFactor=[0.010, 0.46, 0.09, 1.0],
        emissiveFactor=[0.02, 0.95, 0.13],
        metallicFactor=0.0, roughnessFactor=0.85)

    scene = trimesh.Scene(base_frame="remote_root")

    # --- body
    shell, plate = build_body(alpha)
    apply_material(shell, mat_shell)
    apply_material(plate, mat_face)
    scene.add_geometry(shell, node_name="body_shell", geom_name="body_shell")
    scene.add_geometry(plate, node_name="face_plate", geom_name="face_plate")

    # --- buttons
    rings, faces_geo = [], []
    for idx, (name, cx, cy, ro, ri) in enumerate(BUTTONS):
        segs = 56 if ro > 60 else 44
        ring = build_ring(cx, cy, ro, ri, 0.0290, 0.0500, segs=segs)
        dome, uvs = build_dome(cx, cy, ri, 0.0455, 0.0045, rects[idx],
                               radial=3, segs=segs)
        dome.visual = trimesh.visual.TextureVisuals(uv=uvs, material=mat_neon)
        rings.append(ring)
        faces_geo.append(dome)
        scene.add_geometry(dome, node_name=name, geom_name=name)

    rings_all = trimesh.util.concatenate(rings)
    apply_material(rings_all, mat_bezel)
    scene.add_geometry(rings_all, node_name="button_bezels", geom_name="button_bezels")

    # --- LED
    led = build_led(LED[0], LED[1], LED[2], LED[3], 0.0180, 0.0370)
    apply_material(led, mat_led)
    scene.add_geometry(led, node_name="led_status", geom_name="led_status")

    scene.export(OUT_GLB, file_type="glb")
    postprocess_glb(OUT_GLB)
    # companion STL (no UVs) for CAD/printing / 3D Design viewers
    scene.export(OUT_STL, file_type="stl")

    report = {
        "source_glb_triangles": 281790,
        "new_triangles": int(sum(len(g.faces) for g in scene.geometry.values())),
        "new_vertices": int(sum(len(g.vertices) for g in scene.geometry.values())),
        "parts": sorted(scene.geometry.keys()),
        "bounds": np.asarray(scene.bounds).tolist(),
        "atlas": OUT_ATLAS,
        "glb": OUT_GLB,
        "stl": OUT_STL,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
