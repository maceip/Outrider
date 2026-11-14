mod common;

use anyhow::Result;
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{Commerce, db::Database},
    onboarding::upsert_codex_toml_section,
    server::{PrintMode, ServerBuilder, WEB_PREFIX},
};
use serde_json::{Value, json};
use std::{
    fs,
    net::{IpAddr, Ipv4Addr},
    path::Path,
    time::Duration,
};

#[tokio::test]
async fn bootstrap_exchange_single_use_loopback_only_and_sortie_records_tls_mcp_commerce_and_proxy()
-> Result<()> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("outrider.db"))?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().join("clef-cache"),
        workers: 1,
    })
    .await?;
    let (commerce, token) = Commerce::new(db, engine, dir.path(), true)?;
    let expected_token = token.expect("fresh admin token");

    // Non-loopback peer must ALWAYS be rejected with 403 even when allow_remote == true
    let remote_nonce = commerce.auth.mint_bootstrap_nonce();
    assert_eq!(
        commerce.auth.exchange_bootstrap_nonce(
            Some(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50))),
            &remote_nonce
        ),
        Err(403)
    );

    let server = ServerBuilder::new(common::build_ca()?)
        .commerce(commerce.clone())
        .print_mode(PrintMode::Nothing)
        .web(true)
        .build();
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let stop = server.run(listener).await?;

    let client = common::build_client()?;
    let base = format!("http://127.0.0.1:{port}{WEB_PREFIX}/commerce");

    // Public status now exposes listen_addr & mcp_endpoint
    let status: Value = client.get(format!("{base}/status")).send().await?.json().await?;
    assert_eq!(status["listen_addr"], format!("127.0.0.1:{port}"));
    assert_eq!(
        status["mcp_endpoint"],
        format!("http://127.0.0.1:{port}/mcp")
    );

    // Mint a bootstrap nonce and exchange it once over HTTP
    let nonce = commerce.auth.mint_bootstrap_nonce();
    let bad_resp = client
        .post(format!("{base}/bootstrap/exchange"))
        .json(&json!({"nonce": "0000000000000000000000000000000000000000000000000000000000000000"}))
        .send()
        .await?;
    assert_eq!(bad_resp.status(), 401);

    let ok_resp = client
        .post(format!("{base}/bootstrap/exchange"))
        .json(&json!({"nonce": nonce}))
        .send()
        .await?;
    assert_eq!(ok_resp.status(), 200);
    let exchanged: Value = ok_resp.json().await?;
    assert_eq!(exchanged["token"], expected_token);

    // Replay of the same nonce MUST fail with 401
    let replay_resp = client
        .post(format!("{base}/bootstrap/exchange"))
        .json(&json!({"nonce": nonce}))
        .send()
        .await?;
    assert_eq!(replay_resp.status(), 401);

    // Execute the cross-browser in-process Rust TLS rmcp sortie
    let sortie_resp = client
        .post(format!("{base}/onboarding/run-sortie"))
        .bearer_auth(&expected_token)
        .json(&json!({"client_name": "Zim Observatory Test Sortie"}))
        .send()
        .await?;
    let sortie_status = sortie_resp.status();
    let sortie: Value = sortie_resp.json().await?;
    assert_eq!(sortie_status, 200, "sortie failed: {sortie}");
    let session_id = sortie["session_id"].as_str().expect("session_id").to_owned();
    assert!(sortie["proxy_traffic_recorded"].as_bool().unwrap_or(false));

    // Verify snapshot contains genuine TLS ClientHello JA4, TLS cipher, HTTP header order,
    // MCP 2026-07-28 frames, MRTR quote, verified Ed25519 receipt, redemption, and proxy_traffic!
    let snap: Value = client
        .get(format!("{base}/snapshot"))
        .bearer_auth(&expected_token)
        .send()
        .await?
        .json()
        .await?;

    let sessions = snap["agent_sessions"].as_array().expect("agent_sessions");
    assert!(
        sessions
            .iter()
            .any(|s| s["session_id"] == session_id && s["state"] == "Entitled")
    );

    let obs = snap["fingerprint_observations"]
        .as_array()
        .expect("fingerprint_observations");
    assert!(
        obs.iter()
            .any(|o| o["session_id"] == session_id && o["kind"] == "client_hello")
    );
    assert!(
        obs.iter()
            .any(|o| o["session_id"] == session_id && o["kind"] == "negotiated_tls")
    );
    assert!(
        obs.iter().any(|o| {
            o["session_id"] == session_id
                && o["kind"] == "http_header_order"
                && o["evidence"]["status"] == "Captured"
        })
    );

    assert!(!snap["mcp_frames"].as_array().unwrap().is_empty());
    assert!(!snap["mrtr_quotes"].as_array().unwrap().is_empty());
    assert!(
        snap["capability_receipts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["signature_verified"] == true)
    );
    assert!(!snap["receipt_redemptions"].as_array().unwrap().is_empty());
    assert!(!snap["proxy_traffic"].as_array().unwrap().is_empty());

    let _ = stop.send(());
    Ok(())
}

