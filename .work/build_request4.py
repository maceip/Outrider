import json, subprocess, sys

base = "/Users/mac/Outrider/.work"

# fresh reference upload
out = subprocess.run(["mcode-tools", "upload_temp_url", f"{base}/logo_ref.png"],
                     capture_output=True, text=True, cwd=base)
up = json.loads(out.stdout)
url = up["temp_url"]

GEOM = """Keep the emblem's exact geometry: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center. Keep the original flat proportions, segment gap widths, corner radii, and the star's proportions. Do not redraw, restyle, or alter the silhouette."""

HINTS = """Carry the brand's structure, security and AI ideas subtly through the finish rather than through new symbols: the segment cuts are crisp, narrow and engineered, reading as precise structure; the enclosing arcs feel solid and protective, holding the core; the central four-point sparkle is sharp, bright and luminous, reading as a clean AI core, and it carries the brightest point of the emblem."""

WEAVE = """Surface material: a fine carbon fiber twill weave laid across the shape at very low contrast, a whisper of real composite texture visible up close and catching a little light along the upper-left. The yellow-green stays the dominant read; the weave is never black, never grey, never a bold checkerboard, never a full carbon fiber wrap."""

FINISH = """Finish: a soft wide satin sheen across the upper-left, and a thin hairline of lighter yellow-green along the upper-left contour of each segment and along the upper-left edge of the central sparkle."""

NOFLOOR = """The emblem floats isolated, with no cast shadow, no drop shadow, no contact shadow, no floor, no reflection and no glow."""

WHITE = """Background: completely flat, uniform pure white (#FFFFFF) from edge to edge, with no gradient, no vignette, no texture, no falloff and no shadow of any kind."""

EXCL = """Exclude: any shadow, floor, reflection, pedestal or glow beneath the emblem; a full carbon fiber wrap or a bold black/grey weave; glossy clear-coat or plastic varnish; 3D bevels, chamfers, extruded edges or embossing; metal, chrome, aluminum, silver or gold surfaces; lens flare, bloom, chromatic aberration, film grain, noise, color banding; text, lettering, extra shapes, people, props, watermarks."""

LIGHT_COLOR = """Keep the emblem's yellow-green color family and make it vivid and luminous: a vibrant, highly saturated chartreuse-yellow green, punchy and confident, flat and even across the shape with clean crisp edges. Vivid but natural, never neon, never clipped."""

DARK_COLOR = """Keep the emblem's yellow-green color family but tune the colorway for dark interfaces: one step brighter and more luminous than the light version, so the mark holds its contrast and reads confidently against charcoal, graphite and near-black backgrounds. Flat and even, clean crisp edges, vivid but natural, never neon, never clipped, never glowing."""

FLAT_BODY = """One single flat fill color: the emblem's vibrant yellow-green, a punchy, highly saturated chartreuse-yellow green, even and unvarying across every part of the shape, with crisp clean anti-aliased edges."""

FLAT_DARK = """One single flat fill color: the emblem's vibrant yellow-green tuned for dark interfaces, one step brighter and more luminous so it holds against charcoal and near-black backgrounds, even and unvarying across every part of the shape, with crisp clean anti-aliased edges."""

FLAT_RULES = """Absolutely no texture, no carbon fiber weave, no gradient, no sheen, no specular highlight, no bevel, no 3D, no shading, no shadow, no floor, no reflection, no glow, no outline or stroke that changes the silhouette."""

FLAT_EXCL = """Exclude: texture, weave, gradients, highlights, bevels, 3D shading, shadows, floors, reflections, glows, metal, chrome, glass, plastic varnish, outlines or strokes, text, extra shapes, people, props, watermarks."""


def full(color):
    return "\n\n".join([
        f"Edit Picture 1 (图1). {GEOM}",
        color,
        WEAVE,
        HINTS,
        FINISH,
        NOFLOOR,
        WHITE,
        EXCL,
    ])


def flat(color):
    return "\n\n".join([
        f"Edit Picture 1 (图1). Render the emblem as a clean flat vector-style icon using exactly the same geometry: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center. Keep the original proportions, segment gap widths, corner radii, and the star's proportions.",
        color,
        FLAT_RULES,
        WHITE,
        FLAT_EXCL,
    ])


def req(prompt, area, name):
    return {
        "prompt": prompt,
        "reference_images": [{"url": url, "mime_type": "image/png"}],
        "aspect_ratio": "1:1",
        "area": area,
        "n": 1,
        "output_format": "png",
        "output_file": name,
    }


reqs = [
    req(full(LIGHT_COLOR), "4K", "outrider-light-full"),
    req(full(DARK_COLOR), "4K", "outrider-dark-full"),
    req(flat(FLAT_BODY), "2K", "outrider-light-flat"),
    req(flat(FLAT_DARK), "2K", "outrider-dark-flat"),
]

with open(f"{base}/image-request4.json", "w") as f:
    json.dump({"requests": reqs}, f, indent=2)

print("wrote request with", len(reqs), "requests")
for r in reqs:
    print(" -", r["output_file"], r["area"], len(r["prompt"]), "chars")
