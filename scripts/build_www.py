#!/usr/bin/env python3
"""Builds the Meta Astryx Conduit Showcase (`prototypes/astryx-control-plane`) into `www-dist/`."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys


def main() -> None:
    root = pathlib.Path(__file__).resolve().parents[1]
    proto_dir = root / "prototypes" / "astryx-control-plane"
    dist_dir = proto_dir / "dist"
    www_dist = root / "www-dist"
    www_public_demo = root / "dashboard" / "www-public" / "demo"

    if not (proto_dir / "package.json").is_file():
        sys.exit(f"Missing Astryx Vite package.json at {proto_dir / 'package.json'}")

    if not (proto_dir / "node_modules").is_dir() or os.environ.get("CI") == "true":
        subprocess.run(
            ["npm", "ci"] if (proto_dir / "package-lock.json").is_file() else ["npm", "install"],
            cwd=str(proto_dir),
            check=True,
        )

    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    subprocess.run(
        ["npm", "run", "build"],
        cwd=str(proto_dir),
        check=True,
    )

    built_index = dist_dir / "index.html"
    built_assets = dist_dir / "assets"
    if not built_index.is_file() or not built_assets.is_dir():
        sys.exit(f"Expected Vite build output in {dist_dir}")

    www_dist.mkdir(parents=True, exist_ok=True)

    # Remove any legacy Next.js static export leftovers in www-dist
    for legacy_entry in ("_next", "_not-found", "help", "settings", "404"):
        candidate = www_dist / legacy_entry
        if candidate.is_dir():
            shutil.rmtree(candidate)
    for txt_file in www_dist.glob("*.txt"):
        txt_file.unlink()

    target_assets = www_dist / "assets"
    if target_assets.exists():
        shutil.rmtree(target_assets)
    shutil.copytree(built_assets, target_assets)

    index_html = built_index.read_text(encoding="utf-8")
    if "/__PAGES_BASE__/assets/" not in index_html:
        sys.exit("Expected /__PAGES_BASE__/assets/ prefix in built index.html")

    (www_dist / "index.html").write_text(index_html, encoding="utf-8")
    (www_dist / "404.html").write_text(index_html, encoding="utf-8")

    # Ensure demo directory and SHA-256-verified HAR bundle remain intact
    dest_demo = www_dist / "demo"
    dest_demo.mkdir(parents=True, exist_ok=True)
    if www_public_demo.is_dir():
        for item in sorted(www_public_demo.iterdir()):
            dest = dest_demo / item.name
            if not dest.exists():
                if item.is_file():
                    shutil.copy2(item, dest)
                elif item.is_dir():
                    shutil.copytree(item, dest, dirs_exist_ok=True)

    har_file = dest_demo / "live-capture.har"
    bundle_file = dest_demo / "live-session-bundle.json"
    seed_file = dest_demo / "interceptor-seed.json"
    if not har_file.is_file() or not seed_file.is_file():
        sys.exit("Missing required demo/live-capture.har or demo/interceptor-seed.json in www-dist")

    if bundle_file.is_file():
        bundle_data = json.loads(bundle_file.read_text(encoding="utf-8"))
        actual_sha = hashlib.sha256(har_file.read_bytes()).hexdigest()
        expected_sha = bundle_data.get("harSha256")
        if expected_sha and actual_sha != expected_sha:
            bundle_data["harSha256"] = actual_sha
            bundle_file.write_text(json.dumps(bundle_data, indent=2) + "\n", encoding="utf-8")

    entries = sorted(p.name for p in www_dist.iterdir())
    print(f"[build_www] Built Astryx Conduit showcase into {www_dist}: {', '.join(entries)}")


if __name__ == "__main__":
    main()
