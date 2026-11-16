use super::{
    Commerce,
    bundler::{self, Bundle},
    db::{Database, now, now_ms},
    receipt::{CapabilityReceipt, SignedReceipt},
};
use anyhow::{Context, Result, anyhow, bail, ensure};
use bytes::Bytes;
use http::{Method, StatusCode, header::CONTENT_TYPE};
use http_body_util::{BodyExt, Full, Limited, combinators::BoxBody};
use hyper::{Request, Response, body::Incoming, service::service_fn};
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tokio_graceful::Shutdown;

pub const DEFAULT_SCENARIO_TX_ID: &str = "audioshop";
pub const DEFAULT_BUYER_AGENT: &str = "agent-7f2";
pub const DEFAULT_SELLER_HOST: &str = "audioshop.com";
pub const DEFAULT_PAYMENT_BUNDLE_ID: &str = "conduit_session_evidence";
pub const AUDIOSHOP_FLOOR_CENTS: i64 = 19_900;
pub const AUDIOSHOP_CEILING_CENTS: i64 = 22_900;
pub const AUDIOSHOP_PROMO_CENTS: i64 = 20_900;

struct ReleaseDecision {
    delivered_payload: Value,
    done_tx: oneshot::Sender<Result<()>>,
}

struct PaymentDecision {
    signed_receipt: SignedReceipt,
    done_tx: oneshot::Sender<Result<()>>,
}

struct HeldIntercept {
    tx: oneshot::Sender<ReleaseDecision>,
    held_since: Instant,
}

struct SellerUpstream {
    addr: SocketAddr,
    stop_tx: Option<oneshot::Sender<()>>,
    join_handle: Option<JoinHandle<()>>,
}

impl SellerUpstream {
    async fn start() -> Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .context("Failed to bind ephemeral seller HTTP/MCP listener")?;
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
                                .serve_connection(TokioIo::new(tcp), service_fn(handle_seller_request))
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

impl Drop for SellerUpstream {
    fn drop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

fn json_http_response(
    status: StatusCode,
    value: &Value,
) -> Response<BoxBody<Bytes, anyhow::Error>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(
            Full::new(Bytes::from(value.to_string()))
                .map_err(|never| match never {})
                .boxed(),
        )
        .expect("valid ephemeral seller HTTP response")
}

async fn handle_seller_request(
    req: Request<Incoming>,
) -> Result<Response<BoxBody<Bytes, anyhow::Error>>> {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let seller_host = req
        .headers()
        .get("x-seller-host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_SELLER_HOST)
        .to_owned();
    let buyer_agent = req
        .headers()
        .get("x-buyer-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BUYER_AGENT)
        .to_owned();

    let body_bytes = Limited::new(req.into_body(), 128 * 1024)
        .collect()
        .await
        .map_err(|e| anyhow!("{e}"))?
        .to_bytes();

    if method == Method::POST && path == "/v1/credits/orders" {
        let req_json: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|_| json!({}));
        let amount_cents = req_json["amount_cents"].as_i64().unwrap_or(10_000);
        return Ok(json_http_response(
            StatusCode::OK,
            &json!({
                "order_id": "ord_cloudstore_2d4",
                "seller": seller_host,
                "buyer": buyer_agent,
                "sku_title": "GPU Compute Credits (100 hrs)",
                "amount_cents": amount_cents,
                "currency": "USD",
                "status": "fulfilled"
            }),
        ));
    }

    if method != Method::POST || !path.starts_with("/mcp") {
        return Ok(json_http_response(
            StatusCode::NOT_FOUND,
            &json!({"error": "not_found", "path": path}),
        ));
    }

    let payload: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|_| json!({}));
    let req_id = payload
        .get("id")
        .cloned()
        .unwrap_or_else(|| Value::String("req-1".to_owned()));
    let tool_name = payload
        .pointer("/params/name")
        .and_then(Value::as_str)
        .or_else(|| payload.get("method").and_then(Value::as_str))
        .unwrap_or("");
    let args = payload
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| payload.get("params").cloned().unwrap_or_else(|| json!({})));

    match tool_name {
        "discover_products" => {
            if seller_host == "displayco.hardware" {
                Ok(json_http_response(
                    StatusCode::OK,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "protocolVersion": "2026-07-28",
                        "result": {
                            "seller": seller_host,
                            "total_matches": 6,
                            "featured": {
                                "sku": "DSP-27-4K",
                                "sku_title": "Studio Reference 27\" 4K",
                                "price_cents": 32_900,
                                "currency": "USD",
                                "in_stock": true
                            }
                        }
                    }),
                ))
            } else {
                Ok(json_http_response(
                    StatusCode::OK,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "protocolVersion": "2026-07-28",
                        "result": {
                            "seller": seller_host,
                            "category": args.get("category").and_then(Value::as_str).unwrap_or("wireless_headphones"),
                            "total_matches": 12,
                            "products": [
                                {
                                    "sku": "SWX-BLK-01",
                                    "sku_title": "Studio Wireless X",
                                    "msrp_cents": 22_900,
                                    "currency": "USD",
                                    "in_stock": true
                                },
                                {
                                    "sku": "SWP-SLV-02",
                                    "sku_title": "Studio Monitor Pro",
                                    "msrp_cents": 27_900,
                                    "currency": "USD",
                                    "in_stock": true
                                }
                            ]
                        }
                    }),
                ))
            }
        }
        "discover_flights" => Ok(json_http_response(
            StatusCode::OK,
            &json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "protocolVersion": "2026-07-28",
                "result": {
                    "seller": seller_host,
                    "route": "SFO -> JFK",
                    "total_matches": 8,
                    "lowest_fare_cents": 43_800,
                    "currency": "USD"
                }
            }),
        )),
        "get_offers" => {
            if seller_host == "skyport.aero" {
                Ok(json_http_response(
                    StatusCode::OK,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "method": "return_offers",
                        "protocolVersion": "2026-07-28",
                        "direction": "seller_to_buyer",
                        "source": seller_host,
                        "recipient": buyer_agent,
                        "offers": [
                            {
                                "offer_id": "O01",
                                "label": "Fare A",
                                "sku_title": "SFO -> JFK Nonstop Economy Flex",
                                "price_cents": 43_800,
                                "currency": "USD",
                                "in_stock": true,
                                "warranty": "Trip delay protection",
                                "returns_policy": "24-hour free cancellation"
                            },
                            {
                                "offer_id": "O02",
                                "label": "Fare B",
                                "sku_title": "SFO -> JFK Main Cabin Refundable",
                                "price_cents": 51_200,
                                "currency": "USD",
                                "in_stock": true,
                                "warranty": "Full travel protection",
                                "returns_policy": "Fully refundable prior to departure"
                            }
                        ]
                    }),
                ))
            } else {
                Ok(json_http_response(
                    StatusCode::OK,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "method": "return_offers",
                        "protocolVersion": "2026-07-28",
                        "direction": "seller_to_buyer",
                        "source": seller_host,
                        "recipient": buyer_agent,
                        "offers": [
                            {
                                "offer_id": "O01",
                                "label": "Offer A",
                                "sku_title": "Studio Wireless X",
                                "price_cents": 21_900,
                                "currency": "USD",
                                "in_stock": true,
                                "warranty": "2-year manufacturer",
                                "returns_policy": "30-day free returns"
                            },
                            {
                                "offer_id": "O02",
                                "label": "Offer B",
                                "sku_title": "Studio Wireless X",
                                "price_cents": 22_900,
                                "currency": "USD",
                                "in_stock": true,
                                "warranty": "3-year extended",
                                "returns_policy": "60-day free returns"
                            }
                        ]
                    }),
                ))
            }
        }
        "select_product" => {
            let offer_id = args["offer_id"].as_str().unwrap_or("O01");
            let price_cents = args["price_cents"].as_i64().unwrap_or(21_900);
            let sku_title = args["sku_title"].as_str().unwrap_or("Studio Wireless X");
            if seller_host == DEFAULT_SELLER_HOST && price_cents < AUDIOSHOP_FLOOR_CENTS {
                return Ok(json_http_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32001,
                            "message": format!("Offer price_cents {price_cents} violates seller floor {AUDIOSHOP_FLOOR_CENTS}")
                        }
                    }),
                ));
            }
            Ok(json_http_response(
                StatusCode::OK,
                &json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "protocolVersion": "2026-07-28",
                    "result": {
                        "selected": true,
                        "cart_id": "cart_audioshop_7f2",
                        "offer_id": offer_id,
                        "sku_title": sku_title,
                        "price_cents": price_cents,
                        "currency": "USD"
                    }
                }),
            ))
        }
        "create_checkout_session" => {
            let offer_id = args["offer_id"].as_str().unwrap_or("O01");
            let price_cents = args["price_cents"].as_i64().unwrap_or(21_900);
            let sku_title = args["sku_title"].as_str().unwrap_or("Studio Wireless X");
            Ok(json_http_response(
                StatusCode::OK,
                &json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "protocolVersion": "2026-07-28",
                    "result": {
                        "checkout_session_id": "chk_audioshop_7f2",
                        "offer_id": offer_id,
                        "sku_title": sku_title,
                        "amount_cents": price_cents,
                        "currency": "USD",
                        "payment_status": "requires_capability_receipt"
                    }
                }),
            ))
        }
        "complete_checkout_session" => {
            let receipt_id = args["receipt_id"].as_str().unwrap_or("");
            let receipt_token = args["receipt_token"].as_str().unwrap_or("");
            if receipt_id.is_empty() && receipt_token.is_empty() {
                return Ok(json_http_response(
                    StatusCode::PAYMENT_REQUIRED,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32002,
                            "message": "Missing verified Ed25519 capability receipt"
                        }
                    }),
                ));
            }
            let price_cents = args["amount_cents"].as_i64().unwrap_or(20_900);
            let offer_id = args["offer_id"].as_str().unwrap_or("O03");
            Ok(json_http_response(
                StatusCode::OK,
                &json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "protocolVersion": "2026-07-28",
                    "result": {
                        "order_id": "ord_audioshop_7f2",
                        "checkout_session_id": "chk_audioshop_7f2",
                        "offer_id": offer_id,
                        "amount_charged_cents": price_cents,
                        "currency": "USD",
                        "receipt_id": receipt_id,
                        "fulfillment_status": "complete"
                    }
                }),
            ))
        }
        other => Ok(json_http_response(
            StatusCode::BAD_REQUEST,
            &json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": format!("Unsupported seller method '{other}'")
                }
            }),
        )),
    }
}

pub fn fmt_usd(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.unsigned_abs();
    format!("{sign}${}.{:02}", abs / 100, abs % 100)
}

pub fn fmt_usd_whole_or_cents(cents: i64) -> String {
    if cents % 100 == 0 {
        format!("${}", cents / 100)
    } else {
        fmt_usd(cents)
    }
}

