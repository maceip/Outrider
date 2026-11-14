//! Operator-driven MCP client: connects to any MCP server (stdio command or
//! Streamable HTTP URL, including this gateway's own `/mcp`), sends arbitrary
//! client requests, answers server-initiated sampling and elicitation by hand,
//! and records every message it sends or receives in SQLite.
#![allow(deprecated)]
use crate::commerce::{
    Commerce,
    db::{Database, id, now},
};
use anyhow::{Context, Result, anyhow, bail, ensure};
use rmcp::{
    ClientLifecycleMode, ClientServiceExt, ErrorData as McpError,
    model::*,
    service::{
        NotificationContext, Peer, RequestContext, RoleClient, RunningService, Service,
        ServiceError, ServiceRole,
    },
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use rusqlite::params;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::oneshot;

/// How long a server-initiated request waits for the operator before it fails.
const SERVER_REQUEST_WAIT: Duration = Duration::from_secs(600);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUEST_TIMEOUT_MS: u64 = 600_000;

const STANDARD_REQUESTS: &[&str] = &[
    "ping",
    "initialize",
    "server/discover",
    "completion/complete",
    "logging/setLevel",
    "prompts/get",
    "prompts/list",
    "resources/list",
    "resources/templates/list",
    "resources/read",
    "subscriptions/listen",
    "resources/subscribe",
    "resources/unsubscribe",
    "tools/call",
    "tools/list",
    "tasks/get",
    "tasks/update",
    "tasks/cancel",
    "skills/list",
    "skills/get",
    "resources/directory/read",
];
const STANDARD_NOTIFICATIONS: &[&str] = &[
    "notifications/cancelled",
    "notifications/progress",
    "notifications/initialized",
    "notifications/roots/list_changed",
];
type Answer = std::result::Result<Value, String>;
type PendingMap = Arc<Mutex<HashMap<String, (String, oneshot::Sender<Answer>)>>>;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as i64
}
fn lock<'a, T>(m: &'a Mutex<T>, what: &str) -> Result<std::sync::MutexGuard<'a, T>> {
    m.lock().map_err(|_| anyhow!("{what} lock poisoned"))
}

#[derive(Clone)]
struct Recorder {
    db: Database,
    events: tokio::sync::broadcast::Sender<Value>,
    connection: String,
}
impl Recorder {
    fn record(
        &self,
        direction: &str,
        kind: &str,
        method: &str,
        body: &Value,
        reply_to: Option<i64>,
        latency_ms: Option<i64>,
    ) -> Result<i64> {
        let conn = lock(&self.db.0, "database")?;
        conn.execute(
            "INSERT INTO inspector_messages(connection_id,direction,kind,method,body,reply_to,latency_ms,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![self.connection, direction, kind, method, body.to_string(), reply_to, latency_ms, now_ms()],
        )?;
        let message_id = conn.last_insert_rowid();
        drop(conn);
        self.emit("inspector.message");
        Ok(message_id)
    }
    fn emit(&self, kind: &str) {
        let _ = self
            .events
            .send(json!({"kind":kind,"connection_id":self.connection}));
    }
    fn set_status(&self, status: &str, error: Option<&str>) -> Result<()> {
        lock(&self.db.0, "database")?.execute(
            "UPDATE inspector_connections SET status=?2,error=?3,updated_at=?4 WHERE connection_id=?1",
            params![self.connection, status, error, now()],
        )?;
        self.emit("inspector.connection");
        Ok(())
    }
}

