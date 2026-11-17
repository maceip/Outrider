# Conduit MCP Control Plane — Meta Astryx Prototype

Interactive UI prototype of the redesigned **Conduit MCP Merchant Control Plane** built on [Meta Astryx](https://github.com/meta/astryx), keeping the upstream `vendor/meta-astryx` monorepo out of git while tracking all authored Conduit surfaces and validation screenshots.

## Architectural Highlights
- **0px Permanent Right Columns (Skewed-Traffic Optimization):** ~95% of agent traffic is read-only catalog discovery (`DisplayCo`). Commercial SKU/MSRP/Margin Floor context lives in a compact 1-row header strip, while the right-hand `CanonicalInspectorPanel` opens **only** when a frame is held at the proxy, checkout requests a capability pass, or an operator clicks a frame to inspect it.
- **Non-Contradictory 3-Phase Execution State (`P0` #01):** Strictly separates `observed_inbound`, `held_at_proxy` (undelivered to buyer), and `delivered_modified` / `delivered_original` (immutable historical record).
- **Single Canonical Workspace Selector (`P1` #02):** `deriveWorkspaceMetrics()` drives the left sidebar, 5-stage progress pills, inspector banner, and bottom status bar simultaneously—separating **`N held by proxy`** from **`M awaiting pass`**.
- **Restored Causal Observatory (`P1` #03):** `Overview` pairs a resizable `CausalObservatoryGraph` + commercial offer cradle above a zero-horizontal-scroll `DenseTraceTable`, alongside full `Graph`, `Wire`, and `Passes` surfaces.
- **Unambiguous Quote Approval & Protocol Mutations (`P1` #04 & `P2` #05):** Explicit delivery banner, semantic offer diff (`2 original offers → 3 proposed offers`), JSON-RPC diff preview, inline explanations whenever `Forward Original` or send controls are unavailable, and consolidated validation gates.

## Quick Start
```bash
./prototypes/astryx-control-plane/sync-into-astryx.sh
cd vendor/meta-astryx/apps/docsite
pnpm exec next dev --webpack -p 3100
```

## Validation Screenshots
- `docs/validation/astryx-control-plane/conduit-astryx-held-quote.png`
- `docs/validation/astryx-control-plane/conduit-astryx-discovery-fullwidth.png`
- `docs/validation/astryx-control-plane/conduit-astryx-post-release.png`
- `docs/validation/astryx-control-plane/conduit-astryx-mobile.png`
