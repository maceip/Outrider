//! Automatic first-run live loopback demo mode (`--demo` / `--no-demo`).
//!
//! Executes 100% real wire traffic against Outrider's bound HTTP proxy and `/mcp`
//! listener without inserting synthetic rows:
//! 1. Starts an ephemeral loopback HTTP upstream (`127.0.0.1:0`) serving
//!    `GET /v1/catalog` and `POST /v1/check`, then sends real HTTP GET & POST
//!    requests through Outrider's forward proxy.
//! 2. Upserts the `session-evidence` starter bundle when no bundles exist yet.
//! 3. Connects the built-in MCP Inspector over HTTP to `http://127.0.0.1:{port}/mcp`
//!    (kept live so `/inspector` opens connected and ready to run tools) and executes
//!    real `tools/list`, `outrider_catalog`, and `outrider_checkout_bundle` calls.
//! 4. Issues a real Ed25519 capability receipt (`max_calls: 10`, 24h validity) bound
//!    to the live session's subject and presents it once to entitle the session.
//! 5. Shuts down the ephemeral upstream cleanly and marks `first_run_demo_completed`
//!    in SQLite so subsequent launches on the same database do not duplicate rows.

use crate::{
    commerce::{
        Commerce,
        bundler::{self, Bundle},
        db::{Database, now},
    },
    mcp_gateway::handler::public_session_id,
};
use anyhow::{Context, Result, anyhow, ensure};
use bytes::Bytes;
use http::{Method, StatusCode, header::CONTENT_TYPE};
use http_body_util::{BodyExt, Full, Limited, combinators::BoxBody};
use hyper::{Request, Response, body::Incoming, service::service_fn};
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto,
};
use serde_json::{Value, json};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tokio_graceful::Shutdown;

pub const DEMO_BUNDLE_ID: &str = "session-evidence";
pub const DEMO_BUNDLE_TITLE: &str = "Session Evidence";
pub const DEMO_BUNDLE_ITEM: &str = "outrider_session_evidence";
pub const DEMO_RECEIPT_MAX_CALLS: i64 = 10;
pub const DEMO_RECEIPT_TTL_SECS: i64 = 86_400;
const DEMO_ACTOR: &str = "system:first-run-demo";

pub fn should_run_first_run_demo(
    demo: bool,
    no_demo: bool,
    no_open: bool,
    headless: bool,
    stdio: bool,
    tui: bool,
    dump: bool,
    db: &Database,
) -> Result<bool> {
    if demo {
        return Ok(!stdio);
    }
    if no_demo
        || no_open
        || headless
        || stdio
        || tui
        || dump
        || std::env::var_os("CI").is_some()
        || std::env::var_os("OUTRIDER_HEADLESS").is_some()
    {
        return Ok(false);
    }
    db.is_first_run_demo_pending()
}

pub fn spawn_first_run_demo(listen_addr: SocketAddr, commerce: Arc<Commerce>) -> JoinHandle<()> {
    tokio::spawn(async move {
        match run_first_run_demo(listen_addr, commerce).await {
            Ok(summary) => {
                info!("First-run live loopback demo completed: {summary}");
            }
            Err(err) => {
                warn!("First-run live loopback demo failed: {err:#}");
            }
        }
    })
}

struct EphemeralUpstream {
    addr: SocketAddr,
    stop_tx: Option<oneshot::Sender<()>>,
    join_handle: Option<JoinHandle<()>>,
}

impl EphemeralUpstream {
    async fn start() -> Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .context("Failed to bind ephemeral demo upstream listener")?;
        let addr = listener.local_addr()?;
        let (stop_tx, stop_rx) = oneshot::channel::<()>();

        let join_handle = tokio::spawn(async move {
            let server = auto::Builder::new(TokioExecutor::new());
            let shutdown = Shutdown::new(async {
                let _ = stop_rx.await;
            });
            let guard = shutdown.guard_weak();

            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((tcp, _)) = accepted else {
                            continue;
                        };
                        let server = server.clone();
                        shutdown.spawn_task(async move {
                            let _ = server
                                .serve_connection(TokioIo::new(tcp), service_fn(handle_demo_upstream))
                                .await;
                        });
                    }
                    _ = guard.cancelled() => {
                        break;
                    }
                }
            }

            shutdown.shutdown().await;
        });

        Ok(Self {
            addr,
            stop_tx: Some(stop_tx),
            join_handle: Some(join_handle),
        })
    }

    async fn shutdown(mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.await;
        }
    }
}

impl Drop for EphemeralUpstream {
    fn drop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

fn json_box_response(
    status: StatusCode,
    payload: &'static str,
) -> Response<BoxBody<Bytes, anyhow::Error>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(
            Full::new(Bytes::from_static(payload.as_bytes()))
                .map_err(|never| match never {})
                .boxed(),
        )
        .expect("valid ephemeral demo HTTP response")
}

