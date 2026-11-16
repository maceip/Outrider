import json, subprocess

base = "/Users/mac/Outrider/.work"

out = subprocess.run(["mcode-tools", "upload_temp_url", f"{base}/logo_ref.png"],
                     capture_output=True, text=True, cwd=base)
url = json.loads(out.stdout)["temp_url"]

HEAD = """Edit Picture 1 (图1). Render the emblem as a compact small-scale icon that carries the SAME premium design language as the full-size logo: the segmented circular C-shaped ring of four arc segments divided by thin crosshair gaps, and the small four-pointed sparkle star at the exact center, with the original proportions, segment gap widths, corner radii and star proportions unchanged."""

WEAVE = """Surface material: the same hard carbon fiber composite in a clearly defined 2x2 twill weave — distinct legible tow bundles running diagonally across every segment and across the sparkle, crisp defined weave edges, the tows a shade lighter and a shade darker than the base color so the weave reads as structure within the color and never as gold, silver or any other metal. Matte and non-reflective, never foil, never chrome, never a specular sheen or glossy highlight, never a bold black or grey checkerboard."""

OUTLINE = """Outline: a crisp, clearly visible darker edge line along the entire silhouette — a fine, precise dark contour around every segment and around the central sparkle, so the logo's outline stays clearly readable even at 16 pixels. Not a heavy stroke, a precise hairline of a deeper chartreuse, never black."""

TONE_LIGHT = """Tone: keep the tonal depth of the full logo — bright chartreuse where the light strikes the upper-left, falling to a richer chartreuse in the lower-right — but compress the range so that even the darkest tone remains a vivid, clearly yellow-green chartreuse, never a dull dark olive, never a muddy brown-olive, never washed out or pastel. The overall average must read as a bright, punchy yellow-green, not a muted mid-tone."""

TONE_DARK = """Tone: keep the tonal depth of the full logo — bright chartreuse where the light strikes the upper-left, falling to a richer chartreuse in the lower-right — but compress the range so that even the darkest tone remains a vivid, clearly yellow-green chartreuse that still reads against charcoal and near-black and never sinks into the background, never a dull dark olive, never a muddy brown-olive, never washed out or pastel. The overall average must read as a bright, punchy yellow-green, not a muted mid-tone."""

EDGES = """Hard, crisp, precisely cut edges."""

NOFLOOR = """The emblem floats isolated, with no cast shadow, no drop shadow, no contact shadow, no floor, no reflection and no glow."""

WHITE = """Background: completely flat, uniform pure white (#FFFFFF) from edge to edge, with no gradient, no vignette, no texture, no falloff and no shadow of any kind."""

EXCL = """Exclude: metallic leaf, gold foil, chrome, aluminum, silver, polished metal, mirror surfaces, glossy varnish, plastic sheen, specular highlights, lens flare, bloom; any shadow, floor, reflection or glow beneath the emblem; 3D bevels, chamfers, extruded edges or embossing; flat pastel or washed-out lemon yellow; dull dark olive or muddy brown tones; film grain, noise, color banding; text, lettering, extra shapes, people, props, watermarks."""


def req(tone, name):
    prompt = "\n\n".join([HEAD, WEAVE, OUTLINE, tone, EDGES, NOFLOOR, WHITE, EXCL])
    return {"prompt": prompt,
            "reference_images": [{"url": url, "mime_type": "image/png"}],
            "aspect_ratio": "1:1", "area": "2K", "n": 1,
            "output_format": "png", "output_file": name}


reqs = [req(TONE_LIGHT, "outrider-light-flat"),
        req(TONE_DARK, "outrider-dark-flat")]

json.dump({"requests": reqs}, open(f"{base}/image-request7.json", "w"), indent=2)
for r in reqs:
    print(" -", r["output_file"], r["area"], len(r["prompt"]), "chars")
