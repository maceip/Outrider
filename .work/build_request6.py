import json, subprocess

base = "/Users/mac/Outrider/.work"

out = subprocess.run(["mcode-tools", "upload_temp_url", f"{base}/logo_ref.png"],
                     capture_output=True, text=True, cwd=base)
url = json.loads(out.stdout)["temp_url"]

HEAD = """Edit Picture 1 (图1). Render the emblem as a flat 2D vector silhouette icon with exactly the same geometry: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center. Keep the original proportions, segment gap widths, corner radii, and the star's proportions. Do not restyle, redraw, or alter the silhouette."""

UNIFORM = """Absolutely uniform flat color: every single pixel of the emblem is one identical color. There is no gradient anywhere, no shading, no lighting variation, no tonal variation across the surface, no highlight, no shadow, no depth, no texture, no carbon fiber weave, no sheen, no specular reflection, no metallic or foil quality, no bevel, no 3D, no outline or stroke that changes the silhouette. It is a single-color vector shape, like a flat app icon."""

PUNCHY_LIGHT = """The color is punchy, vivid and highly saturated so it reads brightly at very small sizes: a clear bright chartreuse yellow-green, rich and energetic, not pastel, not washed out, not pale, not a dull olive, not muted, not dark."""

PUNCHY_DARK = """The color is punchy, vivid and highly saturated so it reads brightly at very small sizes: a clear bright chartreuse yellow-green, one step more luminous than the light version so it holds vividly against charcoal and near-black, rich and energetic, not pastel, not washed out, not pale, not a dull olive, not muted."""

EDGES = """Hard, crisp, precisely cut edges with clean anti-aliased boundaries."""

WHITE = """Background: completely flat, uniform pure white (#FFFFFF) from edge to edge, with no gradient, no vignette, no texture, no falloff, and no shadow of any kind."""

EXCL = """Exclude: gradients, shading, highlights, shadows, textures, weave, 3D, bevels, metallic or foil quality, glows, outlines or strokes, text, extra shapes, people, props, watermarks."""


def req(color, name):
    prompt = "\n\n".join([HEAD, UNIFORM, color, EDGES, WHITE, EXCL])
    return {"prompt": prompt,
            "reference_images": [{"url": url, "mime_type": "image/png"}],
            "aspect_ratio": "1:1", "area": "2K", "n": 1,
            "output_format": "png", "output_file": name}


reqs = [req(PUNCHY_LIGHT, "outrider-light-flat"),
        req(PUNCHY_DARK, "outrider-dark-flat")]

json.dump({"requests": reqs}, open(f"{base}/image-request6.json", "w"), indent=2)
for r in reqs:
    print(" -", r["output_file"], r["area"], len(r["prompt"]), "chars")
