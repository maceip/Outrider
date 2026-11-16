#!/usr/bin/env python3
"""Builds the GitHub Pages static export of `@heroui-pro/template-dashboard` into `www-dist/`."""
import os
import pathlib
import shutil
import subprocess
import sys


def main() -> None:
    root = pathlib.Path(__file__).resolve().parents[1]
    dashboard_dir = root / "dashboard"
    www_public_demo = dashboard_dir / "www-public" / "demo"
    out_www = dashboard_dir / "out-www"
    www_dist = root / "www-dist"

    if not www_public_demo.is_dir():
        sys.exit(f"Missing showcase demo assets directory: {www_public_demo}")

    if out_www.exists():
        shutil.rmtree(out_www)
    if www_dist.exists():
        shutil.rmtree(www_dist)

    env = dict(os.environ)
    env["NEXT_PUBLIC_WWW"] = "1"

    subprocess.run(
        ["npx", "next", "build"],
        cwd=str(dashboard_dir),
        env=env,
        check=True,
    )

    if not (out_www / "index.html").is_file():
        sys.exit(f"Expected {out_www / 'index.html'} after static export")

    shutil.move(str(out_www), str(www_dist))

    dest_demo = www_dist / "demo"
    dest_demo.mkdir(parents=True, exist_ok=True)
    for item in sorted(www_public_demo.iterdir()):
        if item.is_file():
            shutil.copy2(item, dest_demo / item.name)
        elif item.is_dir():
            shutil.copytree(item, dest_demo / item.name, dirs_exist_ok=True)

    entries = sorted(p.name for p in www_dist.iterdir())
    print(f"[build_www] Exported clean template-dashboard to {www_dist}: {', '.join(entries)}")


if __name__ == "__main__":
    main()