/// The client half of an inspector connection.
pub struct InspectorClient {
    rec: Recorder,
    pending: PendingMap,
    roots: Arc<Mutex<Vec<Root>>>,
}
impl InspectorClient {
    async fn park(&self, method: &str, params: Value) -> std::result::Result<Value, McpError> {
        let internal = |e: anyhow::Error| McpError::internal_error(format!("{e:#}"), None);
        let request_id = id();
        let (tx, rx) = oneshot::channel();
        lock(&self.pending, "pending")
            .map_err(internal)?
            .insert(request_id.clone(), (self.rec.connection.clone(), tx));
        lock(&self.rec.db.0, "database").map_err(internal)?.execute(
            "INSERT INTO inspector_server_requests(request_id,connection_id,method,params,status,created_at) VALUES (?1,?2,?3,?4,'Pending',?5)",
            params![request_id, self.rec.connection, method, params.to_string(), now()],
        ).map_err(|e| internal(e.into()))?;
        self.rec.emit("inspector.server_request");
        let outcome = tokio::time::timeout(SERVER_REQUEST_WAIT, rx).await;
        lock(&self.pending, "pending")
            .map_err(internal)?
            .remove(&request_id);
        let (status, stored, result) = match outcome {
            Ok(Ok(Ok(value))) => ("Answered", value.clone(), Ok(value)),
            Ok(Ok(Err(reason))) => (
                "Rejected",
                json!({"error":reason}),
                Err(McpError::new(ErrorCode::INVALID_REQUEST, reason, None)),
            ),
            Ok(Err(_)) => (
                "Abandoned",
                json!({"error":"Inspector connection closed before an answer"}),
                Err(McpError::internal_error(
                    "Inspector connection closed before an answer",
                    None,
                )),
            ),
            Err(_) => (
                "Timed out",
                json!({"error":"No operator answer within the wait limit"}),
                Err(McpError::internal_error(
                    "No operator answer within the wait limit",
                    None,
                )),
            ),
        };
        let _ = lock(&self.rec.db.0, "database").map(|c| c.execute(
            "UPDATE inspector_server_requests SET status=?2,response=?3,answered_at=?4 WHERE request_id=?1",
            params![request_id, status, stored.to_string(), now()],
        ));
        self.rec.emit("inspector.server_request");
        result
    }
}
impl Service<RoleClient> for InspectorClient {
    async fn handle_request(
        &self,
        request: <RoleClient as ServiceRole>::PeerReq,
        _context: RequestContext<RoleClient>,
    ) -> std::result::Result<<RoleClient as ServiceRole>::Resp, McpError> {
        let body = serde_json::to_value(&request).unwrap_or(Value::Null);
        let method = body["method"].as_str().unwrap_or("unknown").to_owned();
        let incoming = self
            .rec
            .record("server_to_client", "request", &method, &body, None, None)
            .ok();
        let started = Instant::now();
        let params = body.get("params").cloned().unwrap_or(json!({}));
        let result: std::result::Result<ClientResult, McpError> = match request {
            ServerRequest::PingRequest(_) => Ok(ClientResult::empty(())),
            ServerRequest::ListRootsRequest(_) => {
                let roots = self.roots.lock().map(|r| r.clone()).unwrap_or_default();
                Ok(ClientResult::ListRootsResult(ListRootsResult::new(roots)))
            }
            ServerRequest::CreateMessageRequest(_) => match self.park(&method, params).await {
                Ok(v) => serde_json::from_value::<CreateMessageResult>(v)
                    .map(|r| ClientResult::CreateMessageResult(Box::new(r)))
                    .map_err(|e| McpError::invalid_params(e.to_string(), None)),
                Err(e) => Err(e),
            },
            ServerRequest::ElicitRequest(_) => match self.park(&method, params).await {
                Ok(v) => serde_json::from_value::<ElicitResult>(v)
                    .map(ClientResult::ElicitResult)
                    .map_err(|e| McpError::invalid_params(e.to_string(), None)),
                Err(e) => Err(e),
            },
            ServerRequest::CustomRequest(r) => {
                Err(McpError::new(ErrorCode::METHOD_NOT_FOUND, r.method, None))
            }
            _ => Err(McpError::new(
                ErrorCode::METHOD_NOT_FOUND,
                method.clone(),
                None,
            )),
        };
        let latency = started.elapsed().as_millis() as i64;
        let _ = match &result {
            Ok(r) => self.rec.record(
                "client_to_server",
                "response",
                &method,
                &serde_json::to_value(r).unwrap_or(Value::Null),
                incoming,
                Some(latency),
            ),
            Err(e) => self.rec.record(
                "client_to_server",
                "error",
                &method,
                &serde_json::to_value(e).unwrap_or(Value::Null),
                incoming,
                Some(latency),
            ),
        };
        result
    }
    async fn handle_notification(
        &self,
        notification: <RoleClient as ServiceRole>::PeerNot,
        _context: NotificationContext<RoleClient>,
    ) -> std::result::Result<(), McpError> {
        let body = serde_json::to_value(&notification).unwrap_or(Value::Null);
        let method = body["method"].as_str().unwrap_or("unknown").to_owned();
        let _ = self.rec.record(
            "server_to_client",
            "notification",
            &method,
            &body,
            None,
            None,
        );
        Ok(())
    }
    fn get_info(&self) -> ClientConfig {
        ClientConfig::new(
            ClientCapabilities::builder()
                .enable_sampling()
                .enable_elicitation()
                .enable_roots()
                .enable_roots_list_changed()
                .build(),
            Implementation::new("Outrider MCP Inspector", env!("CARGO_PKG_VERSION")),
        )
    }
}

