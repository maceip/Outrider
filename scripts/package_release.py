#!/usr/bin/env python3
"""Packages verified Outrider release binaries, bundled LiteRT-LM runtimes, macOS .dmg, and Windows WiX .msi."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid
import zipfile


def sha256_file(path: pathlib.Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def detect_target() -> str:
    machine = platform.machine().lower()
    if sys.platform == "darwin" and machine in ("arm64", "aarch64"):
        return "aarch64-apple-darwin"
    if sys.platform == "win32" and machine in ("amd64", "x86_64"):
        return "x86_64-pc-windows-msvc"
    if sys.platform.startswith("linux") and machine in ("amd64", "x86_64"):
        return "x86_64-unknown-linux-gnu"
    sys.exit(f"Unsupported host platform: {sys.platform}/{machine}")


def read_cargo_version(root: pathlib.Path) -> str:
    text = (root / "proxyfor/Cargo.toml").read_text(encoding="utf-8")
    match = re.search(r'(?ms)^\[package\]\s+.*?^version\s*=\s*"(\d+\.\d+\.\d+)"', text)
    if not match:
        sys.exit("Unable to read version from proxyfor/Cargo.toml")
    return match.group(1)


def copy_licenses(root: pathlib.Path, dest: pathlib.Path) -> None:
    for name in ("LICENSE-MIT", "LICENSE-APACHE"):
        src = root / name
        if src.is_file():
            shutil.copy2(src, dest / name)


def verify_native_files(native_dir: pathlib.Path, expected: dict[str, str], runtime_only_suffix: str) -> list[pathlib.Path]:
    runtime_files: list[pathlib.Path] = []
    for filename, expected_sha in expected.items():
        candidate = native_dir / filename
        if not candidate.is_file():
            sys.exit(f"Missing pinned native file: {candidate}")
        actual_sha = sha256_file(candidate)
        if actual_sha != expected_sha:
            sys.exit(
                f"SHA-256 mismatch for {candidate}: expected {expected_sha}, got {actual_sha}"
            )
        if filename.endswith(runtime_only_suffix):
            runtime_files.append(candidate)
    return runtime_files


def package_macos(
    root: pathlib.Path,
    bin_dir: pathlib.Path,
    out_dir: pathlib.Path,
    version: str,
    manifest: dict,
) -> list[pathlib.Path]:
    exe = bin_dir / "outrider"
    if not exe.is_file():
        sys.exit(f"Missing compiled binary: {exe}")

    dylibs = verify_native_files(root / "native/macos", manifest["files_macos_arm64"], ".dylib")
    produced: list[pathlib.Path] = []

    with tempfile.TemporaryDirectory(prefix="outrider-pkg-macos-") as tmp:
        tmp_path = pathlib.Path(tmp)

        # 1. Standalone portable tar.gz (`outrider` + `lib/*.dylib`)
        stem = f"outrider-v{version}-aarch64-apple-darwin"
        stage = tmp_path / stem
        lib_dir = stage / "lib"
        lib_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exe, stage / "outrider")
        os.chmod(stage / "outrider", 0o755)
        for dylib in dylibs:
            shutil.copy2(dylib, lib_dir / dylib.name)
        (lib_dir / "liblitert-lm.so").symlink_to("liblitert-lm.dylib")
        copy_licenses(root, stage)

        tar_path = out_dir / f"{stem}.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tf:
            tf.add(stage, arcname=stem)
        produced.append(tar_path)

        # 2. Native macOS Application Bundle (`Outrider.app`) + `.dmg`
        dmg_stage = tmp_path / "dmg"
        app_dir = dmg_stage / "Outrider.app"
        contents_dir = app_dir / "Contents"
        macos_dir = contents_dir / "MacOS"
        frameworks_dir = contents_dir / "Frameworks"
        macos_dir.mkdir(parents=True, exist_ok=True)
        frameworks_dir.mkdir(parents=True, exist_ok=True)

        shutil.copy2(exe, macos_dir / "outrider")
        os.chmod(macos_dir / "outrider", 0o755)
        for dylib in dylibs:
            shutil.copy2(dylib, frameworks_dir / dylib.name)
        (frameworks_dir / "liblitert-lm.so").symlink_to("liblitert-lm.dylib")

        info_plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Outrider</string>
  <key>CFBundleExecutable</key>
  <string>outrider</string>
  <key>CFBundleIdentifier</key>
  <string>com.silvector.outrider</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Outrider</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>{version}</string>
  <key>CFBundleVersion</key>
  <string>{version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <false/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
"""
        (contents_dir / "Info.plist").write_text(info_plist, encoding="utf-8")

        subprocess.run(
            ["codesign", "--force", "--deep", "--sign", "-", str(app_dir)],
            check=True,
        )
        subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", str(app_dir)],
            check=True,
        )

        (dmg_stage / "Applications").symlink_to("/Applications")
        dmg_path = out_dir / f"Outrider-v{version}-macos-arm64.dmg"
        if dmg_path.exists():
            dmg_path.unlink()
        subprocess.run(
            [
                "hdiutil",
                "create",
                "-volname",
                f"Outrider v{version}",
                "-srcfolder",
                str(dmg_stage),
                "-ov",
                "-format",
                "UDZO",
                str(dmg_path),
            ],
            check=True,
        )
        produced.append(dmg_path)

    return produced


