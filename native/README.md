# Pinned native runtime

Run `python3 scripts/install_native.py` once on macOS arm64 before Cargo builds.
The script checks both archives against `manifest.json` before extracting them.
Native binaries are intentionally excluded from Git. Cargo's default-download
feature is disabled. The repository Cargo configuration links this local install.

The main runtime is the official LiteRT-LM Python API 0.18.0 wheel's C library;
Python is not used for inference. Its Mach-O install name is `liblitert-lm.so`,
so installation supplies a local alias alongside `liblitert-lm.dylib`.
Other platforms require their own verified native manifest and configuration.
