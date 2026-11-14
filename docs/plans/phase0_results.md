# Phase 0 exit gate — 2026-11-13

Validated locally on macOS arm64 with Rust 1.99.0, `litert-lm-rust` 0.2.4,
`litert-lm-api` 0.18.0's native C library, CPU backend, four threads, and
`/Users/mac/.avery/redteam-models/gemma-4-e2b-it.litertlm`.

The committed `proxyfor/tests/fixtures/phase0/clef_runtime.json` contains raw
live measurements. Constrained Noul, Choice and Score outputs parse and satisfy
their schemas. Selecting `use_ll_guidance: Some(true)` is required: merely
setting `enable_constrained_decoding` produced Markdown-wrapped text and failed
strict parsing. Outrider must fail rather than repair such output.

**Decision: pick only.** `Session::generate_content_responses` exposes scores for
generated candidates, not scores for each offered option. For this run
`score_at(0)` returned `Some(0.0)` for an empty generated candidate and
`token_scores_at(0)` returned `None`. The scalar is not an option score. No option distribution is
available. All evaluation option_scores remain SQL NULL; no probability bars
or estimated option likelihoods are permitted. A Score question's integer pick
is a model answer, not a token likelihood or distribution.

Native installation is an explicit `python3 scripts/install_native.py` step;
Cargo has `default-features = false` and never downloads native binaries. The
crate's suggested Noema 1.0.0 archive omits the macOS main runtime. Installation
therefore pins both the official 0.18.0 macOS arm64 wheel containing that runtime
and the accelerator archive by release URLs and SHA-256 in `native/manifest.json`.
All C symbols used by the Rust binding were confirmed exported by the runtime.

Validation:

- `cargo check --workspace --all-targets` passed.
- `cargo test -p proxyfor --tests` passed: 17 tests (including existing proxy,
  WebSocket, certificate and web interface integration tests).
- The live feasibility example passed all three questions and recorded its
  Session API response.
- `cargo tree -e features -i rustls` shows ring and no aws-lc provider.
- One resolved hyper 1.x, tokio 1.x and rustls 0.23.x; reqwest 0.12 (legacy tests)
  and 0.13 (rmcp) share that runtime and provider.

This completes only Phase 0. No commerce, receipt or gateway behavior is claimed
by this gate. The session record in this spike is an explicit test input; Phase
1 records and evaluates a live rmcp initialize exchange.
