use super::{Commerce, bundler};
use anyhow::{Context, Result};
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, Limited, StreamBody, combinators::BoxBody};
use hyper::{
    Request, Response,
    body::{Frame, Incoming},
};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::Arc};

#[derive(Clone, Copy, Debug)]
pub struct PeerAddress(pub SocketAddr);
type HttpResponse = Response<BoxBody<Bytes, anyhow::Error>>;
pub fn json_response(status: u16, value: Value) -> HttpResponse {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(
            Full::new(Bytes::from(value.to_string()))
                .map_err(|never| match never {})
                .boxed(),
        )
        .expect("valid HTTP response")
}
pub async fn route(commerce: Arc<Commerce>, request: Request<Incoming>) -> HttpResponse {
    let path = request
        .uri()
        .path()
        .strip_prefix("/__proxyfor__/commerce")
        .unwrap_or("")
        .to_owned();
    let method = request.method().as_str().to_owned();
    if method == "GET" && path == "/status" {
        let listen_addr = commerce.loopback_connect_addr().map(|a| a.to_string());
        let mcp_endpoint = commerce.mcp_http_url();
        return json_response(
            200,
            json!({
                "clef": commerce.clef.status(),
                "admin_allow_remote": commerce.auth.allow_remote,
                "probe_policy": *commerce.probe_policy.read().unwrap(),
                "listen_addr": listen_addr,
                "mcp_endpoint": mcp_endpoint,
            }),
        );
    }
    let peer = request.extensions().get::<PeerAddress>().map(|p| p.0.ip());
    if method == "POST" && path == "/bootstrap/exchange" {
        let bytes = match Limited::new(request.into_body(), 8 * 1024).collect().await {
            Ok(b) => b.to_bytes(),
            Err(e) => return json_response(413, json!({"error": e.to_string()})),
        };
        let body: Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => return json_response(400, json!({"error": e.to_string()})),
        };
        let Some(nonce) = body.get("nonce").and_then(Value::as_str) else {
            return json_response(400, json!({"error": "Missing nonce"}));
        };
        return match commerce.auth.exchange_bootstrap_nonce(peer, nonce) {
            Ok(token) => {
                let _ = commerce.db.admin_audit(
                    "desktop:bootstrap",
                    "auth.bootstrap_exchange",
                    "gateway",
                    &json!({"loopback": true}),
                );
                json_response(200, json!({"token": token}))
            }
            Err(403) => json_response(
                403,
                json!({"error": "Bootstrap exchange requires a loopback peer"}),
            ),
            Err(_) => json_response(401, json!({"error": "Invalid or expired bootstrap nonce"})),
        };
    }
    if method == "POST" && path == "/bootstrap/local" {
        let host_values: Vec<_> = request.headers().get_all("host").iter().collect();
        let host_header = match host_values.as_slice() {
            [single] => single.to_str().ok(),
            [] => request.uri().authority().map(|a| a.as_str()),
            _ => None,
        };
        let conduit_values: Vec<_> = request
            .headers()
            .get_all("x-conduit-client")
            .iter()
            .collect();
        let legacy_values: Vec<_> = request
            .headers()
            .get_all("x-outrider-client")
            .iter()
            .collect();
        let active_values = if !conduit_values.is_empty() {
            &conduit_values
        } else {
            &legacy_values
        };
        let client_header = match active_values.as_slice() {
            [single] => single.to_str().ok(),
            _ => None,
        };
        let sec_fetch_values: Vec<_> = request.headers().get_all("sec-fetch-site").iter().collect();
        let sec_fetch_site = match sec_fetch_values.as_slice() {
            [] => None,
            [single] => match single.to_str() {
                Ok(s) => Some(s),
                Err(_) => Some("__invalid__"),
            },
            _ => Some("__invalid__"),
        };
        let auth_res =
            commerce
                .auth
                .bootstrap_local_session(peer, host_header, client_header, sec_fetch_site);
        if let Err(e) = Limited::new(request.into_body(), 8 * 1024).collect().await {
            return json_response(413, json!({"error": e.to_string()}));
        }
        return match auth_res {
            Ok(token) => {
                let _ = commerce.db.admin_audit(
                    "desktop:local",
                    "auth.local_session",
                    "gateway",
                    &json!({"loopback": true}),
                );
                json_response(200, json!({"token": token}))
            }
            Err(_) => json_response(
                403,
                json!({"error": "Local desktop bootstrap requires local-only loopback dashboard origin"}),
            ),
        };
    }
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());
    if let Err(status) = commerce.auth.authorize(peer, authorization) {
        return json_response(
            status,
            json!({"error":if status==401 {"Admin bearer token required"}else{"Admin access requires a loopback peer"}}),
        );
    }
    if method == "GET" && path == "/events" {
        let stream = tokio_stream::wrappers::BroadcastStream::new(commerce.events.subscribe())
            .filter_map(|r| async move {
                match r {
                    Ok(event) => Some(Ok::<_, anyhow::Error>(Frame::data(Bytes::from(format!(
                        "data: {event}\n\n"
                    ))))),
                    Err(_) => Some(Ok(Frame::data(Bytes::from_static(
                        b"event: resync\ndata: {}\n\n",
                    )))),
                }
            });
        return Response::builder()
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .body(BodyExt::boxed(StreamBody::new(stream)))
            .unwrap();
    }
    if method == "GET" && path == "/snapshot" {
        return match commerce.snapshot() {
            Ok(v) => json_response(200, v),
            Err(e) => json_response(500, json!({"error":e.to_string()})),
        };
    }
    if method == "GET" && path == "/inspector/state" {
        let query: std::collections::HashMap<String, String> = request
            .uri()
            .query()
            .map(|q| {
                url::form_urlencoded::parse(q.as_bytes())
                    .into_owned()
                    .collect()
            })
            .unwrap_or_default();
        let after = query.get("after").and_then(|a| a.parse().ok()).unwrap_or(0);
        return match commerce
            .inspector
            .state(
                &commerce.db,
                query.get("connection_id").map(String::as_str),
                after,
            )
            .await
        {
            Ok(v) => json_response(200, v),
            Err(e) => json_response(500, json!({"error":format!("{e:#}")})),
        };
    }
    if method == "GET" && path == "/onboarding/agents" {
        return match crate::onboarding::scan_agents(&commerce) {
            Ok(v) => json_response(200, v),
            Err(e) => json_response(500, json!({"error": format!("{e:#}")})),
        };
    }
    if method == "GET" && path == "/interception/state" {
        return match commerce.interception.state(&commerce) {
            Ok(v) => json_response(200, v),
            Err(e) => json_response(500, json!({"error": format!("{e:#}")})),
        };
    }
    if method != "POST" {
        return json_response(405, json!({"error":"Method not allowed"}));
    }
    let bytes = match Limited::new(request.into_body(), 256 * 1024)
        .collect()
        .await
    {
        Ok(b) => b.to_bytes(),
        Err(e) => return json_response(413, json!({"error":e.to_string()})),
    };
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => return json_response(400, json!({"error":e.to_string()})),
    };
    let result = mutate(&commerce, &path, body, "admin:http").await;
    match result {
        Ok(value) => {
            commerce.changed(&path, None);
            json_response(200, value)
        }
        Err(e) => json_response(422, json!({"error":format!("{e:#}")})),
    }
}
pub async fn mutate(
    commerce: &Arc<Commerce>,
    path: &str,
    body: Value,
    actor: &str,
) -> Result<Value> {
    let string = |key: &str| -> Result<&str> {
        body[key].as_str().with_context(|| format!("Missing {key}"))
    };
    match path {
        "/receipts/issue" => {
            let signed = commerce.receipts.issue(
                string("subject")?,
                string("bundle_id")?,
                body["max_calls"].as_i64().context("Missing max_calls")?,
                body["expires_at_unix"]
                    .as_i64()
                    .context("Missing expires_at_unix")?,
                actor,
            )?;
            commerce.receipts.verify_signature(&signed)?;
            Ok(json!({"token":signed.encode()?,"signed_receipt":signed,"signature_verified":true}))
        }
        "/receipts/revoke" => {
            commerce.receipts.revoke(string("receipt_id")?, actor)?;
            Ok(json!({"revoked":string("receipt_id")?}))
        }
        "/bundles/put" => {
            let bundle: bundler::Bundle = serde_json::from_value(body)?;
            bundler::put_bundle(&commerce.db, &bundle, actor)?;
            Ok(serde_json::to_value(bundle)?)
        }
        "/evaluate" => {
            let session = string("session_id")?;
            let question = serde_json::from_value(body["question"].clone())?;
            let row = crate::clef::scorer::evaluate_session(
                &commerce.db,
                &commerce.clef,
                session,
                question,
            )
            .await?;
            commerce
                .db
                .admin_audit(actor, "clef.evaluate", session, &row)?;
            anyhow::ensure!(
                row["status"] == "Verified",
                "CLEF evaluation failed: {}",
                row["error"]
            );
            Ok(row)
        }
        "/upstreams/connect" => {
            commerce
                .federation
                .connect(commerce, string("name")?, string("endpoint")?, actor)
                .await
        }
        "/skills/load" => {
            commerce.load_skills(std::path::Path::new(string("path")?), actor)?;
            Ok(json!({"loaded":true}))
        }
        "/probe-policy" => {
            let policy: crate::fingerprint::active::ProbePolicy =
                serde_json::from_value(body["probe_policy"].clone())?;
            *commerce
                .probe_policy
                .write()
                .map_err(|_| anyhow::anyhow!("probe_policy lock poisoned"))? = policy;
            commerce.db.admin_audit(
                actor,
                "probe_policy.set",
                "gateway",
                &json!({"probe_policy": policy}),
            )?;
            Ok(json!({"probe_policy": policy}))
        }
        "/probe" => {
            let session = string("session_id")?;
            let peer = commerce
                .peers
                .lock()
                .map_err(|_| anyhow::anyhow!("peer registry lock poisoned"))?
                .get(session)
                .cloned()
                .context("Session has no active MCP client")?;
            let result = crate::fingerprint::active::run(commerce, session, peer, false).await?;
            commerce
                .db
                .admin_audit(actor, "probe.run", session, &result)?;
            Ok(result)
        }
        "/offers/synthesize" => bundler::synthesize(
            &commerce.db,
            commerce.clef.status(),
            string("session_id")?,
            actor,
        ),
        "/inspector/connect" => commerce.inspector.connect(commerce, &body, actor).await,
        "/inspector/disconnect" => {
            commerce
                .inspector
                .disconnect(string("connection_id")?)
                .await
        }
        "/inspector/request" => commerce.inspector.request(&body).await,
        "/inspector/notify" => commerce.inspector.notify(&body).await,
        "/inspector/roots" => commerce.inspector.set_roots(&body).await,
        "/inspector/listen" => commerce.inspector.listen(&body).await,
        "/inspector/answer" => commerce.inspector.answer(&body),
        "/onboarding/configure-agent" => crate::onboarding::configure_agent(commerce, &body, actor),
        "/onboarding/run-sortie" => crate::onboarding::run_sortie(commerce, &body, actor).await,
        "/interception/run-scenario" => {
            commerce
                .interception
                .run_scenario(commerce, &body, actor)
                .await
        }
        "/interception/draft" => commerce.interception.update_draft(commerce, &body, actor),
        "/interception/validate" => commerce.interception.validate_draft(commerce, &body, actor),
        "/interception/release" => {
            commerce
                .interception
                .release_intercept(commerce, &body, actor)
                .await
        }
        "/interception/authorize-payment" => {
            commerce
                .interception
                .authorize_payment(commerce, &body, actor)
                .await
        }
        _ => anyhow::bail!("Unknown admin action"),
    }
}
