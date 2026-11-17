# Agentic Commerce Control Plane <img src="https://github.com/maceip/Outrider/blob/main/www/public/sv.gif?raw=1" width="55" alt="Outrider" align="middle">

**Fingerprint AI agents to dynamically package and price services for their needs, stop bad discounts before they leave your store, and approve high-value deals in real time.**

Outrider sits directly in front of your catalog and tool endpoints—giving you a live control plane to see what AI shopping agents ask for, identify how each agent operates across application layers, counter quotes against your margin floors, and issue scoped checkout passes locally.

[**Try Live Control Plane →**](https://maceip.github.io/Outrider/) · [**Download Latest Release →**](https://github.com/maceip/Outrider/releases/latest)

---

### Why Teams Run Outrider

- **Active Agent Fingerprinting** — Turn minimal query-response traces into deep agent intelligence—identifying model versions, prompting frameworks, and tool-call behavior across application layers as agents navigate your services.
- **Pause & Counter Live Quotes** — Hold outbound agent offers mid-flight, validate them against your margin floors, and approve or replace the response in real time without rewriting wire history.
- **Dynamic Service Packaging & Scoped Passes** — Bundle capabilities for specific buyer sessions and gate checkout behind operator-signed passes with strict call quotas and instant one-click revocation.
- **Runs on Your Machine, Private by Default** — Built around a lean native Rust core optimized to run effortlessly on your laptop or a Xeon server. Install one app on macOS, Windows, or Linux—your pricing rules, customer payloads, and signing keys never touch a third-party cloud.

### Inside the Control Plane

| Surface | What You Get |
| :--- | :--- |
| **Overview & Trace Map** | Causal negotiation graph, 5-stage transaction timeline, query-response trace table, and 4-gate policy verification bar |
| **Offer Hold & Approval** | Bidirectional payload inspector, margin-floor validation, counter-offer staging toggle, and live release controls |
| **Wire Frames** | Full HTTP, HTTPS, MCP, and WebSocket stream capture with instant filtering, payload inspection, HAR export, and cURL copy |
| **Passes & Bundles** | Scoped session pass ledger, bundle packaging rules, one-drawer pass minting, live quota tracking, and instant revocation |
| **Settings & Help** | Local proxy endpoints, active capability probe policy, root certificate downloads (`.pem` / `.cer`), and setup guides |

### Start in 30 Seconds

Grab the signed installer for **macOS (`.dmg`)**, **Windows (`.msi`)**, or **Linux (`.tar.gz`)** from [**Releases**](https://github.com/maceip/Outrider/releases/latest), or build from source:

```sh
python3 -B scripts/install_native.py
cargo build --release -p proxyfor --bin outrider
./target/release/outrider --web
```

Open `http://127.0.0.1:8080/__proxyfor__/` — local browsers authenticate automatically and open directly into the Agentic Commerce Control Plane.
