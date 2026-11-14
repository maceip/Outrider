# Phase 3 exit gate — 2026-11-13

`cargo test -p proxyfor --test fingerprint_probes` passes both integration tests.
A real rmcp client receives the explicit Outrider purpose statement under the
default Auto policy; Off sends no sampling request, and a client-declared decline
persists as Declined. Latency is measured; token counts remain NULL without a
loaded tokenizer. Typed preference elicitation is supported through peer.elicit.

Two real rustls clients restricted to TLS 1.2 and TLS 1.3 connect to the actual
proxy listener. The test checks distinct stored ClientHello fingerprints against
an independent decoder/hash calculation over each stored raw capture, and checks
that negotiated TLS observations are separate rows. The listener accepts direct
TLS and CONNECT TLS, replaying captured bytes unchanged into the rustls acceptor.
Malformed hellos persist as Unparsed with their original bytes.

The fingerprint is explicitly labeled Outrider JA4-style v1, not an official JA4
implementation. It excludes GREASE, sorts cipher/extension hash inputs, preserves
signature-algorithm ordering, and records parsed ALPN/SNI/version evidence. The
first HTTP/1 request on a connection has a SHA-256 over header names in actual
wire order. HTTP/2 reports this capture as unavailable; it never substitutes a
HeaderMap iteration digest for wire order.

The complete existing Rust integration suite also passes. MCP handler attachment,
per-request cadence and session association are completed by Phase 4, which owns
the gateway handler and transport mount.
