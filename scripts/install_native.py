#!/usr/bin/env python3
"""Explicit native installation; cargo never downloads executable code."""
import argparse
import hashlib
import json
import pathlib
import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile


def sha256_file(path: pathlib.Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def detect_target() -> str:
    machine = platform.machine().lower()
    if sys.platform == "darwin" and machine in ("arm64", "aarch64"):
        return "aarch64-apple-darwin"
    if sys.platform == "win32" and machine in ("amd64", "x86_64"):
        return "x86_64-pc-windows-msvc"
    if sys.platform.startswith("linux") and machine in ("amd64", "x86_64"):
        return "x86_64-unknown-linux-gnu"
    sys.exit(f"Unsupported host platform for pinned native runtime: {sys.platform}/{machine}")


def verify_existing(dest: pathlib.Path, expected_files: dict[str, str]) -> bool:
    for name, expected in expected_files.items():
        candidate = dest / name
        if not candidate.is_file() or sha256_file(candidate) != expected:
            return False
    return True


def download_verified(url: str, expected_sha256: str, out_path: pathlib.Path) -> None:
    urllib.request.urlretrieve(url, out_path)
    actual = sha256_file(out_path)
    if actual != expected_sha256:
        sys.exit(
            f"Native archive checksum mismatch for {url}: expected {expected_sha256}, got {actual}"
        )


def install_macos_arm64(root: pathlib.Path, manifest: dict) -> pathlib.Path:
    dest = root / "native/macos"
    expected = manifest["files_macos_arm64"]
    if not verify_existing(dest, expected):
        dest.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="outrider-native-") as temp:
            archive = pathlib.Path(temp) / "prebuilt.zip"
            download_verified(manifest["url"], manifest["archive_sha256"], archive)
            with zipfile.ZipFile(archive) as z:
                for name in z.namelist():
                    path = pathlib.PurePosixPath(name)
                    if str(path.parent) == "prebuilt/macos" and path.suffix == ".dylib":
                        with z.open(name) as source, (dest / path.name).open("wb") as target:
                            shutil.copyfileobj(source, target)
            runtime = manifest["runtime"]
            wheel = pathlib.Path(temp) / "runtime.whl"
            download_verified(runtime["url"], runtime["archive_sha256"], wheel)
            with zipfile.ZipFile(wheel) as z:
                with (
                    z.open("litert_lm/liblitert-lm.dylib") as source,
                    (dest / "liblitert-lm.dylib").open("wb") as target,
                ):
                    shutil.copyfileobj(source, target)
    if not verify_existing(dest, expected):
        sys.exit("Installed macOS arm64 native libraries failed post-install SHA-256 verification")
    alias = dest / "liblitert-lm.so"
    if alias.exists() or alias.is_symlink():
        if alias.resolve() != (dest / "liblitert-lm.dylib").resolve():
            alias.unlink()
            alias.symlink_to("liblitert-lm.dylib")
    else:
        alias.symlink_to("liblitert-lm.dylib")
    return dest


def install_windows_x86_64(root: pathlib.Path, manifest: dict) -> pathlib.Path:
    dest = root / "native/windows"
    expected = manifest["files_windows_x86_64"]
    if not verify_existing(dest, expected):
        dest.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="outrider-native-") as temp:
            archive = pathlib.Path(temp) / "prebuilt.zip"
            download_verified(manifest["url"], manifest["archive_sha256"], archive)
            with zipfile.ZipFile(archive) as z:
                for name in expected:
                    member = f"prebuilt/{name}"
                    with z.open(member) as source, (dest / name).open("wb") as target:
                        shutil.copyfileobj(source, target)
    if not verify_existing(dest, expected):
        sys.exit("Installed Windows x86_64 native libraries failed post-install SHA-256 verification")
    return dest


def install_linux_x86_64(root: pathlib.Path, manifest: dict) -> pathlib.Path:
    dest = root / "native/linux"
    expected = manifest["files_linux_x86_64"]
    if not verify_existing(dest, expected):
        dest.mkdir(parents=True, exist_ok=True)
        runtime = manifest["runtime_linux_x86_64"]
        with tempfile.TemporaryDirectory(prefix="outrider-native-") as temp:
            wheel = pathlib.Path(temp) / "runtime-linux.whl"
            download_verified(runtime["url"], runtime["archive_sha256"], wheel)
            with zipfile.ZipFile(wheel) as z:
                with (
                    z.open("litert_lm/liblitert-lm.so") as source,
                    (dest / "liblitert-lm.so").open("wb") as target,
                ):
                    shutil.copyfileobj(source, target)
    if not verify_existing(dest, expected):
        sys.exit("Installed Linux x86_64 native libraries failed post-install SHA-256 verification")
    return dest


def main() -> None:
    parser = argparse.ArgumentParser(description="Install SHA-256-pinned LiteRT-LM native libraries.")
    parser.add_argument(
        "--target",
        choices=[
            "aarch64-apple-darwin",
            "x86_64-pc-windows-msvc",
            "x86_64-unknown-linux-gnu",
        ],
        default=None,
        help="Target triple (defaults to host platform).",
    )
    args = parser.parse_args()
    target = args.target or detect_target()
    root = pathlib.Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "native/manifest.json").read_text(encoding="utf-8"))
    if target == "aarch64-apple-darwin":
        dest = install_macos_arm64(root, manifest)
    elif target == "x86_64-pc-windows-msvc":
        dest = install_windows_x86_64(root, manifest)
    elif target == "x86_64-unknown-linux-gnu":
        dest = install_linux_x86_64(root, manifest)
    else:
        sys.exit(f"Unsupported target: {target}")
    print(f"Installed verified native runtime ({target}): {dest}")


if __name__ == "__main__":
    main()
