# Agent Commerce Control Plane <img src="https://github.com/maceip/Outrider/blob/main/www/public/sv.gif?raw=1" width="55" alt="Outrider" align="middle">

**See every request your agents make. Gate high-trust capabilities. Ship autonomous workflows with confidence.**

Outrider sits locally between your agents and the outside world—giving you a real-time flight deck to watch live traffic, test tool handshakes step by step, and issue scoped access passes before anything hits production. Zero cloud relays, zero billing rails, zero guesswork.

[**Launch Live Testflight Showcase →**](https://maceip.github.io/Outrider/) · [**Download Latest Release →**](https://github.com/maceip/Outrider/releases/latest)

---

### Why Teams Run Outrider

- **Full-Spectrum Visibility** — Watch every agent request, streaming socket, and tool call unfold live in one unified workbench.
- **Interactive Tool Flight Deck** — Connect to any local or remote tool server, run calls from auto-generated forms, and inspect exact wire payloads in milliseconds.
- **Scoped Access Passes** — Gate sensitive tools and bundles behind operator-signed passes with strict call quotas, session binding, and instant one-click revocation.
- **Instant First-Run Testflight** — Opens populated with live local traffic on first launch so your team sees the full workflow in seconds, not hours.
- **100% Local & Verifiable** — Single native Rust binary with an embedded workbench, offline-ready runtime, and attested cross-platform installers.

### Inside the Control Plane

| Surface | What You Get |
| :--- | :--- |
| **Dashboard** | Live throughput, session health, and real-time exchange feed |
| **Traffic** | Split-pane wire inspector with instant filtering, payload viewer, and one-click replay copy |
| **Inspector** | Interactive tool runner, resource browser, and bidirectional frame log |
| **Receipts** | One-drawer access pass minting, live quota tracking, and instant revocation |
| **Analytics & Settings** | Host breakdown, capability probe controls, upstream routing, and root certificates |

### Start in 30 Seconds

Grab the signed installer for **macOS (`.dmg`)**, **Windows (`.msi`)**, or **Linux (`.tar.gz`)** from [**Releases**](https://github.com/maceip/Outrider/releases/latest), or launch from source:

```sh
python3 -B scripts/install_native.py
cargo build --release -p proxyfor --bin outrider
./target/release/outrider --web
```

Open `http://127.0.0.1:8080/__proxyfor__/` — local browsers authenticate automatically and enter Testflight mode on first run.