async fn handle_demo_upstream(
    req: Request<Incoming>,
) -> Result<Response<BoxBody<Bytes, anyhow::Error>>> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/v1/catalog") => Ok(json_box_response(
            StatusCode::OK,
            r#"{"service":"demo-upstream","items":["weather","quotes"]}"#,
        )),
        (&Method::POST, "/v1/check") => {
            Limited::new(req.into_body(), 64 * 1024)
                .collect()
                .await
                .map_err(|e| anyhow!("{e}"))?;
            Ok(json_box_response(StatusCode::OK, r#"{"ok":true}"#))
        }
        _ => Ok(json_box_response(
            StatusCode::NOT_FOUND,
            r#"{"error":"not_found"}"#,
        )),
    }
}

fn loopback_connect_addr(listen_addr: SocketAddr) -> SocketAddr {
    let ip = match listen_addr.ip() {
        IpAddr::V4(v4) if v4.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(v6) if v6.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        other => other,
    };
    SocketAddr::new(ip, listen_addr.port())
}

pub async fn run_first_run_demo(listen_addr: SocketAddr, commerce: Arc<Commerce>) -> Result<Value> {
    let connect_addr = loopback_connect_addr(listen_addr);

    // 1. Start ephemeral loopback HTTP upstream and send 2 real HTTP requests through Outrider's proxy.
    let upstream = EphemeralUpstream::start().await?;
    let upstream_addr = upstream.addr;

    let proxy = reqwest::Proxy::http(format!("http://{connect_addr}"))
        .context("Invalid loopback proxy URL")?
        .no_proxy(None);
    let proxy_client = reqwest::Client::builder()
        .proxy(proxy)
        .no_brotli()
        .no_deflate()
        .no_gzip()
        .timeout(Duration::from_secs(10))
        .build()
        .context("Failed to construct loopback proxy HTTP client")?;

    let catalog_http_res = proxy_client
        .get(format!("http://{upstream_addr}/v1/catalog"))
        .header("accept", "application/json")
        .send()
        .await
        .context("Proxied GET /v1/catalog failed")?;
    ensure!(
        catalog_http_res.status() == StatusCode::OK,
        "Proxied GET /v1/catalog returned {}",
        catalog_http_res.status()
    );
    let _ = catalog_http_res.bytes().await?;

    let check_http_res = proxy_client
        .post(format!("http://{upstream_addr}/v1/check"))
        .json(&json!({"probe": "first-run"}))
        .send()
        .await
        .context("Proxied POST /v1/check failed")?;
    ensure!(
        check_http_res.status() == StatusCode::OK,
        "Proxied POST /v1/check returned {}",
        check_http_res.status()
    );
    let _ = check_http_res.bytes().await?;

    // 2. Upsert starter bundle (`session-evidence`) if no bundles exist yet.
    commerce.register_local_tools()?;
    let existing_bundles = bundler::bundles(&commerce.db)?;
    let bundle_id = if existing_bundles.is_empty() {
        let starter = Bundle {
            bundle_id: DEMO_BUNDLE_ID.to_owned(),
            title: DEMO_BUNDLE_TITLE.to_owned(),
            items: vec![DEMO_BUNDLE_ITEM.to_owned()],
            rules: json!({}),
        };
        bundler::put_bundle(&commerce.db, &starter, DEMO_ACTOR)?;
        commerce.changed("/bundles/put", None);
        DEMO_BUNDLE_ID.to_owned()
    } else if let Some(found) = existing_bundles
        .iter()
        .find(|b| b.bundle_id == DEMO_BUNDLE_ID)
    {
        found.bundle_id.clone()
    } else {
        existing_bundles[0].bundle_id.clone()
    };

    // 3. Connect built-in MCP Inspector to `http://127.0.0.1:{port}/mcp` (kept live) and run real wire calls.
    let mcp_url = format!("http://{connect_addr}/mcp");
    let raw_session_secret = uuid::Uuid::new_v4().to_string();
    let derived_subject = public_session_id(&raw_session_secret);

    let connect_res = commerce
        .inspector
        .connect(
            &commerce,
            &json!({
                "transport": "http",
                "target": mcp_url,
                "lifecycle": "auto",
                "headers": {
                    "Outrider-Session-Id": raw_session_secret,
                },
            }),
            DEMO_ACTOR,
        )
        .await
        .context("Failed to connect MCP Inspector to loopback /mcp")?;
    let connection_id = connect_res["connection_id"]
        .as_str()
        .context("Inspector connect response missing connection_id")?
        .to_owned();

    let tools_list_res = commerce
        .inspector
        .request(&json!({
            "connection_id": connection_id,
            "method": "tools/list",
            "params": {},
        }))
        .await
        .context("Inspector tools/list request failed")?;
    ensure!(
        tools_list_res["kind"] == "response",
        "Inspector tools/list returned non-response: {tools_list_res}"
    );

    let mut catalog_mcp_res = commerce
        .inspector
        .request(&json!({
            "connection_id": connection_id,
            "method": "tools/call",
            "params": {
                "name": "outrider_catalog",
                "arguments": {},
            },
        }))
        .await
        .context("Inspector outrider_catalog call failed")?;
    if catalog_mcp_res["result"]["resultType"] == "input_required"
        && let Some(probe_state) = catalog_mcp_res["result"]["requestState"].as_str()
    {
        catalog_mcp_res = commerce
            .inspector
            .request(&json!({
                "connection_id": connection_id,
                "method": "tools/call",
                "params": {
                    "name": "outrider_catalog",
                    "arguments": {},
                    "requestState": probe_state,
                    "inputResponses": {
                        "capability_probe": {
                            "role": "assistant",
                            "content": {
                                "type": "text",
                                "text": "{\"ack\":\"outrider\"}",
                            },
                            "model": "outrider-inspector",
                            "stopReason": "endTurn",
                        },
                        "preferences": {
                            "action": "accept",
                            "content": {
                                "sla_tier": "standard",
                                "bundle_preference": bundle_id,
                            },
                        },
                    },
                },
            }))
            .await
            .context("Inspector outrider_catalog capability probe completion failed")?;
    }
    ensure!(
        catalog_mcp_res["kind"] == "response",
        "Inspector outrider_catalog returned non-response: {catalog_mcp_res}"
    );

    let checkout_quote_res = commerce
        .inspector
        .request(&json!({
            "connection_id": connection_id,
            "method": "tools/call",
            "params": {
                "name": "outrider_checkout_bundle",
                "arguments": {
                    "bundle_id": bundle_id,
                    "execute": true,
                },
            },
        }))
        .await
        .context("Inspector outrider_checkout_bundle quote call failed")?;
    ensure!(
        checkout_quote_res["kind"] == "response",
        "Inspector outrider_checkout_bundle returned non-response: {checkout_quote_res}"
    );

    // 4. Issue 1 real Ed25519 receipt (`max_calls: 10`, valid 24h) bound to the logical session's subject.
    let expires_at_unix = now() + DEMO_RECEIPT_TTL_SECS;
    let signed_receipt = commerce.receipts.issue(
        &derived_subject,
        &bundle_id,
        DEMO_RECEIPT_MAX_CALLS,
        expires_at_unix,
        DEMO_ACTOR,
    )?;
    commerce.receipts.verify_signature(&signed_receipt)?;
    let receipt_token = signed_receipt.encode()?;
    commerce.changed("/receipts/issue", Some(&derived_subject));

    // Present the signed receipt on the pending quote so the session is entitled and ready in `/inspector`.
    if checkout_quote_res["result"]["resultType"] == "input_required"
        && let Some(quote_state) = checkout_quote_res["result"]["requestState"].as_str()
    {
        let redeemed_res = commerce
            .inspector
            .request(&json!({
                "connection_id": connection_id,
                "method": "tools/call",
                "params": {
                    "name": "outrider_checkout_bundle",
                    "arguments": {
                        "bundle_id": bundle_id,
                        "execute": true,
                    },
                    "requestState": quote_state,
                    "inputResponses": {
                        "capability_receipt": {
                            "action": "accept",
                            "content": {
                                "receipt": receipt_token,
                            },
                        },
                    },
                },
            }))
            .await
            .context("Inspector outrider_checkout_bundle redemption failed")?;
        ensure!(
            redeemed_res["kind"] == "response",
            "Inspector outrider_checkout_bundle redemption returned non-response: {redeemed_res}"
        );

        let _ = commerce
            .inspector
            .request(&json!({
                "connection_id": connection_id,
                "method": "tools/list",
                "params": {},
            }))
            .await;
    }

    // 5. Shut down ephemeral loopback upstream cleanly and persist completion marker in SQLite.
    upstream.shutdown().await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    commerce.db.mark_first_run_demo_completed()?;

    let summary = json!({
        "session_id": derived_subject,
        "subject": derived_subject,
        "bundle_id": bundle_id,
        "receipt_id": signed_receipt.receipt.receipt_id,
        "inspector_connection_id": connection_id,
        "mcp_url": mcp_url,
    });
    commerce.db.admin_audit(
        DEMO_ACTOR,
        "demo.first_run_completed",
        &derived_subject,
        &summary,
    )?;
    commerce.changed("demo.completed", Some(&derived_subject));

    Ok(summary)
}
