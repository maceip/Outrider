import json, os, shutil, subprocess

base = "/Users/mac/Outrider/.work"
export = "/Users/mac/Outrider/logo-export"

LOGO_SIZES = [1024, 512, 256, 128, 64]
ICON_SIZES = [64, 48, 32, 16]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}\n{r.stderr}")
    return r.stdout


def resize(src, dst, px):
    """Downscale preserving alpha, longest side -> px."""
    sh(["sips", "-Z", str(px), src, "--out", dst])


cut = json.load(open(f"{base}/cutout-receipt-5.json"))

# transparent cutouts come back from Drive; fetch each once
srcs = {}
for item in cut:
    node = item["transparent"]["node_id"]
    fname = item["transparent"].get("file_name") or item["master"]
    asset = json.loads(sh(["mcode-tools", "get_asset_url", node]))
    local = f"{base}/masters-5/{fname}"
    if not os.path.exists(local):
        import urllib.request
        urllib.request.urlretrieve(asset["download_url"], local)
    key = item["master"].replace("outrider-", "").replace(".png", "")
    srcs[key] = local
    print("cutout:", key, fname)

os.makedirs(export, exist_ok=True)

manifest = []
for mode in ("light", "dark"):
    full = srcs[f"{mode}-full"]
    flat = srcs[f"{mode}-flat"]
    d = f"{export}/{mode}"
    os.makedirs(d, exist_ok=True)

    shutil.copy2(full, f"{d}/outrider-logo-master.png")
    shutil.copy2(flat, f"{d}/outrider-icon-master.png")
    manifest.append((mode, "master", f"{d}/outrider-logo-master.png"))
    manifest.append((mode, "master", f"{d}/outrider-icon-master.png"))

    for px in LOGO_SIZES:
        out = f"{d}/outrider-logo-{px}.png"
        resize(full, out, px)
        manifest.append((mode, "logo", out))

    for px in ICON_SIZES:
        out = f"{d}/outrider-icon-{px}.png"
        resize(flat, out, px)
        manifest.append((mode, "icon", out))

# favicon.ico if PIL is available
ico_status = "skipped (Pillow not available)"
try:
    import PIL
    from PIL import Image
    for mode in ("light", "dark"):
        imgs = [Image.open(f"{export}/{mode}/outrider-icon-{px}.png").convert("RGBA")
                for px in (16, 32, 48)]
        ico_status = "built"
        imgs[0].save(f"{export}/favicon-{mode}.ico",
                     format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
                     append_images=imgs[1:])
except Exception as e:
    ico_status = f"skipped: {e}"

json.dump(manifest, open(f"{base}/manifest.json", "w"), indent=2)
print("\nfiles:", len(manifest), "| favicon:", ico_status)
for m in manifest:
    print("  ", m[0], m[1], os.path.relpath(m[2], export))
