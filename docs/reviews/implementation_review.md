# Review of `feat/mcp-commerce-clef` at `396af45` — 2026-11-14

Scope: the 53 commits on `feat/mcp-commerce-clef` over `main` (`da01676`), reviewed against plan Revision 3.

## How this was checked

- Read in full: `commerce/{receipt,admin_auth,http,bundler,db,mod}.rs`, `schema.sql`, `mcp_gateway/{handler,mrtr_checkout,federation}.rs`, `fingerprint/{passive,active,mrtr}.rs`, `clef/{engine,scorer,schema}.rs`, and the `server.rs` / `state.rs` / `main.rs` diffs.
- Read in part: `assets/index.html` (auth, rendering, CLEF lens), `fingerprint/client_hello.rs` (parser head only).
- Ran `cargo test -p proxyfor --tests` in `/Users/mac/Outrider`: exit code 0, no failures; the real-model tests were ignored as designed.
- **Not run:** the Playwright suite, the two `OUTRIDER_CLEF_MODEL` tests, and the live launch. **Not read:** `commerce/tui.rs`, the test files, `scripts/install_native.py`. Every finding below comes from reading the code; none was reproduced with an exploit or failing test.

## Verdict

The branch follows the plan closely and the core is sound: receipt redemption is one atomic transaction, admin mutations need a bearer token and a loopback peer, the default bind moved to `127.0.0.1`, the web UI renders only with `textContent`, and `option_scores` is forced `NULL` by a `CHECK` constraint. No fabricated values were found in the UI code that was read. It is not ready to merge: findings 1–3 should be fixed first.

## Findings

### 1. High — every proxied request sends `tool_list_changed` to every subscribed agent
`handler.rs:645-653`. `listen` forwards every event on the global `commerce.events` channel as `notify_tool_list_changed()`, ignoring the event's kind and session. `state.rs` emits `traffic.persisted` for every proxied HTTP request and `websocket.persisted` for every WebSocket message, and probes, upstream calls and admin actions emit more. Each subscribed agent is told its tool list changed on unrelated traffic, and learns the timing of other sessions' activity. Fix: notify only on events that change that session's entitlements (receipt redeemed/revoked, bundle or catalog change).

### 2. High — a session id is an unauthenticated handle that carries spent-receipt rights
`handler.rs:70-117` and `446-451`. A caller picks its session with `Outrider-Session-Id` / `_meta["outrider/session_id"]`; the only check is that it parses as a UUID. Once a receipt has been presented in a session it is stored in `presented_receipts`, and later calls naming that session id redeem it without presenting the token. Anyone who learns a session id can therefore spend that session's remaining quota. The id is not treated as a secret: `outrider_catalog` returns it, and it is written to `mcp_frames` and the event stream. Related: `outrider/client_id` is self-asserted (the code itself records "ownership is not authenticated"), so a receipt bound to an `https://` subject is a plain bearer token. Fix: require the receipt token on every redemption, or issue a server-generated session secret.

### 3. Medium — "CLEF Verified" / "CLEF Restricted" do not mean what they say
`clef/scorer.rs:39`, `commerce/mod.rs` (`refresh_session_states`). The state is "CLEF Restricted" when the latest pick is literally `false`, otherwise "CLEF Verified", for whatever question was asked. A `Choice` or `Score` answer always yields "Verified"; a `false` answer to "is this agent malicious?" yields "Restricted". The label shown in both UIs is an interpretation the data does not support. Fix: show the question and pick, or let the operator declare which pick maps to which state.

### 4. Medium — session evidence is silently truncated, and long sessions likely cannot be evaluated
`commerce/db.rs` (`rows`, `session_record`). `rows()` returns the newest 1,000 rows of a table across all sessions, and callers filter by session afterwards. Once the tables pass 1,000 rows, the CLEF input, `outrider_fingerprint_me`, `outrider_receipt_status` and the session-state refresh drop older rows with no indication. Separately, `handler.rs:213-258` adds one observation per MCP request, the whole record goes into the prompt, and the engine is built with `max_num_tokens(4096)` (the recorded live run used 1,178 tokens for a minimal session). Long sessions will probably overflow; this was not tested. Fix: query by `session_id`, and bound or summarise what goes into the prompt explicitly.

### 5. Medium — a tool in two bundles only honours the first bundle
`handler.rs:431-435`. The bundle for a tool call is the first bundle (by id) containing the tool. A valid receipt for a second bundle containing the same tool fails with "Wrong receipt bundle".

### 6. Medium — quota is spent before the tool runs
`handler.rs:455` vs `537-545`. `redeem` decrements the receipt, then the upstream call or task runs. An upstream failure, timeout or cancelled task costs the agent a call with nothing delivered, and no refund path exists. Decide whether that is intended and say so in the error.

### 7. Low — two probe values are inferred rather than measured
- `fingerprint/active.rs`: status is "Declined" when the error text contains the substring `declin`; `fingerprint/mrtr.rs` reads a non-standard `declined` field. Anything else is "Failed".
- Probe `input_tokens` / `output_tokens` are counted with the local Gemma tokenizer, not the agent's model, and are stored without that qualifier.

### 8. Low — "MCP frames" are reconstructed records, not wire frames
`federation.rs` (`frame`). Rows are built from parsed parameters, e.g. `{"name":…,"arguments":…}`, and include invented entries such as method `upstream/catalog` with body `{"tools":n}` and `server/discover` with `{}`. They record real events, but the UI tab calls them frames.

### 9. Low — performance and retention
- All SQLite access is synchronous under one `std::sync::Mutex` on async worker threads.
- `/snapshot` returns up to 1,000 rows from each of 15 tables, including full captured bodies, on every event (70 ms debounce) and every 5 s.
- Every proxied request and response body, with its headers, is persisted to SQLite with no retention limit. The file is mode `0600`, but it accumulates credentials from intercepted traffic.

### 10. Low — smaller items
- `passive.rs` (`cimd`): the local-address filter does not cover IPv4-mapped IPv6 (`::ffff:127.0.0.1`) or `100.64.0.0/10`. TLS certificate checks limit this to blind connection attempts.
- `clef/engine.rs`: a full worker pool returns "CLEF worker pool busy", which `scorer.rs` records as status `ModelError`.
- `mrtr_checkout.rs` (`begin`): each unentitled call inserts an `mrtr_quotes` row that is never pruned.
- `federation.rs`: the upstream catalog is read once at connect; upstream list changes are not picked up.
- `server.rs` (`serve_socket`): a connection that sends nothing for 5 s is now closed.
