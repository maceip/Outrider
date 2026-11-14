# Phase 5 exit gate and final verification — 2026-11-13

Completed locally on macOS arm64 with the real Gemma model named in the plan.
The implementation lives on `feat/mcp-commerce-clef`. This is local validation,
not a production deployment or a model-quality/security benchmark.

| Gate | Observed result |
| --- | --- |
| Standard Rust suite | 28 passed, zero failed; two real-model tests explicitly ignored in the standard invocation |
| Real CLEF model gate | Passed separately with OUTRIDER_CLEF_MODEL; Noul, Choice and Score execute against a real recorded rmcp session and verify SQLite rows |
| Real-model TUI gate | Passed separately with OUTRIDER_CLEF_MODEL; the evaluation key persists native token counts, picks and latency |
| Browser gate | Two Playwright flows passed against compiled binaries, temporary SQLite databases and real MCP child processes; one Unconfigured, one with the actual Gemma model |
| Console/network | Zero unexpected browser console, page or network errors; the deliberately tested unauthorized request returns 401 |
| Strict Rust lint | cargo clippy -p proxyfor --all-targets -- -D warnings passed |
| Formatting/types | Rust formatting, TypeScript checking, Prettier and git diff --check passed |
| Native policy | Explicit installation only; pinned archives and installed macOS library hashes checked; download-native disabled |
| TLS dependency set | ring is the only enabled rustls crypto provider |
| Separate live launch | Actual outrider --web binary plus a separate native-model-backed MCP client; successful automatic MRTR probe and persisted CLEF evaluation |

The [live-run record](../validation/manual_live_run.json) contains the actual
observed result and the source commit used for that separate launch. It recorded
one live session, a completed structurally compliant probe, a true CLEF pick,
1,178 native-tokenizer input tokens, five output tokens and SQL NULL option_scores.
Both validation processes were then stopped. No receipt or admin secrets are
included in the committed evidence.

Inspected browser captures:

- [Real model](../validation/screenshots/workbench-real-model.png)
- [Unconfigured](../validation/screenshots/workbench-unconfigured.png)

The web workbench has the two 36px rails, draggable dividers, session/offers rail,
HTTP/WS and MCP/MRTR citations, receipt/redemption view and evidence inspector.
Its six actions use actual admin mutations and report backend errors. Unmet
preconditions are visible and disabled. The terminal uses the same mutation
functions and audit log, including forms, receipt selection and scrollable
evidence inspection. Its TestBackend test checks database transitions.

HTTP traffic bodies and WebSocket messages are persisted and checked after a
SQLite reopen. Receipt signatures are verified before the inspector reports
verification. Entitled state is refreshed from valid presented receipts, so
expiry, revocation and exhaustion cannot leave a stale entitlement label.
SQLite state, WAL/SHM files, signing keys, admin token and MRTR secret are private
on Unix. Persisted upstream configuration reconnects on startup; failed or absent
connections are reported from actual connection state.

The approved compatibility correction is described in [Phase 4](phase4_results.md):
MCP 2026 probes use input-required round trips, and an idle agent must initiate
that exchange. Unobservable client aborts time out instead of being called a
decline. The interfaces omit probability bars because the measured runtime has
no usable per-option score source. Header-order capture is explicitly scoped to
the first HTTP/1 request per connection, and HTTP/2 wire order is unavailable.
JA4-style hashes are labeled as the local variant. Native platform validation
covers macOS arm64; other native platforms are not claimed as tested.

[README](../../README.md) contains build, runtime, receipt, probe, skill, upstream
and verification commands. Earlier phase results retain their individual exit
gates. No deployment, merge or remote push was performed.
