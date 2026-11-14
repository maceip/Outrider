# Outrider (`proxyfor`) Dynamic MCP Commerce & CLEF Gateway — Implementation Plan (Revision 3)

Upgrade [proxyfor](file:///Users/mac/Outrider/proxyfor/Cargo.toml) into **Outrider**: an inspecting HTTP(S)/WS proxy and **MCP `2026-07-28` dynamic commerce gateway** built on [rmcp](file:///Users/mac/Outrider/rust-sdk-main/crates/rmcp/Cargo.toml) (`v3.10.0`) and `litert-lm-rust` (`v0.2.4`) for `.litertlm` CLEF execution. Every metric, score, offer, receipt, and UI control is backed 1:1 by SQLite state and live runtime execution.

> [!IMPORTANT]
> **Constitutional & Zero-Mock Guarantees**
> - **Zero synthetic scores or token heuristics**: token counts come only from `litert_lm_rust::Engine::tokenize()`; CLEF picks come only from real `.litertlm` execution; with no model loaded the status is an explicit `Unconfigured` / `ModelError`. Every receipt is persisted in SQLite and signed with Ed25519.
> - **No distribution without a measured source**: a probability or option distribution is stored and rendered only when the runtime returned real scores for that evaluation (see Phase 0 and Phase 1). Otherwise the field is `NULL` and the UI omits the bars. It is never derived, normalised from text, or defaulted.
> - **Continuous Git commits**: baseline `da01676` is on `main`; every phase lands as atomic, verified commits on `feat/mcp-commerce-clef`, and each phase's exit gate must pass before the next phase starts.

## What changed from Revision 1

| # | Gap in Revision 1 | Resolution |
| :--- | :--- | :--- |
| 1 | "Probability bars" had no data source: the constrained `Conversation` API returns text only. | New Phase 0 spike measures what `Session` `Responses::score_at` / `token_scores_at` actually return for the chosen model; distributions are conditional on that result. |
| 2 | A root workspace cannot adopt `rmcp` as a member: `rust-sdk-main` is already a workspace root and `rmcp` inherits `version`/`edition` from it. | Root workspace has `members = ["proxyfor"]`, `exclude = ["rust-sdk-main"]`; `rmcp` and `rmcp-macros` are path dependencies. |
| 3 | No auth on mutating admin endpoints, while `proxyfor` binds `0.0.0.0:8080` by default and `/__proxyfor__` is unauthenticated today. | Admin token + loopback default for all `/__proxyfor__/commerce/*` mutations (Phase 2). |
| 4 | Ledger had no stated source of funds. | Balance ledger removed. Entitlement comes solely from a valid Ed25519 receipt issued out of band (Decision A). |
| 5 | Active sampling probes spend the agent's tokens without consent. | Probes run by default when the client advertises `sampling`, each carrying a stated purpose; `--probe-policy off` disables them (Decision B). |
| 6 | TLS fingerprint overstated: `tokio_rustls` exposes only negotiated ALPN/cipher/version. | Raw ClientHello capture and a JA4-style fingerprint are built in Phase 3 (Decision C); negotiated parameters are labelled separately. |
| 7 | No TUI test, no model path for the CLEF test, tests only at the end, build-time binary download. | Per-phase exit gates, a TUI test, a named model path, and a pinned native-library policy. |

---

## System Architecture

```mermaid
flowchart LR
    Agent["Connected MCP Agent"] <-->|"Streamable HTTP /mcp, Proxy TLS/WS, or Stdio"| Proxy["Outrider Hyper Server (proxyfor)"]
    Proxy --> FP["Fingerprint & Probe Engine"]
    FP -->|"Passive: ClientHello JA4, negotiated TLS params, Header Digest, ClientConfig, CIMD"| DB[("SQLite State & Receipt Store")]
    FP <-->|"Active (default on): sampling/createMessage & peer.elicit"| Agent
    FP -->|"Session Trajectory + SystemOne Schema"| CLEF["Embedded CLEF (.litertlm via litert-lm-rust)"]
    CLEF -->|"Constrained JSON (noul / choice / score)"| Bundler["Dynamic Bundler & Offer Synthesizer"]
    Bundler -->|"notify_tool_list_changed (subscriptions/listen)"| Agent
    Bundler <-->|"SEP-2322 MRTR InputRequiredResult + RequestStateCodec"| Agent
    Bundler -->|"Verify Ed25519 Receipt & Decrement Quota"| DB
    Proxy <-->|"Federated rmcp Client Pool"| Upstreams["Upstream MCP Servers (Stdio / HTTP)"]
    Proxy -->|"SEP-2640 SkillCatalog"| Skills["Gated SKILL.md Bundles"]
    Admin["Operator (admin token)"] -->|"Issue / revoke receipts via /__proxyfor__/commerce/*"| Proxy
    DB <--> UI["Geometry-A 3-Pane WebUI & Ratatui TUI"]
```

---

## Direct Reuse Map from `rust-sdk-main` (`rmcp` v3.10.0)

All nine source files and the symbols named below were confirmed present in the repo at `da01676`.

| Capability | Source Reference in `rust-sdk-main` | Outrider Commerce Integration |
| :--- | :--- | :--- |
| **Hyper Streamable HTTP Mount** | [counter_hyper_streamable_http.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/counter_hyper_streamable_http.rs) | Mount `TowerToHyperService<StreamableHttpService<CommerceGateway, LocalSessionManager>>` inside [server.rs](file:///Users/mac/Outrider/proxyfor/src/server.rs) at `/mcp` alongside the forward/reverse MITM proxy and `/__proxyfor__`. |
| **SEP-2322 Multi Round-Trip Checkout** | [mrtr.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/mrtr.rs) | Gate paid/unentitled `tools/call` with `InputRequiredResult` + HMAC-SHA256 `RequestStateCodec` (`QuoteCheckoutState`) + `FormElicitationParams`. |
| **2026-07-28 Live Subscriptions** | [subscriptions_streamhttp.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/subscriptions_streamhttp.rs) | Implement `accepted_subscription_filter` and `listen(SubscriptionContext)` to push `notify_tool_list_changed()` when CLEF re-scores a session, a probe finishes, or a purchase unlocks a bundle. |
| **Active Sampling Fingerprinting** | [sampling_stdio.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/sampling_stdio.rs) | `context.peer.create_message()` micro-probes whenever `ClientCapabilities` advertises `sampling`, unless `--probe-policy off`. |
| **Typed Preference Elicitation** | [elicitation_enum_inference.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/elicitation_enum_inference.rs) | `context.peer.elicit::<T>()` to negotiate budget ceilings, SLA tiers, and bundle preferences. |
| **CIMD & Bearer/Capability Auth** | [cimd_auth_streamhttp.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/cimd_auth_streamhttp.rs) | Verify HTTPS `client_id` metadata documents and validate Ed25519 capability receipts in `Authorization` / MCP `_meta`. |
| **SEP-2663 Async Fulfillment Tasks** | [task_demo.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/servers/src/common/task_demo.rs) | `TaskManager` for multi-step upstream bundle execution when `client_capabilities().supports_tasks()`. |
| **Federated Upstream Bundling** | [collection.rs](file:///Users/mac/Outrider/rust-sdk-main/examples/clients/src/collection.rs) | Pool `RunningService<RoleClient, _>` connections over `TokioChildProcess` and `StreamableHttpClientTransport`. |
| **SEP-2640 Gated Skill Bundles** | [skill_catalog.rs](file:///Users/mac/Outrider/rust-sdk-main/crates/rmcp/src/handler/server/skill_catalog.rs) | Serve SHA-256 digested `skill://` manifests filtered per session by active bundle entitlements. |

---

## Decisions (settled by Ryan, 2026-11-13)

- **A. Signed receipts only.** There is no balance ledger and no payment rail. An agent is entitled to a bundle only by presenting a valid, unexpired, unrevoked Ed25519 `CapabilityReceipt`. Receipts are issued out of band by the operator through the authenticated admin API or the `outrider receipt issue` CLI. Outrider never mints a receipt in response to an agent request, and prices are not stored or displayed.
- **B. Probes on by default.** When the client advertises `sampling`, Outrider sends `sampling/createMessage` probes automatically. Every probe message states plainly that it is an Outrider capability probe and why it is being sent. `--probe-policy off|on-request|auto` (default `auto`) lets the operator turn this down; a client decline is recorded as a decline.
- **C. ClientHello capture is built.** The raw TLS ClientHello is read before the `tokio_rustls` acceptor and stored with a JA4-style fingerprint computed from it.

---

## Phases

Each phase ends with an **exit gate**: tests that must pass, committed, before the next phase begins.

### Phase 0: Feasibility Spikes (throwaway binaries under `proxyfor/examples/`, results committed as test fixtures)
- **Workspace + build spike**: root `Cargo.toml` with `[workspace] members = ["proxyfor"]`, `exclude = ["rust-sdk-main"]`, `resolver = "3"`; `proxyfor` moves to edition 2024 / `rust-version = "1.88"` and takes `rmcp = { path = "../rust-sdk-main/crates/rmcp", features = [...] }`. Confirm one resolved `hyper`/`tokio`/`rustls` set with `ring` as the only crypto provider (`rmcp`'s `reqwest` must use `reqwest-tls-no-provider` or match `ring`).
- **Native library policy**: `litert-lm-rust`'s default `download-native` feature fetches prebuilt libraries into `~/.noema/prebuilt` at build time. Disable default features, vendor or pin the library by SHA-256, and record the version in the repo.
- **CLEF scoring spike** against `~/.avery/redteam-models/gemma-4-e2b-it.litertlm` (or the path Ryan names):
  1. Constrained `Conversation` with `ConstraintType::JsonSchema` returns schema-valid JSON for `noul`, `choice`, and `score`.
  2. `Session::generate_content_responses` → record whether `Responses::score_at` and `token_scores_at` return `Some`, and what the values are (log-likelihoods or otherwise), for this model and backend.
- **Exit gate**: a committed written result stating which of {pick only, pick + per-option scores} the runtime really provides. Phase 1's schema follows that result. If scores are unavailable, distributions are dropped from the plan, not approximated.

### Phase 1: Native `litert-lm-rust` CLEF Engine
- **Add `proxyfor/src/clef/`**:
  - `engine.rs`: owns `Arc<litert_lm_rust::Engine>` configured via CLI/env (`--clef-model <PATH.litertlm>`, `--clef-backend cpu|gpu`, `--clef-threads`, `--clef-cache-dir`) plus a bounded `spawn_blocking` worker pool.
  - `schema.rs`: SystemOne typed questions (`Noul`, `Choice`, `Score`) compiled to per-request JSON Schemas passed through `ConversationOptionalArgs { constraint_type, constraint_string }`.
  - `scorer.rs`: evaluates live session records and persists exact `input_tokens` (`engine.tokenize()`), `output_tokens`, wall-clock latency, the pick, and `option_scores` **only if Phase 0 proved a real source** (nullable column; `NULL` when the runtime returned none).
- **Exit gate**: `proxyfor/tests/clef_litertlm_e2e.rs` loads the real model, runs all three question types over a real recorded session, and asserts the SQLite rows. The test is skipped with a printed reason, not passed, when `OUTRIDER_CLEF_MODEL` is unset.

### Phase 2: SQLite Persistence, Receipts & Admin Auth
- **Add `proxyfor/src/commerce/`**:
  - `db.rs`: SQLite (`~/.proxyfor/outrider.db` or `--db <PATH>`, WAL) with `agent_sessions`, `fingerprint_observations`, `probe_runs`, `clef_evaluations`, `upstream_servers`, `catalog_items`, `bundles`, `session_offers`, `mrtr_quotes`, `capability_receipts`, `receipt_redemptions` (one row per quota decrement), `admin_audit_log`. No balance or price tables.
  - `receipt.rs`: Ed25519 keypair at `~/.proxyfor/outrider-ed25519.pem` created with mode `0600`; signing over canonical JSON `{receipt_id, subject, bundle_id, item_digests, max_calls, expires_at_unix}` where `subject` is the CIMD `client_id` (or a session id when the client has none); verification; quota decrement and revocation in atomic transactions. Issuance is reachable only from the admin API and the `outrider receipt issue` CLI.
  - `bundler.rs`: synthesizes session-specific bundles from local tools, federated upstream tools, and `SkillCatalog` entries using real CLEF outputs and configured bundle rules. With CLEF `Unconfigured`, it offers only the static configured catalog and says so.
  - `admin_auth.rs`: every mutating `/__proxyfor__/commerce/*` route requires a bearer admin token (generated on first run, stored `0600`, printed once) and is refused from non-loopback peers unless `--admin-allow-remote` is set. The HMAC `RequestStateCodec` secret is stored the same way. Every admin mutation writes `admin_audit_log`.
- **Exit gate**: integration tests for receipt tamper/expiry/revocation/wrong-subject rejection, quota never going below zero under concurrent redemption, no agent-reachable issuance path, and `401`/`403` on unauthenticated or remote admin calls.

### Phase 3: Agent Fingerprinting & Active Probing
- **Add `proxyfor/src/fingerprint/`**:
  - `client_hello.rs`: peeks the raw ClientHello from the accepted `TcpStream` before handing it to the `tokio_rustls` acceptor (both the direct `/mcp` TLS listener and the MITM `CONNECT` path), parses version, cipher list, extensions, ALPN, SNI, and signature algorithms, and computes a JA4-style fingerprint. A ClientHello that cannot be parsed is stored as unparsed; no fingerprint is substituted. Plain-HTTP and stdio sessions have none and show none.
  - `passive.rs`: negotiated TLS version, ALPN, and cipher suite (what `tokio_rustls` exposes after the handshake); HTTP header-order SHA-256 digest; `User-Agent`; `Mcp-Session-Id`; JSON-RPC request cadence (mean/p50/p95); `initialize` `ClientConfig`; CIMD URL validation. Negotiated parameters are stored and labelled separately from the ClientHello fingerprint.
  - `active.rs`: `peer.create_message()` challenges and `peer.elicit()` checks, run automatically under `--probe-policy auto` (the default) with the purpose statement from Decision B, recording exact latency, token count, and structural compliance, then feeding `clef::scorer`. A declined or failed probe is stored as declined/failed.
- **Exit gate**: integration test with a real `rmcp` client covering default-on probing (purpose statement present in the probe message), `--probe-policy off` (no `sampling/createMessage` sent), and client-declined paths, asserting the stored rows; plus a ClientHello test that connects real `rustls` clients with two different configurations and asserts two different stored fingerprints, each matching a fingerprint computed independently from the captured bytes.

### Phase 4: `rmcp` `2026-07-28` Commerce Gateway & Upstream Federation
- **Add `proxyfor/src/mcp_gateway/`**:
  - `handler.rs`: `ServerHandler` (`ProtocolVersion::V_2026_07_28`) with per-session `list_tools`, `call_tool`, `list_skills`, `get_skill`, `read_resource_directory`, `list_resources`, `read_resource`, `list_prompts`, `get_prompt`, `get_task`, `update_task`, `cancel_task`, and `listen`.
  - `mrtr_checkout.rs`: `SEP-2322` checkout.
    1. Round 1 (unentitled tool or `outrider_checkout_bundle`): persist an `mrtr_quotes` row with an expiry, seal `QuoteCheckoutState`, return `InputRequiredResult` with `FormElicitationParams` listing exact bundle items and skill digests and asking for a capability receipt.
    2. Round 2 (verified `request_state` + `ElicitationAction::Accept`): verify the presented receipt (signature, subject, bundle, expiry, revocation, remaining quota), atomically decrement its quota, mark the quote consumed (single use; replays rejected), fire `notify_tool_list_changed()`, then execute the tool or spawn a `SEP-2663` task. A missing or invalid receipt returns an error result; nothing is granted. A receipt already presented in `Authorization` / `_meta` skips Round 1.
  - `federation.rs`: live `rmcp` client connections configured via `--upstream name=cmd_or_url` or the admin API, mirroring upstream MCP frames into [state.rs](file:///Users/mac/Outrider/proxyfor/src/state.rs). Upstream failures surface as errors to the agent and the UI.
  - Built-in tools: `outrider_catalog`, `outrider_fingerprint_me`, `outrider_run_probe`, `outrider_synthesized_offers`, `outrider_checkout_bundle`, `outrider_verify_receipt`, `outrider_receipt_status` (remaining quota and expiry of the caller's own receipts).
- **Exit gate**: `proxyfor/tests/mcp_commerce_e2e.rs` — real child upstream MCP server, real Outrider server, real `rmcp` client that subscribes, completes MRTR checkout, proves tampered, expired, and replayed `requestState` are rejected, proves a missing, forged, wrong-subject, revoked, or exhausted receipt grants nothing, receives `notify_tool_list_changed`, reads unlocked `skill://` bundles, and runs federated tools and tasks.

### Phase 5: Geometry-A Workbench WebUI & Ratatui TUI
- **Upgrade [server.rs](file:///Users/mac/Outrider/proxyfor/src/server.rs), [index.html](file:///Users/mac/Outrider/proxyfor/assets/index.html), and [tui.rs](file:///Users/mac/Outrider/proxyfor/src/tui.rs)** per `data-workbench-ui` (**Geometry A: 3-Pane Split Workbench**):
  - 36px top header + 36px selection action rail (`[Probe Session]`, `[Run CLEF Eval]`, `[Synthesize Offer]`, `[Issue Receipt]`, `[Revoke Receipt]`, `[Connect Upstream]`), draggable split dividers, `1px` hairlines, no nested cards. A control whose precondition is unmet (no model, probes disabled, no admin token) is disabled with the reason shown; it never reports success without the backend mutation.
  - **Left rail**: live agent sessions and offers with state read from SQLite (`Unprobed`, `Probed`, `CLEF Verified`, `CLEF Restricted`, `Entitled`).
  - **Center canvas**: `HTTP/WS Proxy Traffic`, `MCP / MRTR Frames`, `Ed25519 Receipts & Redemptions` with clickable `[T-xx]` / `[M-xx]` citations.
  - **Right inspector**: (1) fingerprint and handshake evidence, including the ClientHello fingerprint when one was captured; (2) CLEF lens showing pick, model path, exact `input_tokens`, latency, and score bars only when `option_scores` is non-`NULL`, or an `Unconfigured` banner; (3) bundle and receipt inspector with digests and signature verification.
  - REST + SSE endpoints under `/__proxyfor__/commerce/*`; mutations go through `admin_auth`. HTTP errors are shown as errors.
- **Exit gate**:
  - `tests/webui_commerce.spec.ts` (Playwright) launches the compiled `proxyfor --web` binary against a temporary SQLite DB, drives every control, and asserts the matching SQLite transitions, the unauthenticated-admin failure path, the `Unconfigured` state, and zero console/network errors.
  - `proxyfor/tests/tui_commerce.rs` renders the new TUI views with `ratatui::backend::TestBackend` from a real seeded DB and drives each key binding, asserting the same state transitions.
  - Manual launch of the real binary with a real model and a real MCP client before the work is reported complete.
