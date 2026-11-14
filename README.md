# Outrider

An inspecting HTTP(S)/WebSocket proxy and MCP 2026-07-28 commerce gateway, built
on the checked-in rmcp 3.10.0 SDK and native `litert-lm-rust` 0.2.4. Entitlement
comes from operator-issued Ed25519 receipts. There are no prices, balances or
payment rails.

The [implementation plan](docs/plans/implementation_plan.md) and phase results
under [docs/plans](docs/plans/) record the implementation and its validation.
The native runtime and browser tests were validated locally on macOS arm64 with
Rust 1.99.0. Other native platforms need their own verified library installation.

## Build and run

```sh
python3 scripts/install_native.py
cargo build -p proxyfor --bins --example commerce_live_client
./target/debug/outrider --web --clef-model ~/.avery/redteam-models/gemma-4-e2b-it.litertlm
```

Open `http://127.0.0.1:8080/__proxyfor__/`. Enter the admin token printed once on
first startup; the private copy is `~/.proxyfor/outrider-admin-token`. The proxy
and `/mcp` share the listener. It also accepts direct TLS using the proxy CA.
The original `proxyfor` executable remains available. `--tui` selects the terminal
workbench and `--stdio` serves MCP without an HTTP listener.

Omit `--clef-model` for explicit Unconfigured operation. No picks, token estimates
or option distributions are supplied in that state. `--clef-backend cpu|gpu`,
`--clef-threads`, `--clef-cache-dir`, `--db` and `--config-dir` configure the runtime.
The native installation is explicit and checks archive hashes; every macOS arm64
build also checks the installed library hashes. Cargo never downloads native code.

## MCP Inspector

`http://127.0.0.1:8080/__proxyfor__/inspector` (admin token required) is the dashboard's
Inspector page (`dashboard/src/views/inspector-page.tsx`); it is only served when the
dashboard export (`dashboard/out`) is built in or `OUTRIDER_DASHBOARD_DIR` points at it. It connects to any
MCP server over Streamable HTTP or a stdio command, or to this gateway's own `/mcp`
to see exactly what agents see. It lists and calls tools through forms generated from
their schemas, reads resources and templates, gets prompts with completions, fetches
skills, sends raw JSON-RPC requests and notifications, sets roots, opens
`subscriptions/listen` streams and answers sampling, elicitation and MRTR
`input_required` rounds by hand. Every message, with latency and server stderr, is
stored in `inspector_messages`; header and environment values are never stored.
OAuth sign-in and the legacy HTTP+SSE transport are not supported.

## Sessions, probes and bundles

MCP 2026 HTTP is stateless. Supply `Outrider-Session-Id: <UUID>` on each request,
or `_meta["outrider/session_id"]`, to retain a logical session across connections.
That value is a secret chosen by the client: generate it randomly and do not share
it, because a receipt presented in a session stays usable by later requests that
carry the same value. Outrider stores, logs and displays only a SHA-256-derived
session ID, which cannot be sent back to name the session. The catalog tool returns
that derived session ID and the receipt subject; issue session-bound receipts to it.
Subscribers receive `tools/list_changed` only when their own tool list changes. Optional HTTPS CIMD
metadata uses `_meta["outrider/client_id"]`; metadata validation does not establish
ownership of the client identity.

Automatic probes disclose their purpose and run on the first `tools/call` from
a sampling-capable client. Under MCP 2026 they use supported input-required round
trips, as approved for this implementation; reverse peer requests are forbidden
by this SDK version. `--probe-policy off|on-request|auto` defaults to `auto`.
Idle 2026 clients must invoke `outrider_run_probe`; the operator interfaces explain
why their Probe Session control is disabled for those sessions. A client abort
without an input response expires as Timed out; it is never labeled a decline.
An explicit decline returned by a client is retained as Declined.

Add upstreams with `--upstream 'name=command or URL'` or Connect Upstream. Tool IDs
are `name__tool`. Load filesystem skills with `--skills-dir`; SkillCatalog serves
the captured bytes and SHA-256 digests. The local gated tool
`outrider_session_evidence` returns the actual stored session evidence.

Configure bundles through authenticated `POST /__proxyfor__/commerce/bundles/put`:

```json
{"bundle_id":"session-evidence","title":"Session evidence","items":["outrider_session_evidence"],"rules":{}}
```

An optional `rules.required_pick` filters offers using a recorded CLEF pick.
Static offers are labeled as static even when a model is loaded. No offer itself
grants access. Issue a receipt only as the operator:

```sh
./target/debug/outrider receipt issue --subject SESSION_UUID \
  --bundle-id session-evidence --max-calls 10 --expires-at-unix FUTURE_UNIX_SECONDS
./target/debug/outrider receipt revoke --receipt-id RECEIPT_UUID
```

Agents present the returned encoded token in `Authorization: Bearer <receipt>`
or `_meta["outrider/receipt"]`, or fulfill the gateway's sealed checkout elicitation.
Signatures, subject, current bundle digests, expiry, revocation and quota are
verified. Quote consumption, quota decrement and the redemption row are atomic.
Issued receipts are not automatically presented on the agent's behalf. Skill,
resource and prompt reads require an active presented receipt; execution consumes
quota. Fulfillment tasks are owned by the calling logical session.

All commerce mutations require an admin bearer token and loopback peer unless
`--admin-allow-remote` is explicitly set. CLI and terminal mutations use the local
operator authority and write the same audit log. `/commerce/status` alone is
public; snapshot and event streams require authentication too.

## Verification and evidence

```sh
cargo test -p proxyfor --tests
OUTRIDER_CLEF_MODEL=~/.avery/redteam-models/gemma-4-e2b-it.litertlm \
  cargo test -p proxyfor --test clef_litertlm_e2e --test tui_commerce -- --ignored --nocapture
npm ci
npx playwright install chromium
OUTRIDER_CLEF_MODEL=~/.avery/redteam-models/gemma-4-e2b-it.litertlm npm run test:web
```

The normal Rust run explicitly ignores live-model tests; without the model env
var the corresponding browser test is skipped with a reason. The remaining
browser test exercises Unconfigured behavior. Browser tests launch the compiled
binary with temporary databases and actual MCP child processes, and verify the
SQLite mutations. They do not use intercepted network responses or a mock UI.

For a separate live MCP client with real model-backed sampling:

```sh
OUTRIDER_CLIENT_MODEL=~/.avery/redteam-models/gemma-4-e2b-it.litertlm \
  ./target/debug/examples/commerce_live_client http://127.0.0.1:8080/mcp
```

The terminal workbench uses p/e/s/i/r/u for the six actions, arrows for sessions,
Tab for the center view, brackets for receipts, j/k for evidence, PageUp/PageDown
for the inspector and q to exit. Disabled actions show their actual precondition.

ClientHello hashes are labeled **Outrider JA4-style v1**, separately from negotiated
TLS. Raw bytes and unparsed failures are retained. Header order is captured for
the first HTTP/1 request on each connection; HTTP/2 wire order is explicitly
unavailable. Plain HTTP and stdio have no TLS fingerprint. Input/output token
counts use the loaded engine's tokenizer on saved text; probe token counts use
that tokenizer, and do not claim the remote client's provider usage.

Measured native generation supplies picks but no usable per-option score source.
`option_scores` stays SQL NULL and the interfaces omit probability bars. A session
with a completed evaluation is shown as **CLEF Evaluated** alongside the question
and the model's pick; Outrider infers no verdict from the pick.