def find_wix_v3_tools() -> tuple[pathlib.Path, pathlib.Path] | None:
    candle = shutil.which("candle") or shutil.which("candle.exe")
    light = shutil.which("light") or shutil.which("light.exe")
    if candle and light:
        return pathlib.Path(candle), pathlib.Path(light)

    wix_env = os.environ.get("WIX")
    candidates: list[pathlib.Path] = []
    if wix_env:
        candidates.append(pathlib.Path(wix_env) / "bin")
    prog_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    p86 = pathlib.Path(prog_x86)
    if p86.is_dir():
        for entry in sorted(p86.glob("WiX Toolset*"), reverse=True):
            candidates.append(entry / "bin")

    for bin_path in candidates:
        c = bin_path / "candle.exe"
        l = bin_path / "light.exe"
        if c.is_file() and l.is_file():
            return c, l
    return None


def build_windows_msi(
    stage_dir: pathlib.Path,
    dll_names: list[str],
    version: str,
    msi_out: pathlib.Path,
) -> None:
    upgrade_code = "8F41B3E6-3E92-4C6D-9B4C-7A1802A45D19"
    wix_v3 = find_wix_v3_tools()

    with tempfile.TemporaryDirectory(prefix="outrider-wix-") as wix_tmp:
        tmp_path = pathlib.Path(wix_tmp)
        if wix_v3 is not None:
            candle_exe, light_exe = wix_v3
            dll_components = []
            dll_refs = []
            for idx, dll_name in enumerate(dll_names):
                comp_id = f"CmpDll{idx}"
                file_id = f"FilDll{idx}"
                comp_guid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://silvector.com/outrider/{dll_name}")).upper()
                dll_components.append(
                    f"""      <Component Id="{comp_id}" Guid="{comp_guid}" Win64="yes">
        <File Id="{file_id}" Source="$(var.StageDir)\\{dll_name}" KeyPath="yes" />
      </Component>"""
                )
                dll_refs.append(f'      <ComponentRef Id="{comp_id}" />')

            wxs = f"""<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*"
           Name="Outrider"
           Language="1033"
           Version="{version}.0"
           Manufacturer="Silvector"
           UpgradeCode="{upgrade_code}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Platform="x64" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of Outrider is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLFOLDER" Name="Outrider">
          <Component Id="CmpOutriderExe" Guid="3D7A5E14-92A1-49D2-A7C0-6118D3F01001" Win64="yes">
            <File Id="FilOutriderExe" Source="$(var.StageDir)\\outrider.exe" KeyPath="yes" />
            <Environment Id="EnvPathOutrider" Name="PATH" Value="[INSTALLFOLDER]" Permanent="no" Part="last" Action="set" System="yes" />
          </Component>
{os.linesep.join(dll_components)}
        </Directory>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ApplicationProgramsFolder" Name="Outrider">
          <Component Id="CmpStartMenuShortcut" Guid="3D7A5E14-92A1-49D2-A7C0-6118D3F01002" Win64="yes">
            <Shortcut Id="ApplicationStartMenuShortcut"
                      Name="Outrider Command Center"
                      Description="Launch Outrider MCP Commerce Gateway and Command Center"
                      Target="[INSTALLFOLDER]outrider.exe"
                      WorkingDirectory="INSTALLFOLDER" />
            <RemoveFolder Id="CleanUpShortCut" Directory="ApplicationProgramsFolder" On="uninstall" />
            <RegistryValue Root="HKMU" Key="Software\\Silvector\\Outrider" Name="installed" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
    </Directory>

    <Feature Id="ProductFeature" Title="Outrider" Level="1">
      <ComponentRef Id="CmpOutriderExe" />
      <ComponentRef Id="CmpStartMenuShortcut" />
{os.linesep.join(dll_refs)}
    </Feature>
  </Product>
</Wix>
"""
            wxs_path = tmp_path / "outrider.wxs"
            wixobj_path = tmp_path / "outrider.wixobj"
            wxs_path.write_text(wxs, encoding="utf-8")
            subprocess.run(
                [
                    str(candle_exe),
                    "-nologo",
                    "-arch",
                    "x64",
                    f"-dStageDir={stage_dir}",
                    "-out",
                    str(wixobj_path),
                    str(wxs_path),
                ],
                check=True,
            )
            subprocess.run(
                [
                    str(light_exe),
                    "-nologo",
                    "-sval",
                    "-spdb",
                    "-out",
                    str(msi_out),
                    str(wixobj_path),
                ],
                check=True,
            )
            for stray_pdb in msi_out.parent.glob("*.wixpdb"):
                stray_pdb.unlink(missing_ok=True)
            return

        wix_v4 = shutil.which("wix") or shutil.which("wix.exe")
        if wix_v4:
            v4_components = []
            for idx, dll_name in enumerate(dll_names):
                v4_components.append(
                    f'        <Component Id="CmpDll{idx}"><File Source="{stage_dir / dll_name}" /></Component>'
                )
            wxs4 = f"""<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="Outrider"
           Manufacturer="Silvector"
           Version="{version}.0"
           UpgradeCode="{upgrade_code}"
           Scope="perMachine">
    <MajorUpgrade DowngradeErrorMessage="A newer version of Outrider is already installed." />
    <MediaTemplate EmbedCab="yes" />
    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="Outrider">
        <Component Id="CmpOutriderExe">
          <File Id="FilOutriderExe" Source="{stage_dir / 'outrider.exe'}" />
        </Component>
{os.linesep.join(v4_components)}
      </Directory>
    </StandardDirectory>
  </Package>
</Wix>
"""
            wxs4_path = tmp_path / "outrider-v4.wxs"
            wxs4_path.write_text(wxs4, encoding="utf-8")
            subprocess.run(
                [wix_v4, "build", "-arch", "x64", "-pdbtype", "none", "-o", str(msi_out), str(wxs4_path)],
                check=True,
            )
            for stray_pdb in msi_out.parent.glob("*.wixpdb"):
                stray_pdb.unlink(missing_ok=True)
            return

        sys.exit("Neither WiX v3 (candle.exe/light.exe) nor WiX v4+ (wix.exe) was found on Windows host.")


