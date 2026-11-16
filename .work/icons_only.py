import json, os, subprocess, urllib.request
from PIL import Image

base = "/Users/mac/Outrider/.work"
export = "/Users/mac/Outrider/logo-export"
ICON_SIZES = [64, 48, 32, 16]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}\n{r.stderr}")
    return r.stdout


cut = json.load(open(f"{base}/cutout-receipt-7.json"))
srcs = {}
for item in cut:
    node = item["transparent"]["node_id"]
    fname = item["transparent"].get("file_name") or item["master"]
    local = f"{base}/masters-7/{fname}"
    if not os.path.exists(local):
        asset = json.loads(sh(["mcode-tools", "get_asset_url", node]))
        urllib.request.urlretrieve(asset["download_url"], local)
    key = item["master"].replace("outrider-", "").replace(".png", "")
    srcs[key] = local
    print("cutout:", key)

# uniformity check on the solid interior of the light icon
probe = Image.open(srcs["light-flat"]).convert("RGBA")
w, h = probe.size
px = probe.load()
cols = {}
for fx in (0.20, 0.30, 0.40, 0.55, 0.65, 0.75):
    for fy in (0.15, 0.25, 0.60, 0.70, 0.80):
        r, g, b, a = px[int(w * fx), int(h * fy)]
        if a > 200:
            cols[(r // 8, g // 8, b // 8)] = cols.get((r // 8, g // 8, b // 8), 0) + 1
top = sorted(cols.items(), key=lambda kv: -kv[1])[:4]
print("dominant interior tone buckets:", top)
print("distinct buckets:", len(cols))

for mode in ("light", "dark"):
    src = srcs[f"{mode}-flat"]
    d = f"{export}/{mode}"
    os.makedirs(d, exist_ok=True)
    im = Image.open(src).convert("RGBA")
    im.save(f"{d}/outrider-icon-master.png")
    for px_ in ICON_SIZES:
        small = im.resize((px_, px_), Image.LANCZOS)
        small.save(f"{d}/outrider-icon-{px_}.png")
    print("wrote", mode, "icons")