struct Connection {
    service: tokio::sync::Mutex<Option<RunningService<RoleClient, InspectorClient>>>,
    peer: Peer<RoleClient>,
    rec: Recorder,
    roots: Arc<Mutex<Vec<Root>>>,
    listeners: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

#[derive(Default)]
pub struct Inspector {
    connections: tokio::sync::RwLock<HashMap<String, Arc<Connection>>>,
    pending: PendingMap,
}

fn header_map(
    headers: &serde_json::Map<String, Value>,
) -> Result<HashMap<http::HeaderName, http::HeaderValue>> {
    let mut map = HashMap::new();
    for (name, value) in headers {
        let value = value.as_str().context("Header values must be strings")?;
        map.insert(
            http::HeaderName::from_bytes(name.trim().as_bytes())
                .with_context(|| format!("Invalid header name {name}"))?,
            http::HeaderValue::from_str(value)
                .with_context(|| format!("Invalid value for header {name}"))?,
        );
    }
    Ok(map)
}

impl Inspector {
    /// Marks connections and server requests left over from an earlier run.
    pub fn reset_stale(db: &Database) -> Result<()> {
        let conn = lock(&db.0, "database")?;
        conn.execute("UPDATE inspector_connections SET status='Disconnected',error='Runtime restarted; no live connection',updated_at=?1 WHERE status IN ('Connecting','Connected')",[now()])?;
        conn.execute("UPDATE inspector_server_requests SET status='Abandoned',response='{\"error\":\"Runtime restarted before an answer\"}',answered_at=?1 WHERE status='Pending'",[now()])?;
        Ok(())
    }