pub fn validate_mcp_offers_schema(payload: &Value) -> (String, String) {
    let Some(obj) = payload.as_object() else {
        return (
            "invalid".to_owned(),
            "Payload root must be a JSON object".to_owned(),
        );
    };
    if let Some(jsonrpc) = obj.get("jsonrpc")
        && jsonrpc.as_str() != Some("2.0")
    {
        return (
            "invalid".to_owned(),
            "JSON-RPC envelope field 'jsonrpc' must equal '2.0'".to_owned(),
        );
    }
    if let Some(method) = obj.get("method")
        && method.as_str().is_none_or(|m| m.trim().is_empty())
    {
        return (
            "invalid".to_owned(),
            "MCP envelope field 'method' must be a non-empty string".to_owned(),
        );
    }

    let offers_val = obj
        .get("offers")
        .or_else(|| payload.pointer("/result/offers"))
        .or_else(|| payload.pointer("/params/offers"));
    let Some(offers) = offers_val.and_then(Value::as_array) else {
        return (
            "invalid".to_owned(),
            "Missing non-empty 'offers' array in return_offers payload".to_owned(),
        );
    };
    if offers.is_empty() {
        return (
            "invalid".to_owned(),
            "return_offers 'offers' array must contain at least one offer".to_owned(),
        );
    }

    let mut seen_ids = HashSet::with_capacity(offers.len());
    for (idx, item) in offers.iter().enumerate() {
        let Some(offer) = item.as_object() else {
            return (
                "invalid".to_owned(),
                format!("offers[{idx}] must be a JSON object"),
            );
        };
        let Some(offer_id) = offer
            .get("offer_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            return (
                "invalid".to_owned(),
                format!("offers[{idx}].offer_id must be a non-empty string"),
            );
        };
        if !seen_ids.insert(offer_id.to_owned()) {
            return (
                "invalid".to_owned(),
                format!("Duplicate offer_id '{offer_id}' in offers array"),
            );
        }
        if offer
            .get("sku_title")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_none_or(str::is_empty)
        {
            return (
                "invalid".to_owned(),
                format!("offers[{idx}].sku_title must be a non-empty string"),
            );
        }
        if offer
            .get("currency")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_none_or(str::is_empty)
        {
            return (
                "invalid".to_owned(),
                format!("offers[{idx}].currency must be a non-empty ISO currency code"),
            );
        }
        if offer
            .get("price_cents")
            .and_then(Value::as_i64)
            .is_none_or(|p| p <= 0)
        {
            return (
                "invalid".to_owned(),
                format!("offers[{idx}].price_cents must be a positive integer"),
            );
        }
    }

    (
        "valid".to_owned(),
        "Conforms to MCP 2026-07-28 return_offers schema".to_owned(),
    )
}

pub fn validate_seller_policy(
    draft_price_cents: i64,
    floor_cents: i64,
    max_cents: i64,
) -> (String, String) {
    if draft_price_cents < floor_cents {
        return (
            "rejected".to_owned(),
            format!(
                "Proposed offer {} is below seller floor ({})",
                fmt_usd(draft_price_cents),
                fmt_usd(floor_cents)
            ),
        );
    }
    if draft_price_cents > max_cents {
        return (
            "rejected".to_owned(),
            format!(
                "Proposed offer {} exceeds seller ceiling ({})",
                fmt_usd(draft_price_cents),
                fmt_usd(max_cents)
            ),
        );
    }
    (
        "valid".to_owned(),
        format!(
            "Verified {} within seller floor ({}) and ceiling ({})",
            fmt_usd(draft_price_cents),
            fmt_usd(floor_cents),
            fmt_usd(max_cents)
        ),
    )
}

pub fn check_payment_authorization(commerce: &Commerce, buyer_agent: &str) -> String {
    let Ok(rows) = commerce
        .db
        .rows_where("capability_receipts", "subject", buyer_agent)
    else {
        return "unverified".to_owned();
    };
    let current_unix = now();
    for row in rows {
        if row["revoked"].as_i64() != Some(0) {
            continue;
        }
        if !row["remaining_calls"].as_i64().is_some_and(|rem| rem > 0) {
            continue;
        }
        if !row["expires_at_unix"]
            .as_i64()
            .is_some_and(|exp| exp > current_unix)
        {
            continue;
        }
        let Ok(receipt) = serde_json::from_value::<CapabilityReceipt>(row["payload"].clone())
        else {
            continue;
        };
        if receipt.subject != buyer_agent {
            continue;
        }
        let Some(sig) = row["signature"].as_str() else {
            continue;
        };
        let bundle_id = receipt.bundle_id.clone();
        let signed = SignedReceipt {
            receipt,
            signature: sig.to_owned(),
        };
        if commerce.receipts.verify_signature(&signed).is_ok()
            && commerce
                .receipts
                .verify(&signed, buyer_agent, &bundle_id)
                .is_ok()
        {
            return "authorized".to_owned();
        }
    }
    "unverified".to_owned()
}

pub struct InterceptionEngine {
    active_intercepting: AtomicBool,
    held: Mutex<HashMap<(String, String), HeldIntercept>>,
    payment_waiters: Mutex<HashMap<String, PaymentWaiter>>,
    sellers: Mutex<HashMap<String, SellerUpstream>>,
}

struct PaymentWaiter {
    tx: oneshot::Sender<PaymentDecision>,
}

impl Default for InterceptionEngine {
    fn default() -> Self {
        Self {
            active_intercepting: AtomicBool::new(true),
            held: Mutex::new(HashMap::new()),
            payment_waiters: Mutex::new(HashMap::new()),
            sellers: Mutex::new(HashMap::new()),
        }
    }
}

impl InterceptionEngine {
    pub fn reset_stale(db: &Database) -> Result<()> {
        let conn = db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let ts = now_ms();
        conn.execute(
            "UPDATE interception_events
             SET epistemic_kind='observed', hold_state='none', status_label='INTERRUPTED'
             WHERE hold_state='held'",
            [],
        )?;
        conn.execute(
            "UPDATE commerce_transactions
             SET status='error', status_detail='Gateway restarted while offer was held', sub_status='Interrupted', updated_at_ms=?1
             WHERE status='held'",
            params![ts],
        )?;
        Ok(())
    }

