import json, os, subprocess, sys, urllib.request

base = "/Users/mac/Outrider/.work"
tag = sys.argv[1] if len(sys.argv) > 1 else "5"
masters = f"{base}/masters-{tag}"
os.makedirs(masters, exist_ok=True)

receipt = json.load(open(f"{base}/receipt{tag}.json"))
items = receipt["success_items"]

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=base, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd}\nSTDOUT:{r.stdout}\nSTDERR:{r.stderr}")
    return r.stdout

results = []
for it in items:
    name, node = it["file_name"], it["node_id"]
    print("==>", name, node)

    # download generated master
    asset = json.loads(run(["mcode-tools", "get_asset_url", node]))
    local = f"{masters}/{name}"
    urllib.request.urlretrieve(asset["download_url"], local)

    # upload for the background-removal tool
    up = json.loads(run(["mcode-tools", "upload_temp_url", local]))

    # remove background -> transparent PNG
    raw = run(["mcode-tools", "connector", "call",
               "connector__matrix__remove_image_background",
               "--args", json.dumps({"image_url": up["temp_url"]})])
    res = json.loads(raw)
    print("    ", res.get("code"), res.get("message"), res.get("file_name"),
          res.get("width"), "x", res.get("height"))
    results.append({"master": name, "node_id": node, "transparent": res})

json.dump(results, open(f"{base}/cutout-receipt-{tag}.json", "w"), indent=2)
print("\ndone:", len(results))
