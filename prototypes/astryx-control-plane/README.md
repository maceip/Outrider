# Conduit MCP Control Plane — Meta Astryx Prototype

Interactive UI prototype of the redesigned **Conduit MCP Merchant Control Plane** built on [Meta Astryx](https://github.com/meta/astryx), keeping the upstream `vendor/meta-astryx` monorepo out of git while tracking all authored Conduit surfaces, custom theme, and validation screenshots.

## Architectural & Design System Highlights
- **Conduit Obsidian & Celadon Sage Theme (`conduitTheme.ts`):** Built with `defineTheme({ extends: neutralTheme })`, matching the cool gunmetal/obsidian carbon backdrop (`#0B0C0F` → `#121419`) of `sv.gif` and the anodized celadon/botanical sage emblem (`#A8C284` dark / `#4A5B2F` light) of `sse_2@v2x.webp`, with zero warm brown or yellow mud.
- **Strict Upstream Astryx Compliance (`incident-console` Archetype):** Zero `<Badge>`, zero decorative `<Token>`, zero `<Banner>` washes, and zero nested `<Card>` wrappers inside rows or inspectors—relying on edge-to-edge `List` rows with dividers, `MetadataList`, `Divider`, tabular `Text`, and minimal `StatusDot` indicators.
- **0px Permanent Right Columns (Skewed-Traffic Optimization):** ~95% of agent traffic is read-only catalog discovery (`DisplayCo`). Commercial SKU/MSRP/Margin Floor context lives in a quiet 1-row typographic strip, while `CanonicalInspectorPanel` opens **only** when a frame is held at the proxy, checkout requests a capability pass, or an operator selects a frame (`BottomSheet` on `<= 1024px`).
- **Non-Contradictory 3-Phase Execution State (`P0` #01):** Strictly separates `observed_inbound`, `held_at_proxy` (undelivered to buyer), and `delivered_modified` / `delivered_original` (immutable historical record).
- **Single Canonical Workspace Selector (`P1` #02):** `deriveWorkspaceMetrics()` drives the left rail, stage progression, inspector status, and bottom status bar simultaneously—separating **`N held by proxy`** from **`M awaiting pass`**.
- **Restored Causal Observatory (`P1` #03) & Unambiguous Diff Controls (`P1` #04 / `P2` #05):** `Overview` pairs a resizable `CausalObservatoryGraph` above a dense `List`-based execution trace, with `2 original → 3 proposed` offer diffs, JSON-RPC diff preview, inline explanations whenever controls are disabled, and consolidated validation gates.

## Quick Start (Vite Showcase & `www-dist/` Export)
```bash
python3 scripts/build_www.py
```

Or run the local Vite dev server directly:
```bash
cd prototypes/astryx-control-plane
npm install
npm run dev
```

## Validation Screenshots
- `docs/validation/astryx-control-plane/conduit-astryx-held-quote.png`
- `docs/validation/astryx-control-plane/conduit-astryx-discovery-fullwidth.png`
- `docs/validation/astryx-control-plane/conduit-astryx-post-release.png`
- `docs/validation/astryx-control-plane/conduit-astryx-mobile-overview.png`
- `docs/validation/astryx-control-plane/conduit-astryx-mobile-quote-sheet.png`
- `docs/validation/astryx-control-plane/conduit-astryx-mobile-passes.png`
