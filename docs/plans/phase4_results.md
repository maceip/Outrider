# Phase 4 exit gate — 2026-11-13

`cargo test -p proxyfor --test mcp_commerce_e2e` passes against the real HTTP
listener, a real rmcp 2026 discovery/subscription client, and an actual child
Outrider process speaking MCP over stdio. It exercises receipt checkout,
tampered/expired/replayed requestState rejection, missing/forged/wrong-subject/
revoked/expired/exhausted receipt rejection, single-use quota decrement,
notify_tool_list_changed, gated SkillCatalog reads, upstream execution and
SEP-2663 fulfillment tasks. Calls are verified in the child process's SQLite
MCP frame records. `cargo test -p proxyfor --tests` passes the full suite.

A further real 2026 HTTP integration test verifies default Auto probing through
an input-required round trip. It supplements the legacy peer-API tests.

## Necessary SDK compatibility correction to Revision 3

The checked-in rmcp 3.10.0 source explicitly prohibits server-to-client requests
on 2026-07-28. See `crates/rmcp/src/service/server.rs` create_message/
create_elicitation documentation and the send-request version guard. It directs
servers to InputRequiredResult instead. The implementation therefore preserves
the plan's 2026 protocol target and carries automatic sampling/createMessage
and typed preference inputs in SEP-2322 MRTR on the first tools/call from a
sampling-capable client. Off sends none; on-request requires outrider_run_probe.
Legacy peers retain peer.create_message / peer.elicit. Direct reverse requests
are never forced through a protocol guard.

Probe checkpoints are HMAC-bound to the original request and session, persisted,
expiring and single-use. Their measured latency covers the client round trip.
A client that aborts MRTR without reporting a decline leaves Awaiting client
input, then Timed out; the server does not invent a decline. Explicitly reported
declines and failed/malformed returned inputs are recorded separately. MCP 2026
cannot initiate a probe from an admin UI while the agent is idle; that control
must explain this precondition and direct the agent to outrider_run_probe.

Stateless HTTP clients retain their logical session using Outrider-Session-Id
(UUID) or _meta outrider/session_id. MRTR state and session-scoped receipts also
retain their original session binding across connections. HTTPS CIMD metadata
is fetched with bounded size/time, no redirects and pinned DNS addresses;
metadata validation is labeled separately from proof of client ownership.

Local session evidence, upstream tools/prompts/resources and digested filesystem
skills use the same configured catalog. Entitlements require valid issued
receipts and current digests. Task ownership is enforced per session. Task and
upstream results are mirrored into SQLite MCP frame evidence; failures surface
to callers. No MCP tool can issue a receipt.
