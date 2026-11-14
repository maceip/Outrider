//! No network access: verify the explicitly installed, pinned macOS runtime.
use sha2::{Digest, Sha256};
fn main() {
    println!("cargo:rerun-if-env-changed=LITERT_LM_LIB_DIR");
    let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    let manifest = root.join("native/manifest.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos")
        || std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() != Ok("aarch64")
    {
        return;
    }
    let pinned: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest).expect("native manifest"))
            .expect("native manifest JSON");
    let dir = std::env::var_os("LITERT_LM_LIB_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join("native/macos"));
    for (name, digest) in pinned["files_macos_arm64"]
        .as_object()
        .expect("pinned native file hashes")
    {
        let file = dir.join(name);
        println!("cargo:rerun-if-changed={}", file.display());
        let bytes=std::fs::read(&file).unwrap_or_else(|_|panic!("Missing pinned native library {}. Run python3 scripts/install_native.py before building.",file.display()));
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            digest.as_str().unwrap(),
            "Native library checksum mismatch: {}. Reinstall with scripts/install_native.py",
            file.display()
        );
    }
    let alias = dir.join("liblitert-lm.so");
    println!("cargo:rerun-if-changed={}", alias.display());
    assert_eq!(
        std::fs::canonicalize(&alias).expect("native runtime loader alias"),
        std::fs::canonicalize(dir.join("liblitert-lm.dylib")).unwrap(),
        "Native runtime loader alias must point to the pinned library"
    );
    // Also covers a dependency build script cached before explicit installation.
    println!("cargo:rustc-link-search=native={}", dir.display());
}
