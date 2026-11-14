#!/usr/bin/env python3
"""Generates and strictly verifies complete PURL-tagged SPDX 2.3 and CycloneDX 1.5 SBOMs for Outrider.

Covers 100% of:
  1. Direct and transitive Rust crates in `Cargo.lock` + `cargo metadata --locked` (`pkg:cargo/<name>@<version>`)
  2. Direct and transitive npm packages in `dashboard/package-lock.json` (`pkg:npm/<name>@<version>`)
  3. Bundled SHA-256-pinned C++/GPU LiteRT-LM native libraries in `native/manifest.json` (`pkg:generic/litert-lm/<file>@0.18.0`)

Hard-fails if even a single resolved crate, npm package, or native binary lacks a versioned PURL tag.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tomllib
import urllib.parse
import uuid


def sha256_file(path: pathlib.Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def sanitize_spdx_id(raw: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9.\-]+", "-", raw).strip("-")
    return f"SPDXRef-{cleaned}" if cleaned else f"SPDXRef-{uuid.uuid4().hex[:8]}"


def build_npm_purl(name: str, version: str) -> str:
    if name.startswith("@") and "/" in name:
        scope, pkg = name.split("/", 1)
        encoded_scope = urllib.parse.quote(scope, safe="")
        return f"pkg:npm/{encoded_scope}/{pkg}@{version}"
    return f"pkg:npm/{name}@{version}"


def read_cargo_metadata(root: pathlib.Path) -> dict[tuple[str, str], dict]:
    out = subprocess.check_output(
        ["cargo", "metadata", "--locked", "--format-version", "1"],
        cwd=str(root),
    )
    meta = json.loads(out.decode("utf-8"))
    by_key: dict[tuple[str, str], dict] = {}
    for pkg in meta.get("packages", []):
        by_key[(pkg["name"], pkg["version"])] = pkg
    return by_key


def collect_cargo_components(root: pathlib.Path) -> tuple[list[dict], list[tuple[str, str]]]:
    cargo_lock = tomllib.loads((root / "Cargo.lock").read_text(encoding="utf-8"))
    meta_by_key = read_cargo_metadata(root)

    components: list[dict] = []
    id_by_name_ver: dict[tuple[str, str], str] = {}
    by_name: dict[str, list[tuple[str, str]]] = {}

    raw_packages = cargo_lock.get("package", [])
    for idx, pkg in enumerate(raw_packages):
        name = pkg["name"]
        version = pkg["version"]
        source = pkg.get("source")
        checksum = pkg.get("checksum")
        meta = meta_by_key.get((name, version), {})
        license_expr = meta.get("license") or "NOASSERTION"

        if source and source.startswith("registry+"):
            purl = f"pkg:cargo/{name}@{version}"
            download_location = f"https://crates.io/api/v1/crates/{name}/{version}/download"
        else:
            purl = f"pkg:cargo/{name}@{version}?vcs_url=local-workspace"
            download_location = "NOASSERTION"

        comp_id = f"cargo-{name}-{version}-{idx}"
        id_by_name_ver[(name, version)] = comp_id
        by_name.setdefault(name, []).append((version, comp_id))

        components.append(
            {
                "id": comp_id,
                "ecosystem": "cargo",
                "name": name,
                "version": version,
                "purl": purl,
                "license": license_expr,
                "sha256": checksum,
                "download_location": download_location,
                "raw_deps": pkg.get("dependencies", []),
            }
        )

    edges: list[tuple[str, str]] = []
    for comp in components:
        src_id = comp["id"]
        for dep_entry in comp.pop("raw_deps", []):
            parts = dep_entry.split()
            dep_name = parts[0]
            if len(parts) >= 2 and re.match(r"^\d+\.\d+", parts[1]):
                target_id = id_by_name_ver.get((dep_name, parts[1]))
                if target_id:
                    edges.append((src_id, target_id))
            else:
                candidates = by_name.get(dep_name, [])
                if len(candidates) == 1:
                    edges.append((src_id, candidates[0][1]))

    return components, edges


def extract_npm_name_from_key(path_key: str, entry: dict) -> str | None:
    if isinstance(entry.get("name"), str) and entry["name"].strip():
        return entry["name"].strip()
    marker = "node_modules/"
    pos = path_key.rfind(marker)
    if pos == -1:
        return None
    return path_key[pos + len(marker) :]


def collect_npm_components(root: pathlib.Path) -> list[dict]:
    lock_path = root / "dashboard/package-lock.json"
    lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = lock_data.get("packages", {})
    seen_keys: set[tuple[str, str]] = set()
    components: list[dict] = []

    for path_key, entry in sorted(packages.items()):
        if path_key == "":
            continue
        if not isinstance(entry, dict):
            continue
        version = entry.get("version")
        name = extract_npm_name_from_key(path_key, entry)
        if not name or not version:
            sys.exit(f"NPM package entry '{path_key}' in dashboard/package-lock.json lacks name or version")

        dedup_key = (name, version)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        purl = build_npm_purl(name, version)
        license_val = entry.get("license")
        if isinstance(license_val, list):
            license_expr = " AND ".join(str(x) for x in license_val) or "NOASSERTION"
        elif isinstance(license_val, str) and license_val.strip():
            license_expr = license_val.strip()
        else:
            license_expr = "NOASSERTION"

        resolved = entry.get("resolved")
        download_location = (
            resolved if isinstance(resolved, str) and resolved.startswith("http") else "NOASSERTION"
        )

        # Convert SRI sha512/sha256 integrity if sha256 is present
        sha256_hex = None
        integrity = entry.get("integrity")
        if isinstance(integrity, str) and integrity.startswith("sha256-"):
            import base64

            try:
                sha256_hex = base64.b64decode(integrity[len("sha256-") :]).hex()
            except Exception:
                sha256_hex = None

        components.append(
            {
                "id": f"npm-{name}-{version}",
                "ecosystem": "npm",
                "name": name,
                "version": version,
                "purl": purl,
                "license": license_expr,
                "sha256": sha256_hex,
                "download_location": download_location,
            }
        )

    return components


def collect_native_components(root: pathlib.Path) -> list[dict]:
    manifest = json.loads((root / "native/manifest.json").read_text(encoding="utf-8"))
    groups = [
        ("aarch64-apple-darwin", manifest.get("files_macos_arm64", {}), manifest["runtime"]["url"]),
        ("x86_64-pc-windows-msvc", manifest.get("files_windows_x86_64", {}), manifest["url"]),
        (
            "x86_64-unknown-linux-gnu",
            manifest.get("files_linux_x86_64", {}),
            manifest["runtime_linux_x86_64"]["url"],
        ),
    ]
    components: list[dict] = []
    for target_triple, files_map, download_url in groups:
        for filename, sha256_hex in sorted(files_map.items()):
            purl = f"pkg:generic/litert-lm/{filename}@0.18.0?arch={target_triple}"
            components.append(
                {
                    "id": f"native-{target_triple}-{filename}",
                    "ecosystem": "native",
                    "name": f"litert-lm/{filename}",
                    "version": "0.18.0",
                    "purl": purl,
                    "license": "Apache-2.0",
                    "sha256": sha256_hex,
                    "download_location": download_url,
                    "target": target_triple,
                }
            )
    return components


def emit_spdx(
    version: str,
    artifacts: list[pathlib.Path],
    all_components: list[dict],
    cargo_edges: list[tuple[str, str]],
) -> dict:
    created = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    root_spdx_id = "SPDXRef-Package-outrider"

    packages = [
        {
            "SPDXID": root_spdx_id,
            "name": "outrider",
            "versionInfo": version,
            "downloadLocation": "https://github.com/maceip/Outrider",
            "filesAnalyzed": False,
            "licenseConcluded": "MIT OR Apache-2.0",
            "licenseDeclared": "MIT OR Apache-2.0",
            "primaryPackagePurpose": "APPLICATION",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": f"pkg:cargo/proxyfor@{version}",
                }
            ],
            "checksums": [
                {"algorithm": "SHA256", "checksumValue": sha256_file(art)} for art in artifacts
            ],
        }
    ]

    relationships = [
        {
            "spdxElementId": "SPDXRef-DOCUMENT",
            "relationshipType": "DESCRIBES",
            "relatedSpdxElement": root_spdx_id,
        }
    ]

    spdx_id_by_comp: dict[str, str] = {}
    used_ids: set[str] = {root_spdx_id, "SPDXRef-DOCUMENT"}

    for comp in all_components:
        base_id = sanitize_spdx_id(comp["id"])
        spdx_id = base_id
        suffix = 1
        while spdx_id in used_ids:
            suffix += 1
            spdx_id = f"{base_id}-{suffix}"
        used_ids.add(spdx_id)
        spdx_id_by_comp[comp["id"]] = spdx_id

        pkg_obj: dict = {
            "SPDXID": spdx_id,
            "name": comp["name"],
            "versionInfo": comp["version"],
            "downloadLocation": comp["download_location"],
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": comp["license"] if comp["license"] != "NOASSERTION" else "NOASSERTION",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": comp["purl"],
                }
            ],
        }
        if comp.get("sha256"):
            pkg_obj["checksums"] = [{"algorithm": "SHA256", "checksumValue": comp["sha256"]}]
        packages.append(pkg_obj)

        if not (comp["ecosystem"] == "cargo" and comp["name"] == "proxyfor"):
            relationships.append(
                {
                    "spdxElementId": root_spdx_id,
                    "relationshipType": "DEPENDS_ON",
                    "relatedSpdxElement": spdx_id,
                }
            )

    for src_comp, dst_comp in cargo_edges:
        src_spdx = spdx_id_by_comp.get(src_comp)
        dst_spdx = spdx_id_by_comp.get(dst_comp)
        if src_spdx and dst_spdx:
            relationships.append(
                {
                    "spdxElementId": src_spdx,
                    "relationshipType": "DEPENDS_ON",
                    "relatedSpdxElement": dst_spdx,
                }
            )

    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"outrider-v{version}",
        "documentNamespace": f"https://github.com/maceip/Outrider/releases/tag/v{version}/spdx/{uuid.uuid4()}",
        "creationInfo": {
            "created": created,
            "creators": ["Tool: outrider-generate-sbom-1.0", "Organization: Silvector"],
        },
        "packages": packages,
        "relationships": relationships,
    }


def emit_cyclonedx(
    version: str,
    artifacts: list[pathlib.Path],
    all_components: list[dict],
    cargo_edges: list[tuple[str, str]],
) -> dict:
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cdx_components = []
    for comp in all_components:
        c_obj: dict = {
            "type": "library",
            "bom-ref": comp["purl"],
            "name": comp["name"],
            "version": comp["version"],
            "purl": comp["purl"],
            "properties": [{"name": "outrider:ecosystem", "value": comp["ecosystem"]}],
        }
        if comp.get("sha256"):
            c_obj["hashes"] = [{"alg": "SHA-256", "content": comp["sha256"]}]
        if comp["license"] != "NOASSERTION":
            c_obj["licenses"] = [{"license": {"name": comp["license"]}}]
        cdx_components.append(c_obj)

    purl_by_id = {c["id"]: c["purl"] for c in all_components}
    deps_map: dict[str, set[str]] = {c["purl"]: set() for c in all_components}
    for src_id, dst_id in cargo_edges:
        s_purl = purl_by_id.get(src_id)
        d_purl = purl_by_id.get(dst_id)
        if s_purl and d_purl:
            deps_map[s_purl].add(d_purl)

    root_ref = f"pkg:cargo/proxyfor@{version}"
    dependencies = [
        {
            "ref": root_ref,
            "dependsOn": sorted(c["purl"] for c in all_components if c["purl"] != root_ref),
        }
    ]
    for ref_purl, targets in sorted(deps_map.items()):
        if ref_purl != root_ref:
            dependencies.append({"ref": ref_purl, "dependsOn": sorted(targets)})

    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": timestamp,
            "tools": [{"vendor": "Silvector", "name": "outrider-generate-sbom", "version": "1.0.0"}],
            "component": {
                "type": "application",
                "bom-ref": root_ref,
                "name": "outrider",
                "version": version,
                "purl": root_ref,
                "hashes": [
                    {"alg": "SHA-256", "content": sha256_file(art)} for art in artifacts
                ],
            },
        },
        "components": cdx_components,
        "dependencies": dependencies,
    }


def verify_100_percent_coverage(root: pathlib.Path, spdx_doc: dict, cdx_doc: dict) -> tuple[int, int, int]:
    spdx_purls: set[str] = set()
    for pkg in spdx_doc.get("packages", []):
        refs = pkg.get("externalRefs", [])
        purls = [r["referenceLocator"] for r in refs if r.get("referenceType") == "purl"]
        if not purls or not pkg.get("versionInfo"):
            sys.exit(f"SPDX verification failed: package '{pkg.get('name')}' lacks versioned PURL")
        spdx_purls.update(purls)

    cdx_purls: set[str] = set()
    for comp in cdx_doc.get("components", []):
        purl = comp.get("purl", "")
        if not purl.startswith("pkg:") or "@" not in purl or not comp.get("version"):
            sys.exit(f"CycloneDX verification failed: component '{comp.get('name')}' lacks versioned PURL")
        cdx_purls.add(purl)

    # 1. Verify every crate in Cargo.lock is tagged in both SBOMs
    cargo_lock = tomllib.loads((root / "Cargo.lock").read_text(encoding="utf-8"))
    cargo_count = 0
    for pkg in cargo_lock.get("package", []):
        name, ver = pkg["name"], pkg["version"]
        prefix = f"pkg:cargo/{name}@{ver}"
        if not any(p == prefix or p.startswith(f"{prefix}?") for p in spdx_purls):
            sys.exit(f"Untagged Cargo dependency in SPDX SBOM: {name}@{ver}")
        if not any(p == prefix or p.startswith(f"{prefix}?") for p in cdx_purls):
            sys.exit(f"Untagged Cargo dependency in CycloneDX SBOM: {name}@{ver}")
        cargo_count += 1

    # 2. Verify every npm package in dashboard/package-lock.json is tagged in both SBOMs
    npm_lock = json.loads((root / "dashboard/package-lock.json").read_text(encoding="utf-8"))
    npm_seen: set[tuple[str, str]] = set()
    for path_key, entry in npm_lock.get("packages", {}).items():
        if path_key == "" or not isinstance(entry, dict):
            continue
        name = extract_npm_name_from_key(path_key, entry)
        ver = entry.get("version")
        assert name and ver
        npm_seen.add((name, ver))
        expected_purl = build_npm_purl(name, ver)
        if expected_purl not in spdx_purls:
            sys.exit(f"Untagged npm dependency in SPDX SBOM: {expected_purl}")
        if expected_purl not in cdx_purls:
            sys.exit(f"Untagged npm dependency in CycloneDX SBOM: {expected_purl}")

    # 3. Verify every native binary in native/manifest.json is tagged in both SBOMs
    manifest = json.loads((root / "native/manifest.json").read_text(encoding="utf-8"))
    native_count = 0
    for triple, key in (
        ("aarch64-apple-darwin", "files_macos_arm64"),
        ("x86_64-pc-windows-msvc", "files_windows_x86_64"),
        ("x86_64-unknown-linux-gnu", "files_linux_x86_64"),
    ):
        for filename in manifest.get(key, {}):
            expected_purl = f"pkg:generic/litert-lm/{filename}@0.18.0?arch={triple}"
            if expected_purl not in spdx_purls or expected_purl not in cdx_purls:
                sys.exit(f"Untagged native dependency in SBOM: {expected_purl}")
            native_count += 1

    return cargo_count, len(npm_seen), native_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate and verify full PURL-tagged SPDX 2.3 and CycloneDX 1.5 SBOMs.")
    parser.add_argument("--version", default=None, help="Release version X.Y.Z (defaults to proxyfor/Cargo.toml).")
    parser.add_argument("--out-dir", default="dist", help="Directory to write *.sbom.spdx.json and *.sbom.cdx.json.")
    parser.add_argument(
        "--artifact",
        action="append",
        default=[],
        help="Optional packaged binary artifact path(s) whose SHA-256 digests are bound into the root package.",
    )
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parents[1]
    cargo_toml_text = (root / "proxyfor/Cargo.toml").read_text(encoding="utf-8")
    ver_match = re.search(r'(?ms)^\[package\]\s+.*?^version\s*=\s*"(\d+\.\d+\.\d+)"', cargo_toml_text)
    if not ver_match:
        sys.exit("Unable to determine version from proxyfor/Cargo.toml")
    version = args.version or ver_match.group(1)

    out_dir = pathlib.Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = root / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    artifact_paths = [pathlib.Path(p).resolve() for p in args.artifact]
    for art in artifact_paths:
        if not art.is_file():
            sys.exit(f"Artifact file not found for SBOM binding: {art}")

    cargo_comps, cargo_edges = collect_cargo_components(root)
    npm_comps = collect_npm_components(root)
    native_comps = collect_native_components(root)
    all_comps = cargo_comps + npm_comps + native_comps

    spdx_doc = emit_spdx(version, artifact_paths, all_comps, cargo_edges)
    cdx_doc = emit_cyclonedx(version, artifact_paths, all_comps, cargo_edges)

    cargo_n, npm_n, native_n = verify_100_percent_coverage(root, spdx_doc, cdx_doc)

    spdx_path = out_dir / f"outrider-v{version}.sbom.spdx.json"
    cdx_path = out_dir / f"outrider-v{version}.sbom.cdx.json"
    spdx_path.write_text(json.dumps(spdx_doc, indent=2) + "\n", encoding="utf-8")
    cdx_path.write_text(json.dumps(cdx_doc, indent=2) + "\n", encoding="utf-8")

    print(
        f"[sbom] Verified 100% PURL coverage ({cargo_n} Cargo crates, {npm_n} npm packages, {native_n} native libs):\n"
        f"  SPDX 2.3:      {spdx_path} ({spdx_path.stat().st_size} bytes)\n"
        f"  CycloneDX 1.5: {cdx_path} ({cdx_path.stat().st_size} bytes)"
    )


if __name__ == "__main__":
    main()
