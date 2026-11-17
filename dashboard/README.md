# Conduit — Agentic Commerce Control Plane UI

Static Next.js 16 + HeroUI v3 / HeroUI Pro frontend for the **Agentic Commerce Control Plane**, embedded directly into the native `outrider` binary (`dashboard/out`) and exported for the interactive GitHub Pages showcase (`www-dist`).

## Quick Start

```bash
npm ci
npm run dev
```

## Production Exports

```bash
npm run typecheck
npm run lint
rm -rf out
npm run build       # -> dashboard/out (embedded into native binary at /__proxyfor__/)
npm run build:www   # -> ../www-dist (interactive GitHub Pages control plane showcase)
```

## Routes

| Route | Purpose |
| :--- | :--- |
| `/` | Unified Agentic Commerce Control Plane (`Overview`, `Graph`, `Approve`, `Wire`, `Passes`) |
| `/settings` | Local gateway endpoints and active capability probe policy |
| `/help` | Root CA certificate downloads (`.pem` / `.cer`), HAR export, and proxy setup guide |