def package_windows(
    root: pathlib.Path,
    bin_dir: pathlib.Path,
    out_dir: pathlib.Path,
    version: str,
    manifest: dict,
) -> list[pathlib.Path]:
    exe = bin_dir / "outrider.exe"
    if not exe.is_file():
        sys.exit(f"Missing compiled binary: {exe}")

    dlls = verify_native_files(root / "native/windows", manifest["files_windows_x86_64"], ".dll")
    produced: list[pathlib.Path] = []

    with tempfile.TemporaryDirectory(prefix="outrider-pkg-win-") as tmp:
        tmp_path = pathlib.Path(tmp)
        stem = f"outrider-v{version}-x86_64-pc-windows-msvc"
        stage = tmp_path / stem
        stage.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exe, stage / "outrider.exe")
        for dll in dlls:
            shutil.copy2(dll, stage / dll.name)
        copy_licenses(root, stage)

        zip_path = out_dir / f"{stem}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in sorted(stage.rglob("*")):
                if item.is_file():
                    zf.write(item, arcname=str(pathlib.PurePosixPath(stem) / item.relative_to(stage)))
        produced.append(zip_path)

        msi_path = out_dir / f"Outrider-v{version}-windows-x64.msi"
        build_windows_msi(stage, [d.name for d in dlls], version, msi_path)
        produced.append(msi_path)

    return produced


