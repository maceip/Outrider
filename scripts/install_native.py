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
    library = dest / "litert-lm.dylib"
    if not library.exists():
        sys.exit("Pinned archive does not contain the required macOS runtime")
    (dest / "liblitert-lm.dylib").symlink_to(library.name) if not (dest / "liblitert-lm.dylib").exists() else None
    print("Installed verified native runtime:", dest)
