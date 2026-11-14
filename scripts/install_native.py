#!/usr/bin/env python3
"""Explicit native installation; cargo never downloads executable code."""
import hashlib
import json
import pathlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / "native/manifest.json").read_text())
if sys.platform != "darwin":
    sys.exit("The pinned archive was validated on macOS arm64 only; configure and pin native libraries for this platform first.")
with tempfile.TemporaryDirectory(prefix="outrider-native-") as temp:
    archive = pathlib.Path(temp) / "prebuilt.zip"
    urllib.request.urlretrieve(manifest["url"], archive)
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    if digest != manifest["archive_sha256"]:
        sys.exit("Native archive checksum mismatch; refusing installation")
    dest = root / "native/macos"
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            path = pathlib.PurePosixPath(name)
            if str(path.parent) == "prebuilt/macos" and path.suffix == ".dylib":
                with z.open(name) as source, (dest / path.name).open("wb") as target:
                    shutil.copyfileobj(source, target)
    runtime = manifest["runtime"]
    wheel = pathlib.Path(temp) / "runtime.whl"
    urllib.request.urlretrieve(runtime["url"], wheel)
    if hashlib.file_digest(wheel.open("rb"), "sha256").hexdigest() != runtime["archive_sha256"]:
        sys.exit("Native runtime checksum mismatch; refusing installation")
    with zipfile.ZipFile(wheel) as z:
        with z.open("litert_lm/liblitert-lm.dylib") as source, (dest / "liblitert-lm.dylib").open("wb") as target:
            shutil.copyfileobj(source, target)
    library = dest / "liblitert-lm.dylib"
    if not library.exists():
        sys.exit("Pinned archive does not contain the required macOS runtime")
    alias = dest / "liblitert-lm.so"
    if not alias.exists():
        alias.symlink_to(library.name)
    print("Installed verified native runtime:", dest)