def package_linux(
    root: pathlib.Path,
    bin_dir: pathlib.Path,
    out_dir: pathlib.Path,
    version: str,
    manifest: dict,
) -> list[pathlib.Path]:
    exe = bin_dir / "outrider"
    if not exe.is_file():
        sys.exit(f"Missing compiled binary: {exe}")

    sos = verify_native_files(root / "native/linux", manifest["files_linux_x86_64"], ".so")
    produced: list[pathlib.Path] = []

    with tempfile.TemporaryDirectory(prefix="outrider-pkg-linux-") as tmp:
        tmp_path = pathlib.Path(tmp)
        stem = f"outrider-v{version}-x86_64-unknown-linux-gnu"
        stage = tmp_path / stem
        lib_dir = stage / "lib"
        lib_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exe, stage / "outrider")
        os.chmod(stage / "outrider", 0o755)
        for so in sos:
            shutil.copy2(so, lib_dir / so.name)
        copy_licenses(root, stage)

        tar_path = out_dir / f"{stem}.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tf:
            tf.add(stage, arcname=stem)
        produced.append(tar_path)

    return produced


def main() -> None:
    parser = argparse.ArgumentParser(description="Package Outrider release artifacts and desktop installers.")
    parser.add_argument(
        "--target",
        choices=[
            "aarch64-apple-darwin",
            "x86_64-pc-windows-msvc",
            "x86_64-unknown-linux-gnu",
        ],
        default=None,
    )
    parser.add_argument("--version", default=None, help="Release version (defaults to Cargo.toml).")
    parser.add_argument("--bin-dir", default=None, help="Directory containing compiled outrider binary.")
    parser.add_argument("--out-dir", default="dist", help="Output directory for packaged artifacts.")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parents[1]
    target = args.target or detect_target()
    version = args.version or read_cargo_version(root)

    if args.bin_dir:
        bin_dir = pathlib.Path(args.bin_dir).resolve()
    else:
        triple_release = root / "target" / target / "release"
        bin_dir = triple_release if triple_release.is_dir() else (root / "target/release")

    out_dir = pathlib.Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = root / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads((root / "native/manifest.json").read_text(encoding="utf-8"))

    if target == "aarch64-apple-darwin":
        artifacts = package_macos(root, bin_dir, out_dir, version, manifest)
    elif target == "x86_64-pc-windows-msvc":
        artifacts = package_windows(root, bin_dir, out_dir, version, manifest)
    elif target == "x86_64-unknown-linux-gnu":
        artifacts = package_linux(root, bin_dir, out_dir, version, manifest)
    else:
        sys.exit(f"Unsupported target: {target}")

    for artifact in artifacts:
        digest = sha256_file(artifact)
        print(f"{digest}  {artifact}")


if __name__ == "__main__":
    main()