    pub async fn connect(
        &self,
        commerce: &Arc<Commerce>,
        body: &Value,
        actor: &str,
    ) -> Result<Value> {
        let transport = body["transport"].as_str().context("Missing transport")?;
        let target = body["target"].as_str().context("Missing target")?.trim();
        ensure!(!target.is_empty(), "Missing target");
        let lifecycle_name = body["lifecycle"].as_str().unwrap_or("auto");
        let lifecycle = match lifecycle_name {
            "auto" => ClientLifecycleMode::Auto {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
                legacy_version: Some(ProtocolVersion::V_2025_11_25),
            },
            "2026-07-28" => ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
            "initialize" => ClientLifecycleMode::Initialize,
            other => bail!("Unknown lifecycle {other}"),
        };
        let empty = serde_json::Map::new();
        let headers = body["headers"].as_object().unwrap_or(&empty);
        let env = body["env"].as_object().unwrap_or(&empty);
        let bearer = body["bearer_token"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let label = body["label"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(target);
        let mut header_names: Vec<String> = headers.keys().cloned().collect();
        if bearer.is_some() {
            header_names.push("Authorization".into());
        }
        let env_names: Vec<&String> = env.keys().collect();
        let connection_id = id();
        // Only names are stored; header and environment values may be secrets.
        lock(&commerce.db.0, "database")?.execute(
            "INSERT INTO inspector_connections(connection_id,label,transport,target,lifecycle,header_names,env_names,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'Connecting',?8,?8)",
            params![connection_id, label, transport, target, lifecycle_name, json!(header_names).to_string(), json!(env_names).to_string(), now()],
        )?;
        commerce.db.admin_audit(
            actor,
            "inspector.connect",
            &connection_id,
            &json!({"transport":transport,"target":target,"lifecycle":lifecycle_name,"header_names":header_names,"env_names":env_names}),
        )?;
        let rec = Recorder {
            db: commerce.db.clone(),
            events: commerce.events.clone(),
            connection: connection_id.clone(),
        };
        let roots: Arc<Mutex<Vec<Root>>> = Default::default();
        let client = InspectorClient {
            rec: rec.clone(),
            pending: self.pending.clone(),
            roots: roots.clone(),
        };
        let started = Instant::now();
        let connected = tokio::time::timeout(CONNECT_TIMEOUT, async {
            match transport {
                "http" => {
                    ensure!(
                        target.starts_with("http://") || target.starts_with("https://"),
                        "HTTP target must be an http:// or https:// URL"
                    );
                    let mut config =
                        StreamableHttpClientTransportConfig::with_uri(target.to_owned());
                    config.custom_headers = header_map(headers)?;
                    config.auth_header = bearer.map(str::to_owned);
                    let mut http_builder = reqwest13::Client::builder();
                    if let Ok(guard) = commerce.listener_info.read()
                        && let Some(info) = guard.as_ref()
                        && let Ok(cert) =
                            reqwest13::Certificate::from_pem(info.ca_cert_pem.as_bytes())
                    {
                        http_builder = http_builder.add_root_certificate(cert);
                        if let Some(connect_addr) = commerce.loopback_connect_addr()
                            && target.starts_with(&format!(
                                "https://localhost:{}",
                                connect_addr.port()
                            ))
                        {
                            http_builder = http_builder
                                .http1_only()
                                .no_proxy()
                                .resolve("localhost", connect_addr);
                        }
                    }
                    let transport = StreamableHttpClientTransport::with_client(
                        http_builder.build()?,
                        config,
                    );
                    Ok(client.serve_with_lifecycle(transport, lifecycle).await?)
                }
                "stdio" => {
                    let parts = shell_words::split(target)?;
                    ensure!(!parts.is_empty(), "Empty command");
                    let mut command = tokio::process::Command::new(&parts[0]);
                    command.args(&parts[1..]);
                    for (k, v) in env {
                        command.env(k, v.as_str().context("Environment values must be strings")?);
                    }
                    let (process, stderr) = TokioChildProcess::builder(command)
                        .stderr(std::process::Stdio::piped())
                        .spawn()?;
                    if let Some(stderr) = stderr {
                        let rec = rec.clone();
                        tokio::spawn(async move {
                            use tokio::io::AsyncBufReadExt;
                            let mut lines = tokio::io::BufReader::new(stderr).lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                let _ = rec.record(
                                    "server_to_client",
                                    "stderr",
                                    "stderr",
                                    &json!({"line":line}),
                                    None,
                                    None,
                                );
                            }
                        });
                    }
                    Ok(client.serve_with_lifecycle(process, lifecycle).await?)
                }
                other => bail!("Unknown transport {other}"),
            }
        })
        .await
        .map_err(|_| anyhow!("Connection timed out after {}s", CONNECT_TIMEOUT.as_secs()))
        .and_then(|r| r);
        let service = match connected {
            Ok(s) => s,
            Err(e) => {
                let error = format!("{e:#}");
                rec.set_status("Failed", Some(&error))?;
                return Err(e);
            }
        };
        let latency = started.elapsed().as_millis() as i64;
        let peer = service.peer().clone();
        let info = serde_json::to_value(peer.peer_info().as_deref())?;
        lock(&commerce.db.0, "database")?.execute(
            "UPDATE inspector_connections SET status='Connected',server_info=?2,error=NULL,updated_at=?3 WHERE connection_id=?1",
            params![connection_id, info.to_string(), now()],
        )?;
        rec.record(
            "server_to_client",
            "handshake",
            "handshake",
            &info,
            None,
            Some(latency),
        )?;
        rec.emit("inspector.connection");
        let connection = Arc::new(Connection {
            service: tokio::sync::Mutex::new(Some(service)),
            peer,
            rec,
            roots,
            listeners: Default::default(),
        });
        self.connections
            .write()
            .await
            .insert(connection_id.clone(), connection);
        Ok(
            json!({"connection_id":connection_id,"status":"Connected","server_info":info,"handshake_ms":latency}),
        )
    }

    async fn get(&self, connection_id: &str) -> Result<Arc<Connection>> {
        self.connections
            .read()
            .await
            .get(connection_id)
            .cloned()
            .context("Inspector connection is not live")
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<Value> {
        let connection = self
            .connections
            .write()
            .await
            .remove(connection_id)
            .context("Inspector connection is not live")?;
        for handle in lock(&connection.listeners, "listeners")?.drain(..) {
            handle.abort();
        }
        // Dropping the senders fails every server request still waiting on this connection.
        lock(&self.pending, "pending")?.retain(|_, (c, _)| c != connection_id);
        if let Some(service) = connection.service.lock().await.take() {
            let _ = service.cancel().await;
        }
        connection.rec.set_status("Disconnected", None)?;
        Ok(json!({"connection_id":connection_id,"status":"Disconnected"}))
    }

    /// Sends one client request built from a JSON-RPC method name and params.
    pub async fn request(&self, body: &Value) -> Result<Value> {
        let connection = self
            .get(
                body["connection_id"]
                    .as_str()
                    .context("Missing connection_id")?,
            )
            .await?;
        let method = body["method"].as_str().context("Missing method")?;
        let mut envelope = json!({"method":method});
        if let Some(params) = body.get("params").filter(|p| !p.is_null()) {
            envelope["params"] = params.clone();
        }
        let request: ClientRequest = serde_json::from_value(envelope.clone())
            .with_context(|| format!("Params do not match the {method} request schema"))?;
        // The SDK's untagged union falls back to a custom request; for a standard
        // method that only happens when the params do not fit its schema.
        if matches!(request, ClientRequest::CustomRequest(_)) && STANDARD_REQUESTS.contains(&method)
        {
            bail!("Params do not match the {method} request schema");
        }
        let timeout_ms = body["timeout_ms"]
            .as_u64()
            .unwrap_or(60_000)
            .clamp(1, MAX_REQUEST_TIMEOUT_MS);
        // Record exactly what rmcp will send, without the transport metadata it adds.
        let sent = serde_json::to_value(&request)?;
        let request_message =
            connection
                .rec
                .record("client_to_server", "request", method, &sent, None, None)?;
        let started = Instant::now();
        let outcome = tokio::time::timeout(
            Duration::from_millis(timeout_ms),
            connection.peer.send_request(request),
        )
        .await;
        let latency = started.elapsed().as_millis() as i64;
        let (kind, value) = match outcome {
            Ok(Ok(result)) => ("response", serde_json::to_value(&result)?),
            Ok(Err(ServiceError::McpError(e))) => ("error", serde_json::to_value(&e)?),
            Ok(Err(e)) => ("error", json!({"message":e.to_string()})),
            Err(_) => (
                "error",
                json!({"message":format!("No response within {timeout_ms} ms")}),
            ),
        };
        let message_id = connection.rec.record(
            "server_to_client",
            kind,
            method,
            &value,
            Some(request_message),
            Some(latency),
        )?;
        Ok(
            json!({"kind":kind,"result":value,"latency_ms":latency,"request_message_id":request_message,"message_id":message_id}),
        )
    }

    pub async fn notify(&self, body: &Value) -> Result<Value> {
        let connection = self
            .get(
                body["connection_id"]
                    .as_str()
                    .context("Missing connection_id")?,
            )
            .await?;
        let method = body["method"].as_str().context("Missing method")?;
        let mut envelope = json!({"method":method});
        if let Some(params) = body.get("params").filter(|p| !p.is_null()) {
            envelope["params"] = params.clone();
        }
        let notification: ClientNotification = serde_json::from_value(envelope)
            .with_context(|| format!("Params do not match the {method} notification schema"))?;
        if matches!(notification, ClientNotification::CustomNotification(_))
            && method.starts_with("notifications/")
            && STANDARD_NOTIFICATIONS.contains(&method)
        {
            bail!("Params do not match the {method} notification schema");
        }
        let sent = serde_json::to_value(&notification)?;
        connection.peer.send_notification(notification).await?;
        let id = connection.rec.record(
            "client_to_server",
            "notification",
            method,
            &sent,
            None,
            None,
        )?;
        Ok(json!({"message_id":id}))
    }

    /// Replaces the roots answered to `roots/list`, then tells the server.
    pub async fn set_roots(&self, body: &Value) -> Result<Value> {
        let connection = self
            .get(
                body["connection_id"]
                    .as_str()
                    .context("Missing connection_id")?,
            )
            .await?;
        let roots: Vec<Root> = serde_json::from_value(body["roots"].clone())
            .context("Roots must be a list of {uri, name?}")?;
        let count = roots.len();
        *lock(&connection.roots, "roots")? = roots;
        let notification = ClientNotification::RootsListChangedNotification(Default::default());
        let sent = serde_json::to_value(&notification)?;
        let delivered = connection.peer.send_notification(notification).await;
        connection.rec.record(
            "client_to_server",
            if delivered.is_ok() {
                "notification"
            } else {
                "error"
            },
            "notifications/roots/list_changed",
            &match &delivered {
                Ok(_) => sent,
                Err(e) => json!({"message":e.to_string()}),
            },
            None,
            None,
        )?;
        delivered?;
        Ok(json!({"roots":count}))
    }

    /// Opens a 2026-07-28 `subscriptions/listen` stream and records what it delivers.
    pub async fn listen(&self, body: &Value) -> Result<Value> {
        let connection = self
            .get(
                body["connection_id"]
                    .as_str()
                    .context("Missing connection_id")?,
            )
            .await?;
        let mut builder = SubscriptionFilter::builder();
        let wants = |k: &str| body[k].as_bool().unwrap_or(false);
        if wants("tools") {
            builder = builder.tools_list_changed();
        }
        if wants("prompts") {
            builder = builder.prompts_list_changed();
        }
        if wants("resources") {
            builder = builder.resources_list_changed();
        }
        if let Some(uris) = body["resource_uris"].as_array() {
            for uri in uris.iter().filter_map(Value::as_str) {
                builder = builder.resource_subscription(uri);
            }
        }
        let filter = builder.build();
        let requested = serde_json::to_value(&filter)?;
        let request_message = connection.rec.record(
            "client_to_server",
            "request",
            "subscriptions/listen",
            &json!({"method":"subscriptions/listen","params":{"notifications":requested}}),
            None,
            None,
        )?;
        let started = Instant::now();
        let mut subscription = match connection.peer.listen(filter).await {
            Ok(s) => s,
            Err(e) => {
                connection.rec.record(
                    "server_to_client",
                    "error",
                    "subscriptions/listen",
                    &json!({"message":e.to_string()}),
                    Some(request_message),
                    Some(started.elapsed().as_millis() as i64),
                )?;
                return Err(e.into());
            }
        };
        let acknowledged = serde_json::to_value(subscription.acknowledged())?;
        connection.rec.record(
            "server_to_client",
            "response",
            "subscriptions/listen",
            &json!({"acknowledged":acknowledged}),
            Some(request_message),
            Some(started.elapsed().as_millis() as i64),
        )?;
        let rec = connection.rec.clone();
        let handle = tokio::spawn(async move {
            loop {
                match subscription.next().await {
                    Ok(Some(n)) => {
                        let body = serde_json::to_value(&n).unwrap_or(Value::Null);
                        let method = body["method"].as_str().unwrap_or("unknown").to_owned();
                        let _ = rec.record(
                            "server_to_client",
                            "notification",
                            &method,
                            &body,
                            Some(request_message),
                            None,
                        );
                    }
                    Ok(None) => {
                        let _ = rec.record(
                            "server_to_client",
                            "notification",
                            "subscriptions/end",
                            &json!({"end":subscription.end().map(|e| format!("{e:?}"))}),
                            Some(request_message),
                            None,
                        );
                        break;
                    }
                    Err(e) => {
                        let _ = rec.record(
                            "server_to_client",
                            "error",
                            "subscriptions/listen",
                            &json!({"message":e.to_string()}),
                            Some(request_message),
                            None,
                        );
                        break;
                    }
                }
            }
        });
        lock(&connection.listeners, "listeners")?.push(handle);
        Ok(json!({"acknowledged":acknowledged}))
    }

    /// Answers a parked server-initiated request.
    pub fn answer(&self, body: &Value) -> Result<Value> {
        let request_id = body["request_id"].as_str().context("Missing request_id")?;
        let (_, sender) = lock(&self.pending, "pending")?
            .remove(request_id)
            .context("That server request is no longer waiting")?;
        let answer = match body["reject"].as_str() {
            Some(reason) => Err(reason.to_owned()),
            None => Ok(body["result"].clone()),
        };
        sender
            .send(answer)
            .map_err(|_| anyhow!("The server request ended before the answer was delivered"))?;
        Ok(json!({"request_id":request_id,"delivered":true}))
    }

    pub async fn state(
        &self,
        db: &Database,
        connection: Option<&str>,
        after: i64,
    ) -> Result<Value> {
        let live: Vec<String> = self.connections.read().await.keys().cloned().collect();
        let conn = lock(&db.0, "database")?;
        let mut stmt = conn.prepare("SELECT connection_id,label,transport,target,lifecycle,header_names,env_names,status,server_info,error,created_at,updated_at FROM inspector_connections ORDER BY created_at DESC LIMIT 100")?;
        let parse = |s: Option<String>| s.and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let connections = stmt
            .query_map([], |r| {
                let cid: String = r.get(0)?;
                Ok(json!({"connection_id":cid,"label":r.get::<_,String>(1)?,"transport":r.get::<_,String>(2)?,"target":r.get::<_,String>(3)?,"lifecycle":r.get::<_,String>(4)?,"header_names":parse(r.get(5)?),"env_names":parse(r.get(6)?),"status":r.get::<_,String>(7)?,"server_info":parse(r.get(8)?),"error":r.get::<_,Option<String>>(9)?,"created_at":r.get::<_,i64>(10)?,"updated_at":r.get::<_,i64>(11)?,"live":live.contains(&cid)}))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let (messages, requests) = match connection {
            Some(cid) => {
                let mut stmt = conn.prepare("SELECT message_id,direction,kind,method,body,reply_to,latency_ms,created_at_ms FROM inspector_messages WHERE connection_id=?1 AND message_id>?2 ORDER BY message_id DESC LIMIT 1000")?;
                let mut messages = stmt
                    .query_map(params![cid, after], |r| {
                        Ok(json!({"message_id":r.get::<_,i64>(0)?,"direction":r.get::<_,String>(1)?,"kind":r.get::<_,String>(2)?,"method":r.get::<_,String>(3)?,"body":parse(r.get(4)?),"reply_to":r.get::<_,Option<i64>>(5)?,"latency_ms":r.get::<_,Option<i64>>(6)?,"created_at_ms":r.get::<_,i64>(7)?}))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                messages.reverse();
                let mut stmt = conn.prepare("SELECT request_id,method,params,status,response,created_at,answered_at FROM inspector_server_requests WHERE connection_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT 200")?;
                let requests = stmt
                    .query_map([cid], |r| {
                        Ok(json!({"request_id":r.get::<_,String>(0)?,"method":r.get::<_,String>(1)?,"params":parse(r.get(2)?),"status":r.get::<_,String>(3)?,"response":parse(r.get(4)?),"created_at":r.get::<_,i64>(5)?,"answered_at":r.get::<_,Option<i64>>(6)?}))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                (messages, requests)
            }
            None => (vec![], vec![]),
        };
        Ok(json!({"connections":connections,"messages":messages,"server_requests":requests}))
    }
}
