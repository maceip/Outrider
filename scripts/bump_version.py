#!/usr/bin/env python3
"""Monotonically bumps Outrider's patch version across Cargo.toml, Cargo.lock, and dashboard/package*.json."""
import argparse
import json
import pathlib
import re
import sys


def parse_semver(version: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version.strip())
    if not match:
        sys.exit(f"Invalid semver version '{version}'")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def read_current_cargo_version(cargo_toml: pathlib.Path) -> str:
    text = cargo_toml.read_text(encoding="utf-8")
    match = re.search(
        r'(?ms)^\[package\]\s+.*?^version\s*=\s*"(\d+\.\d+\.\d+)"',
        text,
    )
    if not match:
        sys.exit(f"Could not locate [package] version in {cargo_toml}")
    return match.group(1)


def update_cargo_toml(cargo_toml: pathlib.Path, old_ver: str, new_ver: str) -> None:
    text = cargo_toml.read_text(encoding="utf-8")
    updated, count = re.subn(
        rf'(?m)^version\s*=\s*"{re.escape(old_ver)}"$',
        f'version = "{new_ver}"',
        text,
        count=1,
    )
    if count != 1:
        sys.exit(f"Failed to update version in {cargo_toml}")
    cargo_toml.write_text(updated, encoding="utf-8")


def update_cargo_lock(cargo_lock: pathlib.Path, old_ver: str, new_ver: str) -> None:
    text = cargo_lock.read_text(encoding="utf-8")
    pattern = rf'(?m)(^\[\[package\]\]\r?\nname = "proxyfor"\r?\nversion = )"{re.escape(old_ver)}"'
    updated, count = re.subn(pattern, rf'\1"{new_ver}"', text, count=1)
    if count != 1:
        sys.exit(f"Failed to update proxyfor package version in {cargo_lock}")
    cargo_lock.write_text(updated, encoding="utf-8")


def update_dashboard_json(root: pathlib.Path, new_ver: str) -> None:
    for rel_dir in ("dashboard", "prototypes/astryx-control-plane"):
        pkg_json_path = root / rel_dir / "package.json"
        if pkg_json_path.is_file():
            pkg_data = json.loads(pkg_json_path.read_text(encoding="utf-8"))
            pkg_data["version"] = new_ver
            pkg_json_path.write_text(json.dumps(pkg_data, indent=2) + "\n", encoding="utf-8")

        pkg_lock_path = root / rel_dir / "package-lock.json"
        if pkg_lock_path.is_file():
            lock_data = json.loads(pkg_lock_path.read_text(encoding="utf-8"))
            lock_data["version"] = new_ver
            if isinstance(lock_data.get("packages"), dict) and "" in lock_data["packages"]:
                lock_data["packages"][""]["version"] = new_ver
            pkg_lock_path.write_text(json.dumps(lock_data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bump Outrider patch version across manifests.")
    parser.add_argument("--set", dest="explicit_version", default=None, help="Explicit X.Y.Z version.")
    parser.add_argument("--dry-run", action="store_true", help="Print next version without writing files.")
    parser.add_argument(
        "--github-output",
        default=None,
        help="Optional path to $GITHUB_OUTPUT file to append version and tag.",
    )
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parents[1]
    cargo_toml = root / "proxyfor/Cargo.toml"
    cargo_lock = root / "Cargo.lock"

    current = read_current_cargo_version(cargo_toml)
    if args.explicit_version:
        parse_semver(args.explicit_version)
        next_ver = args.explicit_version.strip()
    else:
        major, minor, patch = parse_semver(current)
        next_ver = f"{major}.{minor}.{patch + 1}"

    if not args.dry_run:
        update_cargo_toml(cargo_toml, current, next_ver)
        update_cargo_lock(cargo_lock, current, next_ver)
        update_dashboard_json(root, next_ver)

    if args.github_output:
        out_path = pathlib.Path(args.github_output)
        with out_path.open("a", encoding="utf-8") as handle:
            handle.write(f"previous_version={current}\n")
            handle.write(f"version={next_ver}\n")
            handle.write(f"tag=v{next_ver}\n")

    print(next_ver)


if __name__ == "__main__":
    main()