#[tokio::test]
async fn agent_scanner_backup_injection_consent_restart_and_desktop_port_fallback() -> Result<()> {
    let scan_root = tempfile::tempdir()?;
    let claude_dir = scan_root.path().join("claude_desktop");
    let home_dir = scan_root.path().join("home");
    let codex_dir = home_dir.join(".codex");
    fs::create_dir_all(&claude_dir)?;
    fs::create_dir_all(&codex_dir)?;
    fs::write(
        claude_dir.join("claude_desktop_config.json"),
        r#"{"mcpServers":{"existing":{"command":"node","args":["s.js"]}}}"#,
    )?;
    fs::write(
        codex_dir.join("config.toml"),
        "model = \"gpt-5\"\n\n[mcp_servers.other]\nurl = \"http://localhost:9999/mcp\"\n",
    )?;

    let restart_log = scan_root.path().join("restarts.jsonl");
    let opener_log = scan_root.path().join("opened_url.txt");
    let opener_script = scan_root.path().join("record_open.sh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(
            &opener_script,
            format!("#!/bin/sh\nprintf '%s' \"$1\" > '{}'\n", opener_log.display()),
        )?;
        fs::set_permissions(&opener_script, fs::Permissions::from_mode(0o755))?;
    }

    // Hold a port and launch `outrider --desktop` with `-l` omitted? Wait: to test deterministic
    // fallback without touching host port 8080 if another service is running, let's spawn `outrider`
    // with `--desktop` and custom `--config-dir` + `OUTRIDER_BROWSER_OPENER`!
    let cfg_dir = scan_root.path().join("outrider-cfg");
    let free_probe = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let base_port = free_probe.local_addr()?.port();
    // Keep `free_probe` bound so `base_port` is occupied if we test port collision, or pass explicit free port:
    drop(free_probe);

    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_outrider"));
    cmd.args([
        "--desktop",
        "--listen",
        &format!("127.0.0.1:{base_port}"),
        "--config-dir",
        cfg_dir.to_str().unwrap(),
        "--probe-policy",
        "on-request",
    ])
    .env("OUTRIDER_CLEF_NO_FETCH", "1")
    .env("OUTRIDER_AGENT_SCAN_ROOT", scan_root.path())
    .env("OUTRIDER_AGENT_TEST_RUNNING", "claude-desktop")
    .env("OUTRIDER_AGENT_RESTART_RECORDER", &restart_log)
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    cmd.env("OUTRIDER_BROWSER_OPENER", &opener_script);
    #[cfg(windows)]
    cmd.arg("--no-open");

    let mut child = cmd.spawn()?;

    let client = common::build_client()?;
    let base = format!("http://127.0.0.1:{base_port}{WEB_PREFIX}/commerce");

    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Ok(r) = client.get(format!("{base}/status")).send().await
                && r.status() == 200
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    })
    .await?;

    let token: String = {
        #[cfg(unix)]
        {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if opener_log.is_file()
                        && !fs::read_to_string(&opener_log).unwrap_or_default().is_empty()
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            })
            .await?;
            let launched = fs::read_to_string(&opener_log)?;
            assert!(
                launched.starts_with(&format!(
                    "http://127.0.0.1:{base_port}/__proxyfor__/zim/#bootstrap="
                )),
                "Expected desktop first-run browser launch to /zim/#bootstrap=..., got {launched}"
            );
            let nonce = launched.split("#bootstrap=").nth(1).expect("nonce");
            let exchanged: Value = client
                .post(format!("{base}/bootstrap/exchange"))
                .json(&json!({"nonce": nonce}))
                .send()
                .await?
                .json()
                .await?;
            exchanged["token"]
                .as_str()
                .expect("exchanged bearer token")
                .to_owned()
        }
        #[cfg(windows)]
        {
            fs::read_to_string(cfg_dir.join("outrider-admin-token"))?
                .trim()
                .to_owned()
        }
    };

    // Scan agents
    let scan: Value = client
        .get(format!("{base}/onboarding/agents"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    assert!(
        scan["deep_links"]["cursor"]
            .as_str()
            .unwrap()
            .starts_with("cursor://anysphere.cursor-deeplink/mcp/install?")
    );
    assert!(
        scan["deep_links"]["vscode"]
            .as_str()
            .unwrap()
            .starts_with("vscode:mcp/install?")
    );
    let agents = scan["agents"].as_array().unwrap();
    let cd = agents.iter().find(|a| a["id"] == "claude-desktop").unwrap();
    assert_eq!(cd["detected"], true);
    assert_eq!(cd["already_configured"], false);
    assert_eq!(cd["running"], true);

    // Configure claude-desktop WITHOUT restart confirmation -> must NOT restart
    let cfg1: Value = client
        .post(format!("{base}/onboarding/configure-agent"))
        .bearer_auth(&token)
        .json(&json!({"agent_id": "claude-desktop", "restart_confirmed": false}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(cfg1["configured"], true);
    assert_eq!(cfg1["restarted"], false);
    assert!(cfg1["backup_path"].as_str().is_some_and(|p| Path::new(p).is_file()));
    assert!(!restart_log.exists());

    let merged_claude: Value = serde_json::from_str(&fs::read_to_string(
        claude_dir.join("claude_desktop_config.json"),
    )?)?;
    assert_eq!(merged_claude["mcpServers"]["existing"]["command"], "node");
    assert!(merged_claude["mcpServers"]["outrider"]["command"].is_string());

    // Configure claude-desktop WITH restart_confirmed == true -> records restart
    let cfg2: Value = client
        .post(format!("{base}/onboarding/configure-agent"))
        .bearer_auth(&token)
        .json(&json!({"agent_id": "claude-desktop", "restart_confirmed": true}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(cfg2["restarted"], true);
    assert!(fs::read_to_string(&restart_log)?.contains("claude-desktop"));

    // Configure codex
    let cfg_codex: Value = client
        .post(format!("{base}/onboarding/configure-agent"))
        .bearer_auth(&token)
        .json(&json!({"agent_id": "codex", "restart_confirmed": false}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(cfg_codex["configured"], true);
    let codex_toml = fs::read_to_string(codex_dir.join("config.toml"))?;
    assert!(codex_toml.contains("[mcp_servers.other]"));
    assert!(codex_toml.contains("[mcp_servers.outrider]"));
    assert!(codex_toml.contains(&format!("http://127.0.0.1:{base_port}/mcp")));

    let _ = child.kill().await;
    let _ = child.wait().await;

    // Unit-check idempotent Codex TOML replacement
    let first = upsert_codex_toml_section("model = \"o3\"\n", "http://127.0.0.1:8080/mcp");
    let second = upsert_codex_toml_section(&first, "http://127.0.0.1:8081/mcp");
    assert_eq!(second.matches("[mcp_servers.outrider]").count(), 1);
    assert!(second.contains("http://127.0.0.1:8081/mcp"));
    assert!(!second.contains("http://127.0.0.1:8080/mcp"));

    Ok(())
}
