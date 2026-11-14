//! No network access: verify the explicitly installed, pinned native runtime and embed dashboard static export.
use sha2::{Digest, Sha256};

fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=UTF-8",
        Some("css") => "text/css; charset=UTF-8",
        Some("js" | "mjs") => "application/javascript; charset=UTF-8",
        Some("json" | "map") => "application/json; charset=UTF-8",
        Some("txt") => "text/plain; charset=UTF-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn collect_dashboard_files(
    base: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<(String, &'static str, std::path::PathBuf)>,
) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        println!("cargo:rerun-if-changed={}", path.display());
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_dashboard_files(base, &path, out);
        } else if file_type.is_file()
            && let Ok(rel) = path.strip_prefix(base)
        {
            let mut rel_str = String::new();
            for comp in rel.components() {
                if let std::path::Component::Normal(seg) = comp {
                    rel_str.push('/');
                    rel_str.push_str(&seg.to_string_lossy());
                }
            }
            if !rel_str.is_empty() {
                out.push((rel_str, mime_for_path(&path), path));
            }
        }
    }
}

fn generate_dashboard_assets(root: &std::path::Path) {
    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let dest = out_dir.join("dashboard_assets.rs");
    let dashboard_out = root.join("dashboard/out");
    println!("cargo:rerun-if-changed={}", dashboard_out.display());
    if !dashboard_out.join("index.html").is_file() {
        std::fs::write(
            &dest,
            "pub static DASHBOARD_ASSETS: &[(&str, &str, &[u8])] = &[];\n",
        )
        .expect("write empty dashboard_assets.rs");
        return;
    }
    let mut files = Vec::new();
    collect_dashboard_files(&dashboard_out, &dashboard_out, &mut files);
    files.retain(|(_, _, p)| p.is_file());
    files.sort_by(|a, b| a.0.cmp(&b.0));
    if !files.iter().any(|(rel, _, _)| rel == "/index.html") {
        std::fs::write(
            &dest,
            "pub static DASHBOARD_ASSETS: &[(&str, &str, &[u8])] = &[];\n",
        )
        .expect("write empty dashboard_assets.rs");
        return;
    }
    let mut generated = String::from("pub static DASHBOARD_ASSETS: &[(&str, &str, &[u8])] = &[\n");
    for (rel_path, mime, abs_path) in files {
        let abs_str = abs_path.to_str().expect("UTF-8 dashboard asset path");
        generated.push_str(&format!(
            "    ({rel_path:?}, {mime:?}, include_bytes!({abs_str:?})),\n"
        ));
    }
    generated.push_str("];\n");
    std::fs::write(&dest, generated).expect("write dashboard_assets.rs");
}

fn verify_pinned_files(dir: &std::path::Path, map: &serde_json::Map<String, serde_json::Value>) {
    for (name, digest) in map {
        let file = dir.join(name);
        println!("cargo:rerun-if-changed={}", file.display());
        let bytes = std::fs::read(&file).unwrap_or_else(|_| {
            panic!(
                "Missing pinned native library {}. Run `python3 scripts/install_native.py` before building.",
                file.display()
            )
        });
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            digest.as_str().expect("SHA-256 hex string"),
            "Native library checksum mismatch: {}. Reinstall with scripts/install_native.py",
            file.display()
        );
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=LITERT_LM_LIB_DIR");
    let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    generate_dashboard_assets(&root);
    let manifest = root.join("native/manifest.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let pinned: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest).expect("native manifest"))
            .expect("native manifest JSON");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    match (target_os.as_str(), target_arch.as_str()) {
        ("macos", "aarch64") => {
            let dir = std::env::var_os("LITERT_LM_LIB_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| root.join("native/macos"));
            verify_pinned_files(
                &dir,
                pinned["files_macos_arm64"]
                    .as_object()
                    .expect("pinned macos arm64 native hashes"),
            );
            let alias = dir.join("liblitert-lm.so");
            println!("cargo:rerun-if-changed={}", alias.display());
            assert_eq!(
                std::fs::canonicalize(&alias).expect("native runtime loader alias"),
                std::fs::canonicalize(dir.join("liblitert-lm.dylib")).unwrap(),
                "Native runtime loader alias must point to the pinned library"
            );
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/lib");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../../native/macos");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../../../native/macos");
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
        ("windows", "x86_64") => {
            let dir = std::env::var_os("LITERT_LM_LIB_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| root.join("native/windows"));
            verify_pinned_files(
                &dir,
                pinned["files_windows_x86_64"]
                    .as_object()
                    .expect("pinned windows x86_64 native hashes"),
            );
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
        ("linux", "x86_64") => {
            let dir = std::env::var_os("LITERT_LM_LIB_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| root.join("native/linux"));
            verify_pinned_files(
                &dir,
                pinned["files_linux_x86_64"]
                    .as_object()
                    .expect("pinned linux x86_64 native hashes"),
            );
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/lib");
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../../native/linux");
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../../../native/linux");
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
        _ => {}
    }
}
