mod common;

use anyhow::{Context, Result};
use proxyfor::server::WEB_PREFIX;
use serde_json::Value;
use std::{fs, net::Ipv4Addr, path::Path, time::Duration};

struct SpawnedOutrider {
    port: u16,
    child: tokio::process::Child,
}

impl SpawnedOutrider {
    async fn launch(config_dir: &Path, extra_args: &[&str]) -> Result<Self> {
        let probe_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = probe_listener.local_addr()?.port();
        drop(probe_listener);

        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_outrider"));
        cmd.args(extra_args)
            .arg("-l")
            .arg(format!("127.0.0.1:{port}"))
            .arg("--config-dir")
            .arg(config_dir)
            .env("OUTRIDER_CLEF_NO_FETCH", "1")
            .env_remove("CI")
            .env_remove("OUTRIDER_HEADLESS")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        let child = cmd.spawn().context("Failed to spawn outrider binary")?;
        let client = common::build_client()?;
        let status_url = format!("http://127.0.0.1:{port}{WEB_PREFIX}/commerce/status");

        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Ok(res) = client.get(&status_url).send().await
                    && res.status() == 200
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .context("Timed out waiting for outrider HTTP gateway status")?;

        Ok(Self { port, child })
    }

    async fn stop(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

#[tokio::test]
async fn first_run_demo_populates_real_loopback_traffic_inspector_and_commerce_once() -> Result<()>
{
    let tmp = tempfile::tempdir()?;
    let config_dir = tmp.path().join("cfg");
    let client = common::build_client()?;

    // 1. Launch with `--web --no-open --demo` on a fresh config dir.
    let mut run1 = SpawnedOutrider::launch(&config_dir, &["--web", "--no-open", "--demo"]).await?;
    let port1 = run1.port;
    let base1 = format!("http://127.0.0.1:{port1}{WEB_PREFIX}");
    let admin_token = fs::read_to_string(config_dir.join("outrider-admin-token"))?
        .trim()
        .to_owned();

    // Wait for `demo.first_run_completed` audit row and finalized traffic payloads.
    let snapshot1: Value = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let res = client
                .get(format!("{base1}/commerce/snapshot"))
                .bearer_auth(&admin_token)
                .send()
                .await?;
            if res.status() == 200 {
                let snap: Value = res.json().await?;
                let completed = snap["admin_audit_log"].as_array().is_some_and(|rows| {
                    rows.iter()
                        .any(|r| r["action"] == "demo.first_run_completed")
                });
                if completed {
                    return Ok::<Value, anyhow::Error>(snap);
                }
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .context("Timed out waiting for first-run demo completion")??;

    let traffics1: Value = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let list: Value = client
                .get(format!("{base1}/traffics"))
                .send()
                .await?
                .json()
                .await?;
            if let Some(arr) = list.as_array()
                && arr.len() >= 5
                && arr.iter().all(|item| item["size"].is_u64())
            {
                return Ok::<Value, anyhow::Error>(list);
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .context("Timed out waiting for finalized traffic entries")??;

    // Assertion 1: `/__proxyfor__/traffics` contains both real proxied HTTP packets AND real `/mcp` packets.
    let traffic_arr = traffics1.as_array().expect("traffics array");
    let catalog_http = traffic_arr
        .iter()
        .find(|t| {
            t["method"] == "GET"
                && t["uri"]
                    .as_str()
                    .is_some_and(|u| u.ends_with("/v1/catalog"))
                && t["status"] == 200
        })
        .context("Missing proxied GET /v1/catalog in /traffics")?;
    assert!(
        traffic_arr.iter().any(|t| {
            t["method"] == "POST"
                && t["uri"].as_str().is_some_and(|u| u.ends_with("/v1/check"))
                && t["status"] == 200
        }),
        "Missing proxied POST /v1/check in /traffics: {traffic_arr:?}"
    );
    assert!(
        traffic_arr.iter().any(|t| {
            t["method"] == "POST"
                && t["uri"] == format!("http://127.0.0.1:{port1}/mcp")
                && t["status"] == 200
        }),
        "Missing real /mcp packet in /traffics: {traffic_arr:?}"
    );

    // Verify captured response body on the proxied HTTP packet came from the real upstream wire exchange.
    let catalog_traffic_id = catalog_http["id"].as_u64().expect("traffic id");
    let catalog_detail: Value = client
        .get(format!("{base1}/traffic/{catalog_traffic_id}"))
        .send()
        .await?
        .json()
        .await?;
    assert!(
        catalog_detail["res_body"]["value"]
            .as_str()
            .is_some_and(|body| body.contains("demo-upstream")),
        "Expected real captured response body in traffic detail, got {catalog_detail}"
    );

    // Assertion 2: `/__proxyfor__/commerce/inspector/state` has a live connected `/mcp` connection
    // with recorded `tools/list` and `outrider_catalog` messages.
    let inspector_overview: Value = client
        .get(format!("{base1}/commerce/inspector/state"))
        .bearer_auth(&admin_token)
        .send()
        .await?
        .json()
        .await?;
    let connections1 = inspector_overview["connections"]
        .as_array()
        .expect("inspector connections");
    let live_mcp_conn = connections1
        .iter()
        .find(|c| {
            c["live"] == true
                && c["status"] == "Connected"
                && c["target"] == format!("http://127.0.0.1:{port1}/mcp")
        })
        .context("Expected live connected /mcp inspector session")?;
    let connection_id = live_mcp_conn["connection_id"]
        .as_str()
        .expect("connection_id");

    let inspector_detail: Value = client
        .get(format!(
            "{base1}/commerce/inspector/state?connection_id={connection_id}"
        ))
        .bearer_auth(&admin_token)
        .send()
        .await?
        .json()
        .await?;
    let messages = inspector_detail["messages"]
        .as_array()
        .expect("inspector messages");
    assert!(
        messages
            .iter()
            .any(|m| m["method"] == "tools/list" && m["kind"] == "response"),
        "Missing tools/list response in inspector messages: {messages:?}"
    );
    assert!(
        messages.iter().any(|m| {
            m["method"] == "tools/call"
                && m["kind"] == "request"
                && m["body"]["params"]["name"] == "outrider_catalog"
        }),
        "Missing outrider_catalog call in inspector messages: {messages:?}"
    );
    assert!(
        messages.iter().any(|m| {
            m["method"] == "tools/call"
                && m["kind"] == "request"
                && m["body"]["params"]["name"] == "outrider_checkout_bundle"
        }),
        "Missing outrider_checkout_bundle call in inspector messages: {messages:?}"
    );

    // Assertion 3: `/__proxyfor__/commerce/snapshot` has the `session-evidence` bundle,
    // >=1 session, and >=1 active receipt.
    let bundles1 = snapshot1["bundles"].as_array().expect("bundles");
    assert!(
        bundles1.iter().any(|b| {
            b["bundle_id"] == "session-evidence"
                && b["title"] == "Session Evidence"
                && b["items"] == serde_json::json!(["outrider_session_evidence"])
        }),
        "Missing session-evidence bundle in snapshot: {bundles1:?}"
    );

    let sessions1 = snapshot1["agent_sessions"]
        .as_array()
        .expect("agent_sessions");
    assert!(
        !sessions1.is_empty(),
        "Expected >= 1 real agent session in snapshot"
    );
    let session_subject = sessions1[0]["subject"].as_str().expect("session subject");

    let receipts1 = snapshot1["capability_receipts"]
        .as_array()
        .expect("capability_receipts");
    assert!(
        receipts1.iter().any(|r| {
            r["bundle_id"] == "session-evidence"
                && r["subject"] == session_subject
                && r["max_calls"] == 10
                && r["remaining_calls"].as_i64().is_some_and(|rem| rem > 0)
                && r["revoked"] == 0
                && r["signature_verified"] == true
        }),
        "Expected >= 1 active verified Ed25519 receipt in snapshot: {receipts1:?}"
    );

    let sessions_count_1 = sessions1.len();
    let receipts_count_1 = receipts1.len();
    let bundles_count_1 = bundles1.len();
    let quotes_count_1 = snapshot1["mrtr_quotes"].as_array().unwrap().len();
    let proxy_traffic_db_count_1 = snapshot1["proxy_traffic"].as_array().unwrap().len();
    let inspector_conns_count_1 = connections1.len();

    run1.stop().await;

    // Assertion 4: Restarting without `--demo` on the same `--config-dir` does NOT duplicate demo rows
    // (even when `--no-open` is omitted and `CI` / `OUTRIDER_HEADLESS` are unset).
    let mut run2 = SpawnedOutrider::launch(&config_dir, &["--web"]).await?;
    let port2 = run2.port;
    let base2 = format!("http://127.0.0.1:{port2}{WEB_PREFIX}");

    tokio::time::sleep(Duration::from_millis(500)).await;

    let traffics2: Value = client
        .get(format!("{base2}/traffics"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        traffics2.as_array().unwrap().len(),
        0,
        "Restart without --demo must not replay demo traffic"
    );

    let snapshot2: Value = client
        .get(format!("{base2}/commerce/snapshot"))
        .bearer_auth(&admin_token)
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        snapshot2["agent_sessions"].as_array().unwrap().len(),
        sessions_count_1,
        "Restart without --demo must not duplicate agent_sessions"
    );
    assert_eq!(
        snapshot2["capability_receipts"].as_array().unwrap().len(),
        receipts_count_1,
        "Restart without --demo must not duplicate capability_receipts"
    );
    assert_eq!(
        snapshot2["bundles"].as_array().unwrap().len(),
        bundles_count_1,
        "Restart without --demo must not duplicate bundles"
    );
    assert_eq!(
        snapshot2["mrtr_quotes"].as_array().unwrap().len(),
        quotes_count_1,
        "Restart without --demo must not duplicate mrtr_quotes"
    );
    assert_eq!(
        snapshot2["proxy_traffic"].as_array().unwrap().len(),
        proxy_traffic_db_count_1,
        "Restart without --demo must not duplicate proxy_traffic rows"
    );

    let inspector_overview2: Value = client
        .get(format!("{base2}/commerce/inspector/state"))
        .bearer_auth(&admin_token)
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        inspector_overview2["connections"].as_array().unwrap().len(),
        inspector_conns_count_1,
        "Restart without --demo must not duplicate inspector_connections"
    );

    run2.stop().await;

    // Also verify `--web --no-open` on a fresh config dir stays completely clean at 0 rows.
    let clean_cfg = tmp.path().join("clean-cfg");
    let mut clean_run = SpawnedOutrider::launch(&clean_cfg, &["--web", "--no-open"]).await?;
    let clean_base = format!("http://127.0.0.1:{}{WEB_PREFIX}", clean_run.port);
    let clean_token = fs::read_to_string(clean_cfg.join("outrider-admin-token"))?
        .trim()
        .to_owned();

    tokio::time::sleep(Duration::from_millis(350)).await;

    let clean_traffics: Value = client
        .get(format!("{clean_base}/traffics"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(clean_traffics.as_array().unwrap().len(), 0);

    let clean_snap: Value = client
        .get(format!("{clean_base}/commerce/snapshot"))
        .bearer_auth(&clean_token)
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(clean_snap["agent_sessions"].as_array().unwrap().len(), 0);
    assert_eq!(
        clean_snap["capability_receipts"].as_array().unwrap().len(),
        0
    );

    clean_run.stop().await;

    Ok(())
}
