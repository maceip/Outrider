import json, subprocess

base = "/Users/mac/Outrider/.work"

out = subprocess.run(["mcode-tools", "upload_temp_url", f"{base}/logo_ref.png"],
                     capture_output=True, text=True, cwd=base)
url = json.loads(out.stdout)["temp_url"]

GEOM = """Keep the emblem's exact geometry: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center. Keep the original flat proportions, segment gap widths, corner radii, and the star's proportions. Do not redraw, restyle, or alter the silhouette."""

WEAVE = """Surface material: a hard carbon fiber composite in a clearly defined 2x2 twill weave. The tow bundles are distinct and legible, running diagonally across every segment and across the central sparkle, with crisp defined weave edges and hard boundaries between the tows. The tows are the same yellow-green family as the base color, a little lighter and a little darker than it, so the weave reads as structure within the color and never as gold, silver or any other metal. The surface is matte and non-reflective, a coated composite, never foil. Never gold leaf, never metallic leaf, never chrome, never a mirror, and never a specular sheen or glossy highlight. The weave is low contrast in value, never a bold checkerboard, and never a full carbon fiber wrap that turns the mark black or grey."""

COLOR_LIGHT = """Keep the emblem's yellow-green color family and give it real depth and richness: a deep, saturated chartreuse-yellow green with confident tonal modeling across the form — luminous yellow-green where the light strikes the upper-left, falling through a richer mid-tone to a deep olive in the lower-right. It must never read as a flat, pale, washed-out or pastel lemon yellow, and never as a flat uniform field of color. Rich, deep and considered, with the tonal variation doing the work instead of any gloss."""

COLOR_DARK = """Keep the emblem's yellow-green color family tuned for dark interfaces, but with the same real depth and richness: a deep, saturated chartreuse-yellow green with confident tonal modeling across the form — luminous yellow-green at the upper-left falling through a richer mid-tone to a deeper olive in the lower-right. The deepest tone still reads clearly against charcoal and near-black and never sinks into the background. Never a flat, pale, washed-out or pastel lemon yellow, and never a flat uniform field of color."""

HINTS = """Carry the brand's structure, security and AI ideas subtly through the finish rather than through new symbols: the segment cuts are crisp, narrow and engineered, reading as precise structure; the enclosing arcs feel solid and protective, holding the core; the central four-point sparkle is sharp, bright and luminous, reading as a clean AI core, and it carries the brightest point of the emblem."""

EDGES = """The emblem's own edges are hard, crisp and precisely cut, with a clean defined contour and a subtle darker edge line where the composite meets the background. No soft glow, no feathered blur, no fuzzy fringe."""

NOFLOOR = """The emblem floats isolated, with no cast shadow, no drop shadow, no contact shadow, no floor, no reflection and no glow."""

WHITE = """Background: completely flat, uniform pure white (#FFFFFF) from edge to edge, with no gradient, no vignette, no texture, no falloff and no shadow of any kind."""

EXCL = """Exclude: metallic leaf, gold foil, chrome, aluminum, silver, polished metal, mirror surfaces, glossy varnish, plastic sheen, specular highlights, lens flare, bloom; any shadow, floor, reflection or glow beneath the emblem; a bold black or grey carbon checkerboard; 3D bevels, chamfers, extruded edges or embossing; flat pastel or washed-out lemon yellow; film grain, noise, color banding; text, lettering, extra shapes, people, props, watermarks."""

FLAT_LIGHT = """One single flat fill color: a deep, saturated chartreuse-yellow green, the same rich deeper tone as the full treatment, never a pale, washed-out or pastel lemon yellow. Even and unvarying across every part of the shape, with hard, crisp, precisely cut anti-aliased edges."""

FLAT_DARK = """One single flat fill color: a deep, saturated chartreuse-yellow green tuned for dark interfaces, one step more luminous than the light version so it holds against charcoal and near-black, rich and considered, never pale, pastel or washed out. Even and unvarying across every part of the shape, with hard, crisp, precisely cut anti-aliased edges."""

FLAT_RULES = """Absolutely no texture, no carbon fiber weave, no gradient, no sheen, no specular highlight, no metallic, foil or gold quality, no bevel, no 3D, no shading, no shadow, no floor, no reflection, no glow, no outline or stroke that changes the silhouette."""

FLAT_EXCL = """Exclude: texture, weave, gradients, highlights, metallic or foil quality, bevels, 3D shading, shadows, floors, reflections, glows, outlines or strokes, text, extra shapes, people, props, watermarks."""


def full(color):
    return "\n\n".join([f"Edit Picture 1 (图1). {GEOM}", color, WEAVE, HINTS, EDGES,
                        NOFLOOR, WHITE, EXCL])


def flat(color):
    return "\n\n".join([
        "Edit Picture 1 (图1). Render the emblem as a clean flat vector-style icon using exactly the same geometry: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center. Keep the original proportions, segment gap widths, corner radii, and the star's proportions.",
        color, FLAT_RULES, WHITE, FLAT_EXCL])


def req(prompt, area, name):
    return {"prompt": prompt,
            "reference_images": [{"url": url, "mime_type": "image/png"}],
            "aspect_ratio": "1:1", "area": area, "n": 1,
            "output_format": "png", "output_file": name}


reqs = [
    req(full(COLOR_LIGHT), "4K", "outrider-light-full"),
    req(full(COLOR_DARK), "4K", "outrider-dark-full"),
    req(flat(FLAT_LIGHT), "2K", "outrider-light-flat"),
    req(flat(FLAT_DARK), "2K", "outrider-dark-flat"),
]

json.dump({"requests": reqs}, open(f"{base}/image-request5.json", "w"), indent=2)
for r in reqs:
    print(" -", r["output_file"], r["area"], len(r["prompt"]), "chars")