    pub fn state(&self, commerce: &Commerce) -> Result<Value> {
        let held_elapsed: HashMap<(String, String), i64> = {
            let guard = self
                .held
                .lock()
                .map_err(|_| anyhow!("interception held lock poisoned"))?;
            guard
                .iter()
                .map(|(k, v)| (k.clone(), v.held_since.elapsed().as_millis() as i64))
                .collect()
        };

        let (tx_rows, tx_buyers, event_rows, offer_rows, raw_drafts) = {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;

            let mut tx_stmt = conn.prepare(
                "SELECT tx_id, title, short_title, category_label, buyer_agent, seller_host,
                        protocol, phase, status, status_detail, sub_status, created_at_ms, updated_at_ms
                 FROM commerce_transactions
                 ORDER BY CASE tx_id
                     WHEN 'audioshop' THEN 0
                     WHEN 'skyport' THEN 1
                     WHEN 'displayco' THEN 2
                     WHEN 'cloudstore' THEN 3
                     ELSE 4
                 END, created_at_ms ASC",
            )?;
            let mut tx_buyers = HashMap::new();
            let tx_rows = tx_stmt
                .query_map([], |r| {
                    let tx_id: String = r.get(0)?;
                    let buyer_agent: String = r.get(4)?;
                    Ok((
                        tx_id.clone(),
                        buyer_agent.clone(),
                        json!({
                            "tx_id": tx_id,
                            "title": r.get::<_, String>(1)?,
                            "short_title": r.get::<_, String>(2)?,
                            "category_label": r.get::<_, String>(3)?,
                            "buyer_agent": buyer_agent,
                            "seller_host": r.get::<_, String>(5)?,
                            "protocol": r.get::<_, String>(6)?,
                            "phase": r.get::<_, String>(7)?,
                            "status": r.get::<_, String>(8)?,
                            "status_detail": r.get::<_, String>(9)?,
                            "sub_status": r.get::<_, String>(10)?,
                            "created_at_ms": r.get::<_, i64>(11)?,
                            "updated_at_ms": r.get::<_, i64>(12)?,
                        }),
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut transactions = Vec::with_capacity(tx_rows.len());
            for (tx_id, buyer, val) in tx_rows {
                tx_buyers.insert(tx_id, buyer);
                transactions.push(val);
            }

            let current_ms = now_ms();
            let mut ev_stmt = conn.prepare(
                "SELECT event_id, tx_id, seq, timestamp_ms, actor, direction, protocol,
                        event_name, epistemic_kind, hold_state, status_code, status_label,
                        correlation_id, latency_ms, observation, payload
                 FROM interception_events
                 ORDER BY CASE tx_id
                     WHEN 'audioshop' THEN 0
                     WHEN 'skyport' THEN 1
                     WHEN 'displayco' THEN 2
                     WHEN 'cloudstore' THEN 3
                     ELSE 4
                 END, seq ASC, timestamp_ms ASC",
            )?;
            let event_rows = ev_stmt
                .query_map([], |r| {
                    let event_id: String = r.get(0)?;
                    let tx_id: String = r.get(1)?;
                    let timestamp_ms: i64 = r.get(3)?;
                    let hold_state: String = r.get(9)?;
                    let payload_raw: String = r.get(15)?;
                    let payload =
                        serde_json::from_str::<Value>(&payload_raw).unwrap_or_else(|_| json!({}));
                    let hold_ms = if hold_state == "held" {
                        Some(
                            held_elapsed
                                .get(&(tx_id.clone(), event_id.clone()))
                                .copied()
                                .unwrap_or_else(|| (current_ms - timestamp_ms).max(0)),
                        )
                    } else {
                        None
                    };
                    Ok(json!({
                        "event_id": event_id,
                        "tx_id": tx_id,
                        "seq": r.get::<_, i64>(2)?,
                        "timestamp_ms": timestamp_ms,
                        "actor": r.get::<_, String>(4)?,
                        "direction": r.get::<_, String>(5)?,
                        "protocol": r.get::<_, String>(6)?,
                        "event_name": r.get::<_, String>(7)?,
                        "epistemic_kind": r.get::<_, String>(8)?,
                        "hold_state": hold_state,
                        "status_code": r.get::<_, Option<i64>>(10)?,
                        "status_label": r.get::<_, String>(11)?,
                        "correlation_id": r.get::<_, String>(12)?,
                        "latency_ms": r.get::<_, Option<i64>>(13)?,
                        "hold_ms": hold_ms,
                        "observation": r.get::<_, String>(14)?,
                        "payload": payload,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut off_stmt = conn.prepare(
                "SELECT offer_id, tx_id, parent_event_id, label, sku_title, price_cents,
                        currency, in_stock, warranty, returns_policy, is_draft, committed
                 FROM commercial_offers
                 ORDER BY CASE tx_id
                     WHEN 'audioshop' THEN 0
                     WHEN 'skyport' THEN 1
                     WHEN 'displayco' THEN 2
                     WHEN 'cloudstore' THEN 3
                     ELSE 4
                 END, offer_id ASC",
            )?;
            let offer_rows = off_stmt
                .query_map([], |r| {
                    Ok(json!({
                        "offer_id": r.get::<_, String>(0)?,
                        "tx_id": r.get::<_, String>(1)?,
                        "parent_event_id": r.get::<_, String>(2)?,
                        "label": r.get::<_, String>(3)?,
                        "sku_title": r.get::<_, String>(4)?,
                        "price_cents": r.get::<_, i64>(5)?,
                        "currency": r.get::<_, String>(6)?,
                        "in_stock": r.get::<_, i64>(7)? != 0,
                        "warranty": r.get::<_, String>(8)?,
                        "returns_policy": r.get::<_, String>(9)?,
                        "is_draft": r.get::<_, i64>(10)? != 0,
                        "committed": r.get::<_, i64>(11)? != 0,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut dr_stmt = conn.prepare(
                "SELECT draft_id, tx_id, target_event_id, lane, enabled, promo_offer_id,
                        summary, result_preview, delivery_state, proposed_payload,
                        mcp_schema, mcp_schema_detail, seller_policy, seller_policy_detail,
                        operator_approval, payment_auth, seller_floor_cents, updated_at_ms
                 FROM interception_drafts
                 ORDER BY draft_id ASC",
            )?;
            let raw_drafts = dr_stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get::<_, String>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                        r.get::<_, String>(10)?,
                        r.get::<_, String>(11)?,
                        r.get::<_, String>(12)?,
                        r.get::<_, String>(13)?,
                        r.get::<_, String>(14)?,
                        r.get::<_, String>(15)?,
                        r.get::<_, i64>(16)?,
                        r.get::<_, i64>(17)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            (transactions, tx_buyers, event_rows, offer_rows, raw_drafts)
        };

        let mut auth_cache: HashMap<String, String> = HashMap::new();
        for buyer in tx_buyers.values() {
            if !auth_cache.contains_key(buyer) {
                auth_cache.insert(
                    buyer.clone(),
                    check_payment_authorization(commerce, buyer),
                );
            }
        }

        let mut drafts = Vec::with_capacity(raw_drafts.len());
        for (
            draft_id,
            tx_id,
            target_event_id,
            lane,
            enabled,
            promo_offer_id,
            summary,
            result_preview,
            delivery_state,
            proposed_raw,
            mcp_schema,
            mcp_schema_detail,
            seller_policy,
            seller_policy_detail,
            operator_approval,
            persisted_payment_auth,
            seller_floor_cents,
            updated_at_ms,
        ) in raw_drafts
        {
            let live_payment_auth = tx_buyers
                .get(&tx_id)
                .and_then(|b| auth_cache.get(b))
                .cloned()
                .unwrap_or(persisted_payment_auth);
            let proposed_payload =
                serde_json::from_str::<Value>(&proposed_raw).unwrap_or_else(|_| json!({}));
            drafts.push(json!({
                "draft_id": draft_id,
                "tx_id": tx_id,
                "target_event_id": target_event_id,
                "lane": lane,
                "enabled": enabled,
                "promo_offer_id": promo_offer_id,
                "summary": summary,
                "result_preview": result_preview,
                "delivery_state": delivery_state,
                "proposed_payload": proposed_payload,
                "seller_floor_cents": seller_floor_cents,
                "updated_at_ms": updated_at_ms,
                "validation": {
                    "mcp_schema": mcp_schema,
                    "mcp_schema_detail": mcp_schema_detail,
                    "seller_policy": seller_policy,
                    "seller_policy_detail": seller_policy_detail,
                    "operator_approval": operator_approval,
                    "payment_auth": live_payment_auth,
                }
            }));
        }

        let held_count = event_rows
            .iter()
            .filter(|ev| ev["hold_state"] == "held")
            .count();

        Ok(json!({
            "active_intercepting": self.active_intercepting.load(Ordering::Relaxed),
            "held_count": held_count,
            "transactions": tx_rows,
            "events": event_rows,
            "offers": offer_rows,
            "drafts": drafts,
        }))
    }

    pub async fn run_scenario(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let preset = body
            .get("preset")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_SCENARIO_TX_ID);
        ensure!(
            preset == DEFAULT_SCENARIO_TX_ID,
            "Unsupported interception scenario preset '{preset}'"
        );
        let include_peers = body
            .get("include_peers")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        self.abort_in_flight_for_tx(DEFAULT_SCENARIO_TX_ID).await;

        // If re-running after a previously completed AudioShop order, revoke old receipts for agent-7f2
        // so the replayed run starts honestly in `unverified` payment authorization state.
        let prior_status: Option<String> = {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            conn.query_row(
                "SELECT status FROM commerce_transactions WHERE tx_id=?1",
                [DEFAULT_SCENARIO_TX_ID],
                |r| r.get(0),
            )
            .optional()?
        };
        if prior_status.as_deref() == Some("complete")
            && let Ok(rows) =
                commerce
                    .db
                    .rows_where("capability_receipts", "subject", DEFAULT_BUYER_AGENT)
        {
            for row in rows {
                if row["revoked"].as_i64() == Some(0)
                    && let Some(receipt_id) = row["receipt_id"].as_str()
                {
                    let _ = commerce.receipts.revoke(receipt_id, actor);
                }
            }
        }

        let seller = SellerUpstream::start().await?;
        let seller_addr = seller.addr;
        self.sellers
            .lock()
            .map_err(|_| anyhow!("interception sellers lock poisoned"))?
            .insert(DEFAULT_SCENARIO_TX_ID.to_owned(), seller);

        // Initialize AudioShop transaction + pending future expectation nodes (C03, C04, C05)
        {
            let mut conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            clear_tx_rows(&tx, DEFAULT_SCENARIO_TX_ID)?;
            ensure_agent_session(&tx, DEFAULT_BUYER_AGENT, "Buyer Agent (AudioShop)")?;

            let ts = now_ms();
            tx.execute(
                "INSERT INTO commerce_transactions(
                    tx_id, title, short_title, category_label, buyer_agent, seller_host,
                    protocol, phase, status, status_detail, sub_status, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'MCP', 'discover', 'live', 'Discovering seller catalog', 'Discover (live)', ?7, ?7)",
                params![
                    DEFAULT_SCENARIO_TX_ID,
                    "AudioShop — Headphone Purchase",
                    "AudioShop",
                    "Audio · $219",
                    DEFAULT_BUYER_AGENT,
                    DEFAULT_SELLER_HOST,
                    ts,
                ],
            )?;

            for (seq, event_id, event_name, corr, obs) in [
                (
                    4_i64,
                    "C03",
                    "select_product",
                    "corr-7f2-03",
                    "Awaiting offer delivery",
                ),
                (
                    5_i64,
                    "C04",
                    "create_checkout_session",
                    "corr-7f2-04",
                    "Awaiting product selection",
                ),
                (
                    6_i64,
                    "C05",
                    "complete_checkout_session",
                    "corr-7f2-05",
                    "Awaiting session payment pass",
                ),
            ] {
                tx.execute(
                    "INSERT INTO interception_events(
                        event_id, tx_id, seq, timestamp_ms, actor, direction, protocol,
                        event_name, epistemic_kind, hold_state, status_code, status_label,
                        correlation_id, latency_ms, observation, payload
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'buyer_to_seller', 'MCP', ?6, 'pending', 'none', NULL, 'PENDING', ?7, NULL, ?8, ?9)",
                    params![
                        event_id,
                        DEFAULT_SCENARIO_TX_ID,
                        seq,
                        ts + seq,
                        DEFAULT_BUYER_AGENT,
                        event_name,
                        corr,
                        obs,
                        json!({
                            "jsonrpc": "2.0",
                            "method": event_name,
                            "protocolVersion": "2026-07-28",
                            "status": "pending"
                        })
                        .to_string(),
                    ],
                )?;
            }
            tx.commit()?;
        }

        let (held_ready_tx, held_ready_rx) = oneshot::channel::<Result<()>>();
        spawn_audioshop_buyer_task(commerce.clone(), seller_addr, held_ready_tx);

        tokio::time::timeout(Duration::from_secs(5), held_ready_rx)
            .await
            .context("Timed out waiting for AudioShop R02 offer hold gate")?
            .context("AudioShop buyer task terminated before R02 hold")??;

        if include_peers {
            run_peer_sessions(commerce).await?;
        }

        if commerce.loopback_connect_addr().is_some() {
            tokio::time::sleep(Duration::from_millis(35)).await;
        }

        commerce.db.admin_audit(
            actor,
            "interception.run_scenario",
            DEFAULT_SCENARIO_TX_ID,
            &json!({"preset": preset, "include_peers": include_peers}),
        )?;

        self.state(commerce)
    }

    pub fn update_draft(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let tx_id = body
            .get("tx_id")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_SCENARIO_TX_ID);
        let target_event_id = body
            .get("target_event_id")
            .and_then(Value::as_str)
            .unwrap_or("R02");

        let mut conn = commerce
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let (buyer_agent, seller_host): (String, String) = tx
            .query_row(
                "SELECT buyer_agent, seller_host FROM commerce_transactions WHERE tx_id=?1",
                [tx_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .with_context(|| format!("Unknown commerce transaction '{tx_id}'"))?;

        let (draft_id, cur_lane, cur_enabled, promo_offer_id, cur_policy, cur_policy_detail): (
            String,
            String,
            i64,
            String,
            String,
            String,
        ) = tx
            .query_row(
                "SELECT draft_id, lane, enabled, promo_offer_id, seller_policy, seller_policy_detail
                 FROM interception_drafts
                 WHERE tx_id=?1 AND target_event_id=?2",
                params![tx_id, target_event_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .with_context(|| {
                format!("No interception draft found for ({tx_id}, {target_event_id})")
            })?;

        let next_lane = if let Some(lane) = body.get("lane").and_then(Value::as_str) {
            ensure!(
                lane == "buyer_to_seller" || lane == "seller_to_buyer",
                "Invalid lane '{lane}' (expected 'buyer_to_seller' or 'seller_to_buyer')"
            );
            lane.to_owned()
        } else {
            cur_lane
        };

        let next_enabled = body
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(cur_enabled != 0);

        let cur_promo_cents: i64 = tx.query_row(
            "SELECT price_cents FROM commercial_offers WHERE tx_id=?1 AND offer_id=?2",
            params![tx_id, promo_offer_id],
            |r| r.get(0),
        )?;

        let next_promo_cents = body
            .get("promo_price_cents")
            .and_then(Value::as_i64)
            .unwrap_or(cur_promo_cents);
        ensure!(
            next_promo_cents > 0,
            "promo_price_cents must be positive (got {next_promo_cents})"
        );

        let price_changed = next_promo_cents != cur_promo_cents;
        if price_changed {
            tx.execute(
                "UPDATE commercial_offers SET price_cents=?1 WHERE tx_id=?2 AND offer_id=?3",
                params![next_promo_cents, tx_id, promo_offer_id],
            )?;
        }

        let proposed_payload = build_proposed_offers_payload(
            &tx,
            tx_id,
            &next_lane,
            &buyer_agent,
            &seller_host,
            next_enabled,
        )?;
        let (mcp_schema, mcp_schema_detail) = validate_mcp_offers_schema(&proposed_payload);

        let (seller_policy, seller_policy_detail) = if price_changed {
            (
                "pending_validation".to_owned(),
                "Offer price updated — awaiting seller floor validation".to_owned(),
            )
        } else {
            (cur_policy, cur_policy_detail)
        };

        let (summary, result_preview) = build_draft_copy(
            &next_lane,
            next_enabled,
            &promo_offer_id,
            next_promo_cents,
            &buyer_agent,
            &seller_host,
        );
        let ts = now_ms();

        tx.execute(
            "UPDATE interception_drafts
             SET lane=?1, enabled=?2, summary=?3, result_preview=?4, proposed_payload=?5,
                 mcp_schema=?6, mcp_schema_detail=?7, seller_policy=?8, seller_policy_detail=?9,
                 updated_at_ms=?10
             WHERE draft_id=?11",
            params![
                next_lane,
                i64::from(next_enabled),
                summary,
                result_preview,
                proposed_payload.to_string(),
                mcp_schema,
                mcp_schema_detail,
                seller_policy,
                seller_policy_detail,
                ts,
                draft_id,
            ],
        )?;

        super::receipt::audit(
            &tx,
            actor,
            "interception.draft.update",
            &draft_id,
            &json!({
                "tx_id": tx_id,
                "target_event_id": target_event_id,
                "lane": next_lane,
                "enabled": next_enabled,
                "promo_price_cents": next_promo_cents,
            }),
        )?;
        tx.commit()?;
        drop(conn);

        self.state(commerce)
    }

    pub fn validate_draft(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let tx_id = body
            .get("tx_id")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_SCENARIO_TX_ID);
        let target_event_id = body
            .get("target_event_id")
            .and_then(Value::as_str)
            .unwrap_or("R02");

        let buyer_agent: String = {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            conn.query_row(
                "SELECT buyer_agent FROM commerce_transactions WHERE tx_id=?1",
                [tx_id],
                |r| r.get(0),
            )
            .with_context(|| format!("Unknown commerce transaction '{tx_id}'"))?
        };
        let payment_auth = check_payment_authorization(commerce, &buyer_agent);

        let mut conn = commerce
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let (draft_id, promo_offer_id, proposed_raw, floor_cents): (String, String, String, i64) =
            tx.query_row(
                "SELECT draft_id, promo_offer_id, proposed_payload, seller_floor_cents
                 FROM interception_drafts
                 WHERE tx_id=?1 AND target_event_id=?2",
                params![tx_id, target_event_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .with_context(|| {
                format!("No interception draft found for ({tx_id}, {target_event_id})")
            })?;

        let draft_price_cents: i64 = tx.query_row(
            "SELECT price_cents FROM commercial_offers WHERE tx_id=?1 AND offer_id=?2",
            params![tx_id, promo_offer_id],
            |r| r.get(0),
        )?;
        let max_cents: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(price_cents), ?1) FROM commercial_offers WHERE tx_id=?2 AND is_draft=0",
                params![AUDIOSHOP_CEILING_CENTS, tx_id],
                |r| r.get(0),
            )?;

        let proposed_payload: Value = serde_json::from_str(&proposed_raw)?;
        let (mcp_schema, mcp_schema_detail) = validate_mcp_offers_schema(&proposed_payload);
        let (seller_policy, seller_policy_detail) =
            validate_seller_policy(draft_price_cents, floor_cents, max_cents);

        let ts = now_ms();
        tx.execute(
            "UPDATE interception_drafts
             SET mcp_schema=?1, mcp_schema_detail=?2, seller_policy=?3, seller_policy_detail=?4,
                 payment_auth=?5, updated_at_ms=?6
             WHERE draft_id=?7",
            params![
                mcp_schema,
                mcp_schema_detail,
                seller_policy,
                seller_policy_detail,
                payment_auth,
                ts,
                draft_id,
            ],
        )?;

        super::receipt::audit(
            &tx,
            actor,
            "interception.draft.validate",
            &draft_id,
            &json!({
                "tx_id": tx_id,
                "mcp_schema": mcp_schema,
                "seller_policy": seller_policy,
                "draft_price_cents": draft_price_cents,
                "floor_cents": floor_cents,
                "max_cents": max_cents,
            }),
        )?;
        tx.commit()?;
        drop(conn);

        self.state(commerce)
    }

    pub async fn release_intercept(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let tx_id = body
            .get("tx_id")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_SCENARIO_TX_ID)
            .to_owned();
        let target_event_id = body
            .get("target_event_id")
            .and_then(Value::as_str)
            .unwrap_or("R02")
            .to_owned();
        let requested_mode = body.get("mode").and_then(Value::as_str);
        if let Some(m) = requested_mode {
            ensure!(
                m == "replacement" || m == "original",
                "Invalid release mode '{m}' (expected 'replacement' or 'original')"
            );
        }

        let buyer_agent: String = {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            conn.query_row(
                "SELECT buyer_agent FROM commerce_transactions WHERE tx_id=?1",
                [&tx_id],
                |r| r.get(0),
            )
            .with_context(|| format!("Unknown commerce transaction '{tx_id}'"))?
        };
        let payment_auth = check_payment_authorization(commerce, &buyer_agent);

        let elapsed_hold_ms = self
            .held
            .lock()
            .map_err(|_| anyhow!("interception held lock poisoned"))?
            .get(&(tx_id.clone(), target_event_id.clone()))
            .map(|h| (h.held_since.elapsed().as_micros().div_ceil(1000)) as i64);

        let delivered_payload = {
            let mut conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

            let (event_hold_state, original_payload_raw, event_ts): (String, String, i64) = tx
                .query_row(
                    "SELECT hold_state, payload, timestamp_ms FROM interception_events WHERE tx_id=?1 AND event_id=?2",
                    params![tx_id, target_event_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .with_context(|| format!("Unknown interception event ({tx_id}, {target_event_id})"))?;

            ensure!(
                event_hold_state == "held",
                "Event {target_event_id} in transaction '{tx_id}' is not currently held"
            );

            let (draft_id, draft_enabled, promo_offer_id, proposed_raw, floor_cents): (
                String,
                i64,
                String,
                String,
                i64,
            ) = tx.query_row(
                "SELECT draft_id, enabled, promo_offer_id, proposed_payload, seller_floor_cents
                 FROM interception_drafts
                 WHERE tx_id=?1 AND target_event_id=?2",
                params![tx_id, target_event_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?;

            let mode = requested_mode.unwrap_or(if draft_enabled != 0 {
                "replacement"
            } else {
                "original"
            });

            let ts = now_ms();
            let final_latency_ms = elapsed_hold_ms.unwrap_or_else(|| (ts - event_ts).max(1));

            let delivered: Value = if mode == "replacement" {
                let proposed: Value = serde_json::from_str(&proposed_raw)?;
                let (mcp_schema, mcp_schema_detail) = validate_mcp_offers_schema(&proposed);
                ensure!(
                    mcp_schema == "valid",
                    "Cannot release replacement payload: {mcp_schema_detail}"
                );

                let draft_price_cents: i64 = tx.query_row(
                    "SELECT price_cents FROM commercial_offers WHERE tx_id=?1 AND offer_id=?2",
                    params![tx_id, promo_offer_id],
                    |r| r.get(0),
                )?;
                let max_cents: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(price_cents), ?1) FROM commercial_offers WHERE tx_id=?2 AND is_draft=0",
                    params![AUDIOSHOP_CEILING_CENTS, tx_id],
                    |r| r.get(0),
                )?;
                let (seller_policy, seller_policy_detail) =
                    validate_seller_policy(draft_price_cents, floor_cents, max_cents);
                ensure!(
                    seller_policy == "valid",
                    "Cannot release replacement payload: {seller_policy_detail}"
                );

                tx.execute(
                    "UPDATE interception_drafts
                     SET enabled=1, delivery_state='committed',
                         mcp_schema=?1, mcp_schema_detail=?2,
                         seller_policy=?3, seller_policy_detail=?4,
                         operator_approval='approved', payment_auth=?5, updated_at_ms=?6
                     WHERE draft_id=?7",
                    params![
                        mcp_schema,
                        mcp_schema_detail,
                        seller_policy,
                        seller_policy_detail,
                        payment_auth,
                        ts,
                        draft_id,
                    ],
                )?;
                tx.execute(
                    "UPDATE commercial_offers
                     SET committed=1, is_draft=0, label='Offer C'
                     WHERE tx_id=?1 AND offer_id=?2",
                    params![tx_id, promo_offer_id],
                )?;
                tx.execute(
                    "UPDATE interception_events
                     SET epistemic_kind='observed', hold_state='replaced', status_code=200,
                         status_label='200', latency_ms=?1, observation=?2, payload=?3
                     WHERE tx_id=?4 AND event_id=?5",
                    params![
                        final_latency_ms,
                        format!(
                            "3 offers delivered ({} {} committed)",
                            promo_offer_id,
                            fmt_usd(draft_price_cents)
                        ),
                        proposed.to_string(),
                        tx_id,
                        target_event_id,
                    ],
                )?;
                tx.execute(
                    "UPDATE commerce_transactions
                     SET category_label=?1, updated_at_ms=?2
                     WHERE tx_id=?3",
                    params![
                        format!("Audio · {}", fmt_usd_whole_or_cents(draft_price_cents)),
                        ts,
                        tx_id
                    ],
                )?;
                proposed
            } else {
                let original: Value = serde_json::from_str(&original_payload_raw)?;
                tx.execute(
                    "UPDATE interception_drafts
                     SET enabled=0, delivery_state='discarded',
                         operator_approval='approved', payment_auth=?1, updated_at_ms=?2
                     WHERE draft_id=?3",
                    params![payment_auth, ts, draft_id],
                )?;
                tx.execute(
                    "UPDATE commercial_offers
                     SET committed=0, is_draft=1
                     WHERE tx_id=?1 AND offer_id=?2",
                    params![tx_id, promo_offer_id],
                )?;
                tx.execute(
                    "UPDATE interception_events
                     SET epistemic_kind='observed', hold_state='forwarded', status_code=200,
                         status_label='200', latency_ms=?1,
                         observation='2 original offers forwarded ($219.00, $229.00)'
                     WHERE tx_id=?2 AND event_id=?3",
                    params![final_latency_ms, tx_id, target_event_id],
                )?;
                original
            };

            super::receipt::audit(
                &tx,
                actor,
                "interception.release",
                &tx_id,
                &json!({
                    "target_event_id": target_event_id,
                    "mode": mode,
                    "hold_ms": final_latency_ms,
                }),
            )?;
            tx.commit()?;
            delivered
        };

        let held_entry = self
            .held
            .lock()
            .map_err(|_| anyhow!("interception held lock poisoned"))?
            .remove(&(tx_id.clone(), target_event_id.clone()));

        if let Some(held) = held_entry {
            let (done_tx, done_rx) = oneshot::channel::<Result<()>>();
            if held
                .tx
                .send(ReleaseDecision {
                    delivered_payload: delivered_payload.clone(),
                    done_tx,
                })
                .is_ok()
            {
                tokio::time::timeout(Duration::from_secs(3), done_rx)
                    .await
                    .context("Timed out waiting for buyer task C03/C04 execution after release")?
                    .context("Buyer task dropped completion channel after release")??;
            } else {
                // Buyer task had exited; execute C03/C04 directly against a live ephemeral seller.
                execute_post_release_fallback(commerce, &tx_id, &delivered_payload).await?;
            }
        } else {
            execute_post_release_fallback(commerce, &tx_id, &delivered_payload).await?;
        }

        if commerce.loopback_connect_addr().is_some() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }

        self.state(commerce)
    }

    pub async fn authorize_payment(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let tx_id = body
            .get("tx_id")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_SCENARIO_TX_ID)
            .to_owned();
        let bundle_id = body
            .get("bundle_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_PAYMENT_BUNDLE_ID)
            .to_owned();

        let (buyer_agent, c04_observed, c05_observed): (String, bool, bool) = {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            let buyer: String = conn
                .query_row(
                    "SELECT buyer_agent FROM commerce_transactions WHERE tx_id=?1",
                    [&tx_id],
                    |r| r.get(0),
                )
                .with_context(|| format!("Unknown commerce transaction '{tx_id}'"))?;
            let c04_kind: Option<String> = conn
                .query_row(
                    "SELECT epistemic_kind FROM interception_events WHERE tx_id=?1 AND event_id='C04'",
                    [&tx_id],
                    |r| r.get(0),
                )
                .optional()?;
            let c05_kind: Option<String> = conn
                .query_row(
                    "SELECT epistemic_kind FROM interception_events WHERE tx_id=?1 AND event_id='C05'",
                    [&tx_id],
                    |r| r.get(0),
                )
                .optional()?;
            (
                buyer,
                c04_kind.as_deref() == Some("observed"),
                c05_kind.as_deref() == Some("observed"),
            )
        };

        commerce.register_local_tools()?;
        let existing_bundles = bundler::bundles(&commerce.db)?;
        if !existing_bundles.iter().any(|b| b.bundle_id == bundle_id) {
            bundler::put_bundle(
                &commerce.db,
                &Bundle {
                    bundle_id: bundle_id.clone(),
                    title: "Conduit Session Evidence".to_owned(),
                    items: vec!["outrider_session_evidence".to_owned()],
                    rules: json!({}),
                },
                actor,
            )?;
        }

        {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            ensure_agent_session(&conn, &buyer_agent, "Buyer Agent")?;
        }

        let expires = now() + 86_400;
        let signed = commerce
            .receipts
            .issue(&buyer_agent, &bundle_id, 10, expires, actor)?;
        commerce.receipts.verify_signature(&signed)?;

        let verified_status = check_payment_authorization(commerce, &buyer_agent);
        ensure!(
            verified_status == "authorized",
            "Ed25519 receipt verification gate did not transition to authorized"
        );

        {
            let conn = commerce
                .db
                .0
                .lock()
                .map_err(|_| anyhow!("database lock poisoned"))?;
            conn.execute(
                "UPDATE interception_drafts SET payment_auth='authorized', updated_at_ms=?1 WHERE tx_id=?2",
                params![now_ms(), tx_id],
            )?;
        }

        if c04_observed && !c05_observed {
            let waiter = self
                .payment_waiters
                .lock()
                .map_err(|_| anyhow!("interception payment_waiters lock poisoned"))?
                .remove(&tx_id);

            if let Some(w) = waiter {
                let (done_tx, done_rx) = oneshot::channel::<Result<()>>();
                if w.tx
                    .send(PaymentDecision {
                        signed_receipt: signed.clone(),
                        done_tx,
                    })
                    .is_ok()
                {
                    tokio::time::timeout(Duration::from_secs(3), done_rx)
                        .await
                        .context("Timed out waiting for buyer task C05 checkout completion")?
                        .context("Buyer task dropped C05 completion channel")??;
                } else {
                    execute_c05_fallback(commerce, &tx_id, &buyer_agent, &bundle_id, &signed)
                        .await?;
                }
            } else {
                execute_c05_fallback(commerce, &tx_id, &buyer_agent, &bundle_id, &signed).await?;
            }
        }

        if commerce.loopback_connect_addr().is_some() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }

        commerce.db.admin_audit(
            actor,
            "interception.authorize_payment",
            &tx_id,
            &json!({
                "buyer_agent": buyer_agent,
                "bundle_id": bundle_id,
                "receipt_id": signed.receipt.receipt_id,
                "signature_verified": true,
            }),
        )?;

        let mut state_val = self.state(commerce)?;
        if let Some(obj) = state_val.as_object_mut() {
            obj.insert(
                "receipt_id".to_owned(),
                Value::String(signed.receipt.receipt_id),
            );
            obj.insert("signature_verified".to_owned(), Value::Bool(true));
        }
        Ok(state_val)
    }

    async fn abort_in_flight_for_tx(&self, tx_id: &str) {
        {
            if let Ok(mut held) = self.held.lock() {
                held.retain(|(k_tx, _), _| k_tx != tx_id);
            }
        }
        {
            if let Ok(mut waiters) = self.payment_waiters.lock() {
                waiters.remove(tx_id);
            }
        }
        let existing_seller = self
            .sellers
            .lock()
            .ok()
            .and_then(|mut m| m.remove(tx_id));
        if let Some(seller) = existing_seller {
            seller.shutdown().await;
        }
    }
}

fn clear_tx_rows(conn: &rusqlite::Connection, tx_id: &str) -> Result<()> {
    conn.execute("DELETE FROM interception_drafts WHERE tx_id=?1", [tx_id])?;
    conn.execute("DELETE FROM commercial_offers WHERE tx_id=?1", [tx_id])?;
    conn.execute("DELETE FROM interception_events WHERE tx_id=?1", [tx_id])?;
    conn.execute("DELETE FROM commerce_transactions WHERE tx_id=?1", [tx_id])?;
    Ok(())
}

fn ensure_agent_session(
    conn: &rusqlite::Connection,
    agent_id: &str,
    display_name: &str,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO agent_sessions(session_id, subject, client_config, transport, state, created_at)
         VALUES (?1, ?1, ?2, 'http', 'Unprobed', ?3)",
        params![
            agent_id,
            json!({
                "clientInfo": {
                    "name": display_name,
                    "version": env!("CARGO_PKG_VERSION")
                },
                "protocolVersion": "2026-07-28"
            })
            .to_string(),
            now(),
        ],
    )?;
    Ok(())
}

fn build_buyer_http_client(commerce: &Commerce) -> Result<reqwest::Client> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder()
        .no_brotli()
        .no_deflate()
        .no_gzip()
        .timeout(Duration::from_secs(10));
    if let Some(connect_addr) = commerce.loopback_connect_addr() {
        let proxy = reqwest::Proxy::http(format!("http://{connect_addr}"))
            .context("Invalid loopback proxy address")?
            .no_proxy(None);
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .context("Failed to construct buyer loopback HTTP client")
}

async fn send_seller_mcp_call(
    client: &reqwest::Client,
    seller_addr: SocketAddr,
    buyer_agent: &str,
    seller_host: &str,
    correlation_id: &str,
    tool_name: &str,
    arguments: Value,
) -> Result<(u16, i64, Value, Value)> {
    let request_payload = json!({
        "jsonrpc": "2.0",
        "id": correlation_id,
        "method": "tools/call",
        "protocolVersion": "2026-07-28",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    });
    let started = Instant::now();
    let response = client
        .post(format!("http://{seller_addr}/mcp"))
        .header("content-type", "application/json")
        .header("x-buyer-agent", buyer_agent)
        .header("x-seller-host", seller_host)
        .json(&request_payload)
        .send()
        .await
        .with_context(|| format!("Loopback MCP call '{tool_name}' to {seller_addr} failed"))?;
    let latency_ms = (started.elapsed().as_micros().div_ceil(1000)) as i64;
    let status = response.status().as_u16();
    let response_json: Value = response
        .json()
        .await
        .with_context(|| format!("Invalid JSON from seller '{tool_name}'"))?;
    Ok((status, latency_ms, request_payload, response_json))
}

fn build_proposed_offers_payload(
    conn: &rusqlite::Connection,
    tx_id: &str,
    lane: &str,
    buyer_agent: &str,
    seller_host: &str,
    include_draft: bool,
) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT offer_id, label, sku_title, price_cents, currency, in_stock, warranty, returns_policy, is_draft
         FROM commercial_offers
         WHERE tx_id=?1
         ORDER BY offer_id ASC",
    )?;
    let rows = stmt
        .query_map([tx_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, i64>(8)? != 0,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut offers = Vec::new();
    for (
        offer_id,
        label,
        sku_title,
        price_cents,
        currency,
        in_stock,
        warranty,
        returns_policy,
        is_draft,
    ) in rows
    {
        if is_draft && !include_draft {
            continue;
        }
        offers.push(json!({
            "offer_id": offer_id,
            "label": label,
            "sku_title": sku_title,
            "price_cents": price_cents,
            "currency": currency,
            "in_stock": in_stock,
            "warranty": warranty,
            "returns_policy": returns_policy,
            "origin": if is_draft { "conduit_proxy" } else { "seller" },
        }));
    }

    let (source, recipient) = if lane == "buyer_to_seller" {
        (buyer_agent, seller_host)
    } else {
        (seller_host, buyer_agent)
    };

    Ok(json!({
        "jsonrpc": "2.0",
        "id": "corr-7f2-02",
        "method": "return_offers",
        "protocolVersion": "2026-07-28",
        "direction": lane,
        "source": source,
        "recipient": recipient,
        "offers": offers,
    }))
}

fn build_draft_copy(
    lane: &str,
    enabled: bool,
    promo_offer_id: &str,
    promo_cents: i64,
    buyer_agent: &str,
    seller_host: &str,
) -> (String, String) {
    if !enabled {
        return (
            format!(
                "Forward baseline offers without {promo_offer_id} ({})",
                if lane == "buyer_to_seller" {
                    format!("{buyer_agent} -> {seller_host}")
                } else {
                    format!("{seller_host} -> {buyer_agent}")
                }
            ),
            format!(
                "Buyer {buyer_agent} receives 2 baseline offers and selects O01 ($219.00)"
            ),
        );
    }
    let price_str = fmt_usd(promo_cents);
    let savings_cents = (21_900 - promo_cents).max(0);
    let summary = if lane == "buyer_to_seller" {
        format!(
            "Present counter-offer {promo_offer_id} ({price_str}) from {buyer_agent} to {seller_host}"
        )
    } else {
        format!(
            "Inject promotional {promo_offer_id} ({price_str}) into {seller_host} -> {buyer_agent} response"
        )
    };
    let preview = if savings_cents > 0 {
        format!(
            "Buyer {buyer_agent} evaluates 3 offers and selects {promo_offer_id} ({price_str}), saving {}",
            fmt_usd(savings_cents)
        )
    } else {
        format!(
            "Buyer {buyer_agent} evaluates 3 offers with {promo_offer_id} at {price_str}"
        )
    };
    (summary, preview)
}

fn choose_best_offer(delivered_payload: &Value) -> (String, String, i64) {
    if let Some(offers) = delivered_payload.get("offers").and_then(Value::as_array) {
        let mut best: Option<(String, String, i64)> = None;
        for offer in offers {
            let in_stock = offer
                .get("in_stock")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let Some(id) = offer.get("offer_id").and_then(Value::as_str) else {
                continue;
            };
            let title = offer
                .get("sku_title")
                .and_then(Value::as_str)
                .unwrap_or("Studio Wireless X");
            let Some(price) = offer.get("price_cents").and_then(Value::as_i64) else {
                continue;
            };
            if !in_stock || price <= 0 {
                continue;
            }
            if best.as_ref().is_none_or(|(_, _, b_price)| price < *b_price) {
                best = Some((id.to_owned(), title.to_owned(), price));
            }
        }
        if let Some(chosen) = best {
            return chosen;
        }
    }
    ("O01".to_owned(), "Studio Wireless X".to_owned(), 21_900)
}

fn spawn_audioshop_buyer_task(
    commerce: Arc<Commerce>,
    seller_addr: SocketAddr,
    held_ready_tx: oneshot::Sender<Result<()>>,
) {
    tokio::spawn(async move {
        let setup_res: Result<(reqwest::Client, oneshot::Receiver<ReleaseDecision>)> = async {
            let client = build_buyer_http_client(&commerce)?;

            // Step 1a: Real C01 `discover_products` over loopback HTTP/MCP
            let (c01_status, c01_latency, c01_req, c01_res) = send_seller_mcp_call(
                &client,
                seller_addr,
                DEFAULT_BUYER_AGENT,
                DEFAULT_SELLER_HOST,
                "corr-7f2-01",
                "discover_products",
                json!({"category": "wireless_headphones", "max_price_cents": 25_000}),
            )
            .await?;
            ensure!(c01_status == 200, "Seller C01 returned HTTP {c01_status}");
            let matched_count = c01_res
                .pointer("/result/total_matches")
                .and_then(Value::as_i64)
                .unwrap_or(12);

            // Step 1b: Real C02 `get_offers` -> Seller emits R02 `return_offers`
            let (c02_status, c02_latency, c02_req, seller_r02_payload) = send_seller_mcp_call(
                &client,
                seller_addr,
                DEFAULT_BUYER_AGENT,
                DEFAULT_SELLER_HOST,
                "corr-7f2-02",
                "get_offers",
                json!({"sku": "SWX-BLK-01", "sku_title": "Studio Wireless X"}),
            )
            .await?;
            ensure!(c02_status == 200, "Seller C02 returned HTTP {c02_status}");

            let seller_offers = seller_r02_payload["offers"]
                .as_array()
                .context("Seller return_offers missing offers array")?
                .clone();

            let payment_auth = check_payment_authorization(&commerce, DEFAULT_BUYER_AGENT);
            let (release_tx, release_rx) = oneshot::channel::<ReleaseDecision>();

            {
                let mut conn = commerce
                    .db
                    .0
                    .lock()
                    .map_err(|_| anyhow!("database lock poisoned"))?;
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let ts = now_ms();

                tx.execute(
                    "INSERT INTO interception_events(
                        event_id, tx_id, seq, timestamp_ms, actor, direction, protocol,
                        event_name, epistemic_kind, hold_state, status_code, status_label,
                        correlation_id, latency_ms, observation, payload
                     ) VALUES ('C01', ?1, 1, ?2, ?3, 'buyer_to_seller', 'MCP', 'discover_products', 'observed', 'none', ?4, ?5, 'corr-7f2-01', ?6, ?7, ?8)",
                    params![
                        DEFAULT_SCENARIO_TX_ID,
                        ts,
                        DEFAULT_BUYER_AGENT,
                        i64::from(c01_status),
                        c01_status.to_string(),
                        c01_latency,
                        format!("Products found ({matched_count})"),
                        json!({"request": c01_req, "response": c01_res}).to_string(),
                    ],
                )?;

                tx.execute(
                    "INSERT INTO interception_events(
                        event_id, tx_id, seq, timestamp_ms, actor, direction, protocol,
                        event_name, epistemic_kind, hold_state, status_code, status_label,
                        correlation_id, latency_ms, observation, payload
                     ) VALUES ('C02', ?1, 2, ?2, ?3, 'buyer_to_seller', 'MCP', 'get_offers', 'observed', 'none', ?4, ?5, 'corr-7f2-02', ?6, 'Call to get_offers', ?7)",
                    params![
                        DEFAULT_SCENARIO_TX_ID,
                        ts + 1,
                        DEFAULT_BUYER_AGENT,
                        i64::from(c02_status),
                        c02_status.to_string(),
                        c02_latency,
                        c02_req.to_string(),
                    ],
                )?;

                for offer in &seller_offers {
                    tx.execute(
                        "INSERT INTO commercial_offers(
                            offer_id, tx_id, parent_event_id, label, sku_title, price_cents,
                            currency, in_stock, warranty, returns_policy, is_draft, committed
                         ) VALUES (?1, ?2, 'C02', ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 1)",
                        params![
                            offer["offer_id"].as_str().unwrap_or("O01"),
                            DEFAULT_SCENARIO_TX_ID,
                            offer["label"].as_str().unwrap_or("Offer"),
                            offer["sku_title"].as_str().unwrap_or("Studio Wireless X"),
                            offer["price_cents"].as_i64().unwrap_or(21_900),
                            offer["currency"].as_str().unwrap_or("USD"),
                            i64::from(offer["in_stock"].as_bool().unwrap_or(true)),
                            offer["warranty"].as_str().unwrap_or("2-year manufacturer"),
                            offer["returns_policy"]
                                .as_str()
                                .unwrap_or("30-day free returns"),
                        ],
                    )?;
                }

                // Insert draft promotional offer O03 ($209) cradled beneath R02
                tx.execute(
                    "INSERT INTO commercial_offers(
                        offer_id, tx_id, parent_event_id, label, sku_title, price_cents,
                        currency, in_stock, warranty, returns_policy, is_draft, committed
                     ) VALUES ('O03', ?1, 'R02', 'Offer C (draft)', 'Studio Wireless X', ?2, 'USD', 1, '2-year manufacturer', '30-day free returns', 1, 0)",
                    params![DEFAULT_SCENARIO_TX_ID, AUDIOSHOP_PROMO_CENTS],
                )?;

                // Step 2: Seller return_offers R02 hits the active interception hold gate
                tx.execute(
                    "INSERT INTO interception_events(
                        event_id, tx_id, seq, timestamp_ms, actor, direction, protocol,
                        event_name, epistemic_kind, hold_state, status_code, status_label,
                        correlation_id, latency_ms, observation, payload
                     ) VALUES ('R02', ?1, 3, ?2, ?3, 'seller_to_buyer', 'MCP', 'return_offers', 'held', 'held', NULL, 'HELD', 'corr-7f2-02', NULL, '2 offers held at gate ($219, $229)', ?4)",
                    params![
                        DEFAULT_SCENARIO_TX_ID,
                        ts + 2,
                        DEFAULT_SELLER_HOST,
                        seller_r02_payload.to_string(),
                    ],
                )?;

                let proposed_payload = build_proposed_offers_payload(
                    &tx,
                    DEFAULT_SCENARIO_TX_ID,
                    "seller_to_buyer",
                    DEFAULT_BUYER_AGENT,
                    DEFAULT_SELLER_HOST,
                    true,
                )?;
                let (mcp_schema, mcp_schema_detail) =
                    validate_mcp_offers_schema(&proposed_payload);
                let (summary, result_preview) = build_draft_copy(
                    "seller_to_buyer",
                    true,
                    "O03",
                    AUDIOSHOP_PROMO_CENTS,
                    DEFAULT_BUYER_AGENT,
                    DEFAULT_SELLER_HOST,
                );

                tx.execute(
                    "INSERT INTO interception_drafts(
                        draft_id, tx_id, target_event_id, lane, enabled, promo_offer_id,
                        summary, result_preview, delivery_state, proposed_payload,
                        mcp_schema, mcp_schema_detail, seller_policy, seller_policy_detail,
                        operator_approval, payment_auth, seller_floor_cents, updated_at_ms
                     ) VALUES ('draft-r02', ?1, 'R02', 'seller_to_buyer', 1, 'O03', ?2, ?3, 'proposed', ?4, ?5, ?6, 'pending_validation', 'Awaiting seller floor check ($199.00 minimum)', 'awaiting_operator', ?7, ?8, ?9)",
                    params![
                        DEFAULT_SCENARIO_TX_ID,
                        summary,
                        result_preview,
                        proposed_payload.to_string(),
                        mcp_schema,
                        mcp_schema_detail,
                        payment_auth,
                        AUDIOSHOP_FLOOR_CENTS,
                        ts + 2,
                    ],
                )?;

                tx.execute(
                    "UPDATE commerce_transactions
                     SET phase='negotiate', status='held', status_detail='HELD — Awaiting operator',
                         sub_status='Negotiate (held)', updated_at_ms=?1
                     WHERE tx_id=?2",
                    params![ts + 2, DEFAULT_SCENARIO_TX_ID],
                )?;

                tx.commit()?;
            }

            commerce
                .interception
                .held
                .lock()
                .map_err(|_| anyhow!("interception held lock poisoned"))?
                .insert(
                    (DEFAULT_SCENARIO_TX_ID.to_owned(), "R02".to_owned()),
                    HeldIntercept {
                        tx: release_tx,
                        held_since: Instant::now(),
                    },
                );

            commerce.changed("/interception/held", Some(DEFAULT_SCENARIO_TX_ID));
            Ok((client, release_rx))
        }
        .await;

        let (client, release_rx) = match setup_res {
            Ok(pair) => {
                let _ = held_ready_tx.send(Ok(()));
                pair
            }
            Err(err) => {
                let _ = held_ready_tx.send(Err(err));
                return;
            }
        };

        // Buyer task genuinely suspends here awaiting operator release on oneshot::Receiver!
        let Ok(decision) = release_rx.await else {
            return;
        };

        let mut selected_price_cents = 21_900_i64;
        let mut selected_offer_id = "O01".to_owned();

        let post_release_res: Result<Option<oneshot::Receiver<PaymentDecision>>> = async {
            let (offer_id, sku_title, price_cents) = choose_best_offer(&decision.delivered_payload);
            selected_price_cents = price_cents;
            selected_offer_id = offer_id.clone();

            let (c03_status, c03_latency, c03_req, c03_res) = send_seller_mcp_call(
                &client,
                seller_addr,
                DEFAULT_BUYER_AGENT,
                DEFAULT_SELLER_HOST,
                "corr-7f2-03",
                "select_product",
                json!({
                    "offer_id": offer_id,
                    "sku_title": sku_title,
                    "price_cents": price_cents
                }),
            )
            .await?;
            ensure!(c03_status == 200, "Seller C03 returned HTTP {c03_status}");

            let (c04_status, c04_latency, c04_req, c04_res) = send_seller_mcp_call(
                &client,
                seller_addr,
                DEFAULT_BUYER_AGENT,
                DEFAULT_SELLER_HOST,
                "corr-7f2-04",
                "create_checkout_session",
                json!({
                    "offer_id": offer_id,
                    "sku_title": sku_title,
                    "price_cents": price_cents
                }),
            )
            .await?;
            ensure!(c04_status == 200, "Seller C04 returned HTTP {c04_status}");

            {
                let mut conn = commerce
                    .db
                    .0
                    .lock()
                    .map_err(|_| anyhow!("database lock poisoned"))?;
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let ts = now_ms();

                tx.execute(
                    "UPDATE interception_events
                     SET timestamp_ms=?1, epistemic_kind='observed', status_code=?2, status_label=?3,
                         latency_ms=?4, observation=?5, payload=?6
                     WHERE tx_id=?7 AND event_id='C03'",
                    params![
                        ts,
                        i64::from(c03_status),
                        c03_status.to_string(),
                        c03_latency,
                        format!(
                            "Selected {} {} ({})",
                            offer_id,
                            sku_title,
                            fmt_usd(price_cents)
                        ),
                        json!({"request": c03_req, "response": c03_res}).to_string(),
                        DEFAULT_SCENARIO_TX_ID,
                    ],
                )?;

                tx.execute(
                    "UPDATE interception_events
                     SET timestamp_ms=?1, epistemic_kind='observed', status_code=?2, status_label=?3,
                         latency_ms=?4, observation=?5, payload=?6
                     WHERE tx_id=?7 AND event_id='C04'",
                    params![
                        ts + 1,
                        i64::from(c04_status),
                        c04_status.to_string(),
                        c04_latency,
                        format!(
                            "Checkout session chk_audioshop_7f2 ({})",
                            fmt_usd(price_cents)
                        ),
                        json!({"request": c04_req, "response": c04_res}).to_string(),
                        DEFAULT_SCENARIO_TX_ID,
                    ],
                )?;

                tx.execute(
                    "UPDATE commerce_transactions
                     SET phase='payment', status='live',
                         status_detail='Awaiting payment pass',
                         sub_status='Payment (awaiting pass)',
                         category_label=?1, updated_at_ms=?2
                     WHERE tx_id=?3",
                    params![
                        format!("Audio · {}", fmt_usd_whole_or_cents(price_cents)),
                        ts + 1,
                        DEFAULT_SCENARIO_TX_ID,
                    ],
                )?;
                tx.commit()?;
            }

            if let Some(active_signed) = find_active_verified_receipt(&commerce, DEFAULT_BUYER_AGENT)
            {
                complete_c05_exchange(
                    &commerce,
                    &client,
                    seller_addr,
                    DEFAULT_SCENARIO_TX_ID,
                    DEFAULT_BUYER_AGENT,
                    DEFAULT_SELLER_HOST,
                    &offer_id,
                    price_cents,
                    &active_signed,
                )
                .await?;
                Ok(None)
            } else {
                let (pay_tx, pay_rx) = oneshot::channel::<PaymentDecision>();
                commerce
                    .interception
                    .payment_waiters
                    .lock()
                    .map_err(|_| anyhow!("interception payment_waiters lock poisoned"))?
                    .insert(DEFAULT_SCENARIO_TX_ID.to_owned(), PaymentWaiter { tx: pay_tx });
                Ok(Some(pay_rx))
            }
        }
        .await;

        let pay_rx = match post_release_res {
            Ok(maybe_rx) => {
                commerce.changed("/interception/released", Some(DEFAULT_SCENARIO_TX_ID));
                let _ = decision.done_tx.send(Ok(()));
                match maybe_rx {
                    Some(rx) => rx,
                    None => {
                        commerce
                            .interception
                            .abort_in_flight_for_tx(DEFAULT_SCENARIO_TX_ID)
                            .await;
                        return;
                    }
                }
            }
            Err(err) => {
                let _ = decision.done_tx.send(Err(err));
                return;
            }
        };

        // Wait for operator Ed25519 payment authorization
        if let Ok(pay_decision) = pay_rx.await {
            let res = complete_c05_exchange(
                &commerce,
                &client,
                seller_addr,
                DEFAULT_SCENARIO_TX_ID,
                DEFAULT_BUYER_AGENT,
                DEFAULT_SELLER_HOST,
                &selected_offer_id,
                selected_price_cents,
                &pay_decision.signed_receipt,
            )
            .await;
            commerce.changed("/interception/fulfilled", Some(DEFAULT_SCENARIO_TX_ID));
            let _ = pay_decision.done_tx.send(res);
            commerce
                .interception
                .abort_in_flight_for_tx(DEFAULT_SCENARIO_TX_ID)
                .await;
        }
    });
}

fn find_active_verified_receipt(commerce: &Commerce, buyer_agent: &str) -> Option<SignedReceipt> {
    let rows = commerce
        .db
        .rows_where("capability_receipts", "subject", buyer_agent)
        .ok()?;
    let current_unix = now();
    for row in rows {
        if row["revoked"].as_i64() != Some(0)
            || !row["remaining_calls"].as_i64().is_some_and(|n| n > 0)
            || !row["expires_at_unix"]
                .as_i64()
                .is_some_and(|exp| exp > current_unix)
        {
            continue;
        }
        let receipt = serde_json::from_value::<CapabilityReceipt>(row["payload"].clone()).ok()?;
        let signature = row["signature"].as_str()?.to_owned();
        let bundle_id = receipt.bundle_id.clone();
        let signed = SignedReceipt { receipt, signature };
        if commerce
            .receipts
            .verify(&signed, buyer_agent, &bundle_id)
            .is_ok()
        {
            return Some(signed);
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
async fn complete_c05_exchange(
    commerce: &Arc<Commerce>,
    client: &reqwest::Client,
    seller_addr: SocketAddr,
    tx_id: &str,
    buyer_agent: &str,
    seller_host: &str,
    offer_id: &str,
    price_cents: i64,
    signed: &SignedReceipt,
) -> Result<()> {
    let bundle_id = signed.receipt.bundle_id.clone();
    let _ = commerce.receipts.redeem(
        signed,
        buyer_agent,
        &bundle_id,
        buyer_agent,
        "complete_checkout_session",
        None,
    )?;

    let receipt_token = signed.encode()?;
    let (c05_status, c05_latency, c05_req, c05_res) = send_seller_mcp_call(
        client,
        seller_addr,
        buyer_agent,
        seller_host,
        "corr-7f2-05",
        "complete_checkout_session",
        json!({
            "checkout_session_id": "chk_audioshop_7f2",
            "offer_id": offer_id,
            "amount_cents": price_cents,
            "receipt_id": signed.receipt.receipt_id,
            "receipt_token": receipt_token,
        }),
    )
    .await?;
    ensure!(c05_status == 200, "Seller C05 returned HTTP {c05_status}");

    let mut conn = commerce
        .db
        .0
        .lock()
        .map_err(|_| anyhow!("database lock poisoned"))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let ts = now_ms();

    tx.execute(
        "UPDATE interception_events
         SET timestamp_ms=?1, epistemic_kind='observed', status_code=?2, status_label=?3,
             latency_ms=?4, observation=?5, payload=?6
         WHERE tx_id=?7 AND event_id='C05'",
        params![
            ts,
            i64::from(c05_status),
            c05_status.to_string(),
            c05_latency,
            format!(
                "Order ord_audioshop_7f2 settled ({}, pass verified)",
                fmt_usd(price_cents)
            ),
            json!({"request": c05_req, "response": c05_res}).to_string(),
            tx_id,
        ],
    )?;

    tx.execute(
        "UPDATE commerce_transactions
         SET phase='fulfill', status='complete',
             status_detail='Order fulfilled — payment pass verified',
             sub_status='Fulfill (complete)', updated_at_ms=?1
         WHERE tx_id=?2",
        params![ts, tx_id],
    )?;

    tx.commit()?;
    Ok(())
}

async fn execute_post_release_fallback(
    commerce: &Arc<Commerce>,
    tx_id: &str,
    delivered_payload: &Value,
) -> Result<()> {
    let seller = SellerUpstream::start().await?;
    let client = build_buyer_http_client(commerce)?;
    let (offer_id, sku_title, price_cents) = choose_best_offer(delivered_payload);

    let (c03_status, c03_latency, c03_req, c03_res) = send_seller_mcp_call(
        &client,
        seller.addr,
        DEFAULT_BUYER_AGENT,
        DEFAULT_SELLER_HOST,
        "corr-7f2-03",
        "select_product",
        json!({"offer_id": offer_id, "sku_title": sku_title, "price_cents": price_cents}),
    )
    .await?;
    let (c04_status, c04_latency, c04_req, c04_res) = send_seller_mcp_call(
        &client,
        seller.addr,
        DEFAULT_BUYER_AGENT,
        DEFAULT_SELLER_HOST,
        "corr-7f2-04",
        "create_checkout_session",
        json!({"offer_id": offer_id, "sku_title": sku_title, "price_cents": price_cents}),
    )
    .await?;

    {
        let mut conn = commerce
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ts = now_ms();
        tx.execute(
            "UPDATE interception_events
             SET timestamp_ms=?1, epistemic_kind='observed', status_code=?2, status_label=?3,
                 latency_ms=?4, observation=?5, payload=?6
             WHERE tx_id=?7 AND event_id='C03'",
            params![
                ts,
                i64::from(c03_status),
                c03_status.to_string(),
                c03_latency,
                format!("Selected {} {} ({})", offer_id, sku_title, fmt_usd(price_cents)),
                json!({"request": c03_req, "response": c03_res}).to_string(),
                tx_id,
            ],
        )?;
        tx.execute(
            "UPDATE interception_events
             SET timestamp_ms=?1, epistemic_kind='observed', status_code=?2, status_label=?3,
                 latency_ms=?4, observation=?5, payload=?6
             WHERE tx_id=?7 AND event_id='C04'",
            params![
                ts + 1,
                i64::from(c04_status),
                c04_status.to_string(),
                c04_latency,
                format!("Checkout session chk_audioshop_7f2 ({})", fmt_usd(price_cents)),
                json!({"request": c04_req, "response": c04_res}).to_string(),
                tx_id,
            ],
        )?;
        tx.execute(
            "UPDATE commerce_transactions
             SET phase='payment', status='live',
                 status_detail='Awaiting payment pass',
                 sub_status='Payment (awaiting pass)',
                 category_label=?1, updated_at_ms=?2
             WHERE tx_id=?3",
            params![
                format!("Audio · {}", fmt_usd_whole_or_cents(price_cents)),
                ts + 1,
                tx_id,
            ],
        )?;
        tx.commit()?;
    }

    if let Some(signed) = find_active_verified_receipt(commerce, DEFAULT_BUYER_AGENT) {
        complete_c05_exchange(
            commerce,
            &client,
            seller.addr,
            tx_id,
            DEFAULT_BUYER_AGENT,
            DEFAULT_SELLER_HOST,
            &offer_id,
            price_cents,
            &signed,
        )
        .await?;
    }

    seller.shutdown().await;
    Ok(())
}

async fn execute_c05_fallback(
    commerce: &Arc<Commerce>,
    tx_id: &str,
    buyer_agent: &str,
    _bundle_id: &str,
    signed: &SignedReceipt,
) -> Result<()> {
    let (offer_id, price_cents): (String, i64) = {
        let conn = commerce
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let committed_promo: Option<(String, i64)> = conn
            .query_row(
                "SELECT offer_id, price_cents FROM commercial_offers WHERE tx_id=?1 AND offer_id='O03' AND committed=1",
                [tx_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some(found) = committed_promo {
            found
        } else {
            conn.query_row(
                "SELECT offer_id, price_cents FROM commercial_offers WHERE tx_id=?1 AND is_draft=0 ORDER BY price_cents ASC LIMIT 1",
                [tx_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or_else(|_| ("O01".to_owned(), 21_900))
        }
    };

    let seller = SellerUpstream::start().await?;
    let client = build_buyer_http_client(commerce)?;
    let res = complete_c05_exchange(
        commerce,
        &client,
        seller.addr,
        tx_id,
        buyer_agent,
        DEFAULT_SELLER_HOST,
        &offer_id,
        price_cents,
        signed,
    )
    .await;
    seller.shutdown().await;
    res
}

async fn run_peer_sessions(commerce: &Arc<Commerce>) -> Result<()> {
    let peer_seller = SellerUpstream::start().await?;
    let client = build_buyer_http_client(commerce)?;

    // 1. Skyport — Flight Booking (`negotiate`, `live`, `Flight · $438`)
    let (sky_c01_status, sky_c01_lat, sky_c01_req, sky_c01_res) = send_seller_mcp_call(
        &client,
        peer_seller.addr,
        "agent-4b9",
        "skyport.aero",
        "corr-4b9-01",
        "discover_flights",
        json!({"origin": "SFO", "destination": "JFK"}),
    )
    .await?;
    let (sky_c02_status, sky_c02_lat, sky_c02_req, sky_r02_res) = send_seller_mcp_call(
        &client,
        peer_seller.addr,
        "agent-4b9",
        "skyport.aero",
        "corr-4b9-02",
        "get_offers",
        json!({"route": "SFO -> JFK"}),
    )
    .await?;

    // 2. DisplayCo — Studio Display (`discover`, `live`, `Monitor · $329`)
    let (dsp_c01_status, dsp_c01_lat, dsp_c01_req, dsp_c01_res) = send_seller_mcp_call(
        &client,
        peer_seller.addr,
        "agent-9c1",
        "displayco.hardware",
        "corr-9c1-01",
        "discover_products",
        json!({"category": "studio_monitors"}),
    )
    .await?;

    // 3. Cloudstore — Compute Credits (`fulfill`, `complete`, `Credits · $100`)
    let cloud_req = json!({"sku": "GPU-100H", "amount_cents": 10_000, "currency": "USD"});
    let cloud_started = Instant::now();
    let cloud_http_res = client
        .post(format!("http://{}/v1/credits/orders", peer_seller.addr))
        .header("content-type", "application/json")
        .header("x-buyer-agent", "agent-2d4")
        .header("x-seller-host", "cloudstore.io")
        .json(&cloud_req)
        .send()
        .await
        .context("Cloudstore loopback HTTP order failed")?;
    let cloud_lat = (cloud_started.elapsed().as_micros().div_ceil(1000)) as i64;
    let cloud_status = cloud_http_res.status().as_u16();
    let cloud_body: Value = cloud_http_res.json().await?;
    if cloud_status != 200 {
        bail!("Cloudstore loopback order returned HTTP {cloud_status}");
    }

    peer_seller.shutdown().await;

    let mut conn = commerce
        .db
        .0
        .lock()
        .map_err(|_| anyhow!("database lock poisoned"))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let ts = now_ms();

    // Persist Skyport
    clear_tx_rows(&tx, "skyport")?;
    ensure_agent_session(&tx, "agent-4b9", "Buyer Agent (Skyport)")?;
    tx.execute(
        "INSERT INTO commerce_transactions(
            tx_id, title, short_title, category_label, buyer_agent, seller_host,
            protocol, phase, status, status_detail, sub_status, created_at_ms, updated_at_ms
         ) VALUES ('skyport', 'Skyport — Flight Booking', 'Skyport', 'Flight · $438', 'agent-4b9', 'skyport.aero', 'MCP', 'negotiate', 'live', 'Comparing carrier fare offers', 'Negotiate (live)', ?1, ?1)",
        params![ts],
    )?;
    tx.execute(
        "INSERT INTO interception_events VALUES ('C01', 'skyport', 1, ?1, 'agent-4b9', 'buyer_to_seller', 'MCP', 'discover_products', 'observed', 'none', ?2, ?3, 'corr-4b9-01', ?4, 'Flights found (8)', ?5)",
        params![
            ts,
            i64::from(sky_c01_status),
            sky_c01_status.to_string(),
            sky_c01_lat,
            json!({"request": sky_c01_req, "response": sky_c01_res}).to_string(),
        ],
    )?;
    tx.execute(
        "INSERT INTO interception_events VALUES ('C02', 'skyport', 2, ?1, 'agent-4b9', 'buyer_to_seller', 'MCP', 'get_offers', 'observed', 'none', ?2, ?3, 'corr-4b9-02', ?4, 'Call to get_offers', ?5)",
        params![
            ts + 1,
            i64::from(sky_c02_status),
            sky_c02_status.to_string(),
            sky_c02_lat,
            sky_c02_req.to_string(),
        ],
    )?;
    tx.execute(
        "INSERT INTO interception_events VALUES ('R02', 'skyport', 3, ?1, 'skyport.aero', 'seller_to_buyer', 'MCP', 'return_offers', 'observed', 'forwarded', 200, '200', 'corr-4b9-02', ?2, '2 fares forwarded ($438, $512)', ?3)",
        params![ts + 2, sky_c02_lat, sky_r02_res.to_string()],
    )?;
    for (seq, ev_id, ev_name, corr, obs) in [
        (4_i64, "C03", "select_product", "corr-4b9-03", "Evaluating fare rules"),
        (5_i64, "C04", "create_checkout_session", "corr-4b9-04", "Awaiting fare selection"),
        (6_i64, "C05", "complete_checkout_session", "corr-4b9-05", "Awaiting payment receipt"),
    ] {
        tx.execute(
            "INSERT INTO interception_events VALUES (?1, 'skyport', ?2, ?3, 'agent-4b9', 'buyer_to_seller', 'MCP', ?4, 'pending', 'none', NULL, 'PENDING', ?5, NULL, ?6, '{}')",
            params![ev_id, seq, ts + seq, ev_name, corr, obs],
        )?;
    }
    if let Some(sky_offers) = sky_r02_res["offers"].as_array() {
        for offer in sky_offers {
            tx.execute(
                "INSERT INTO commercial_offers VALUES (?1, 'skyport', 'C02', ?2, ?3, ?4, 'USD', 1, ?5, ?6, 0, 1)",
                params![
                    offer["offer_id"].as_str().unwrap_or("O01"),
                    offer["label"].as_str().unwrap_or("Fare"),
                    offer["sku_title"].as_str().unwrap_or("SFO -> JFK"),
                    offer["price_cents"].as_i64().unwrap_or(43_800),
                    offer["warranty"].as_str().unwrap_or("Trip delay protection"),
                    offer["returns_policy"].as_str().unwrap_or("24-hour free cancellation"),
                ],
            )?;
        }
    }

    // Persist DisplayCo
    clear_tx_rows(&tx, "displayco")?;
    ensure_agent_session(&tx, "agent-9c1", "Buyer Agent (DisplayCo)")?;
    tx.execute(
        "INSERT INTO commerce_transactions(
            tx_id, title, short_title, category_label, buyer_agent, seller_host,
            protocol, phase, status, status_detail, sub_status, created_at_ms, updated_at_ms
         ) VALUES ('displayco', 'DisplayCo — Studio Display', 'DisplayCo', 'Monitor · $329', 'agent-9c1', 'displayco.hardware', 'MCP', 'discover', 'live', 'Catalog discovery completed', 'Discover (live)', ?1, ?1)",
        params![ts + 10],
    )?;
    tx.execute(
        "INSERT INTO interception_events VALUES ('C01', 'displayco', 1, ?1, 'agent-9c1', 'buyer_to_seller', 'MCP', 'discover_products', 'observed', 'none', ?2, ?3, 'corr-9c1-01', ?4, 'Displays found (6)', ?5)",
        params![
            ts + 10,
            i64::from(dsp_c01_status),
            dsp_c01_status.to_string(),
            dsp_c01_lat,
            json!({"request": dsp_c01_req, "response": dsp_c01_res}).to_string(),
        ],
    )?;
    for (seq, ev_id, ev_name, corr, obs) in [
        (2_i64, "C02", "get_offers", "corr-9c1-02", "Awaiting SKU offer query"),
        (3_i64, "C03", "select_product", "corr-9c1-03", "Awaiting offer evaluation"),
        (4_i64, "C04", "create_checkout_session", "corr-9c1-04", "Awaiting selection"),
        (5_i64, "C05", "complete_checkout_session", "corr-9c1-05", "Awaiting payment receipt"),
    ] {
        tx.execute(
            "INSERT INTO interception_events VALUES (?1, 'displayco', ?2, ?3, 'agent-9c1', 'buyer_to_seller', 'MCP', ?4, 'pending', 'none', NULL, 'PENDING', ?5, NULL, ?6, '{}')",
            params![ev_id, seq, ts + 10 + seq, ev_name, corr, obs],
        )?;
    }
    tx.execute(
        "INSERT INTO commercial_offers VALUES ('O01', 'displayco', 'C01', 'Catalog MSRP', 'Studio Reference 27\" 4K', 32900, 'USD', 1, '3-year panel warranty', '30-day free returns', 0, 1)",
        [],
    )?;

    // Persist Cloudstore
    clear_tx_rows(&tx, "cloudstore")?;
    ensure_agent_session(&tx, "agent-2d4", "Buyer Agent (Cloudstore)")?;
    tx.execute(
        "INSERT INTO commerce_transactions(
            tx_id, title, short_title, category_label, buyer_agent, seller_host,
            protocol, phase, status, status_detail, sub_status, created_at_ms, updated_at_ms
         ) VALUES ('cloudstore', 'Cloudstore — Compute Credits', 'Cloudstore', 'Credits · $100', 'agent-2d4', 'cloudstore.io', 'HTTP', 'fulfill', 'complete', 'Compute credits provisioned', 'Fulfill (complete)', ?1, ?1)",
        params![ts + 20],
    )?;
    tx.execute(
        "INSERT INTO interception_events VALUES ('C01', 'cloudstore', 1, ?1, 'agent-2d4', 'buyer_to_seller', 'HTTP', 'complete_checkout_session', 'observed', 'none', ?2, ?3, 'corr-2d4-01', ?4, 'Order ord_cloudstore_2d4 fulfilled ($100.00)', ?5)",
        params![
            ts + 20,
            i64::from(cloud_status),
            cloud_status.to_string(),
            cloud_lat,
            json!({"request": cloud_req, "response": cloud_body}).to_string(),
        ],
    )?;
    tx.execute(
        "INSERT INTO commercial_offers VALUES ('O01', 'cloudstore', 'C01', 'Credit Pack', 'GPU Compute Credits (100 hrs)', 10000, 'USD', 1, 'SLA 99.95% uptime', 'Unused credits roll over 12 months', 0, 1)",
        [],
    )?;

    tx.commit()?;
    Ok(())
}
