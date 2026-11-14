# Phase 2 exit gate — 2026-11-13

`cargo test -p proxyfor --test commerce_receipts` passes four integration tests.
The real HTTP test verifies 401 without a valid token, 403 with a valid token
from the machine's non-loopback address, authenticated issuance, and absence
of issuance at agent/proxy paths. The concurrency test opens 24 independent
SQLite connections and races redemptions of a seven-call receipt: exactly
seven succeed, seven redemption rows persist, and remaining quota is zero.
Tamper, wrong subject, wrong bundle, revocation, exhaustion and actual clock
expiry are rejected. Secret key creation is checked for mode 0600.

Receipt signatures use Ed25519 over RFC 8785 canonical JSON. The authority
checks the signature, stored issuance record, subject, bundle's current item
digests, expiry, revocation and quota. An immediate SQLite transaction combines
quota decrement, optional single-use quote consumption and the redemption row.
Issuance and revocation write audit rows in the same transaction. No balance,
price or payment rail exists.

The HTTP listener now defaults to 127.0.0.1. All commerce reads containing
sensitive receipt material and every mutation require the admin bearer token;
only model status is public. Non-loopback administration requires the explicit
--admin-allow-remote setting. Admin and HMAC secrets are persisted privately.
`outrider receipt issue` and `outrider receipt revoke` use the same authority
and audit log. Session bundle offers reference configured catalog items and
actual CLEF picks when rules require them. Unconfigured operation exposes only
configured static bundles and states that source.
