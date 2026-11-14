mod common;
use anyhow::{Context, Result};
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{
        Commerce,
        bundler::{self, Bundle},
        db::Database,
    },
};
use serde_json::{Value, json};

struct Admin {
    base: String,
    token: String,
    http: reqwest::Client,
}
impl Admin {
    async fn post(&self, path: &str, body: Value) -> Result<(u16, Value)> {
        let r = self
            .http
            .post(format!("{}/inspector/{path}", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await?;
        Ok((r.status().as_u16(), r.json().await?))
    }
    async fn state(&self, connection: &str) -> Result<Value> {
        Ok(self
            .http
            .get(format!(
                "{}/inspector/state?connection_id={connection}",
                self.base
            ))
            .bearer_auth(&self.token)
            .send()
            .await?
            .json()
            .await?)
    }
}

#[tokio::test]
async fn inspector_drives_stdio_and_http_servers_and_persists_every_message() -> Result<()> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let dir = tempfile::tempdir()?;
    let db_path = dir.path().join("outrider.db");
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().into(),
        workers: 1,
    })
    .await?;
    let (rt, token) = Commerce::new(Database::open(&db_path)?, engine, dir.path(), false)?;
    *rt.probe_policy.write().unwrap() = proxyfor::fingerprint::active::ProbePolicy::Off;
    rt.register_local_tools()?;
    bundler::put_bundle(
        &rt.db,
        &Bundle {
            bundle_id: "evidence".into(),
            title: "Session evidence".into(),
            items: vec!["outrider_session_evidence".into()],
            rules: json!({}),
        },
        "admin:test",
    )?;
    let server = proxyfor::server::ServerBuilder::new(common::build_ca()?)
        .commerce(rt.clone())
        .web(true)
        .build();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let stop = server.run(listener).await?;
    let admin = Admin {
        base: format!("http://{addr}/__proxyfor__/commerce"),
        token: token.context("first run prints a token")?,
        http: reqwest::Client::new(),
    };

    // Unauthenticated inspector calls are refused.
    let r = reqwest::Client::new()
        .post(format!("{}/inspector/connect", admin.base))
        .json(&json!({"transport":"stdio","target":"true"}))
        .send()
        .await?;
    assert_eq!(r.status().as_u16(), 401);

    // A stdio server: a child Outrider speaking MCP over stdin/stdout.
    let child = dir.path().join("child");
    let command = format!(
        "{} --stdio --probe-policy off --config-dir {}",
        shell_words::quote(env!("CARGO_BIN_EXE_outrider")),
        shell_words::quote(child.to_str().unwrap())
    );
    let (status, stdio) = admin
        .post(
            "connect",
            json!({"transport":"stdio","target":command,"label":"child","env":{"OUTRIDER_TEST_SECRET":"env-secret-value"}}),
        )
        .await?;
    assert_eq!(status, 200, "{stdio}");
    let sid = stdio["connection_id"].as_str().unwrap().to_owned();
    assert!(stdio["server_info"].is_object());
    let (status, tools) = admin
        .post("request", json!({"connection_id":sid,"method":"tools/list"}))
        .await?;
    assert_eq!(status, 200);
    assert_eq!(tools["kind"], "response");
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert!(names.contains(&"outrider_catalog"), "{names:?}");
    let (_, called) = admin
        .post(
            "request",
            json!({"connection_id":sid,"method":"tools/call","params":{"name":"outrider_catalog","arguments":{}}}),
        )
        .await?;
    assert_eq!(called["kind"], "response", "{called}");
    assert!(called["result"]["content"].is_array());
    // A JSON-RPC error from the server is reported as an error, not a success.
    let (_, missing) = admin
        .post(
            "request",
            json!({"connection_id":sid,"method":"prompts/get","params":{"name":"no-such-prompt"}}),
        )
        .await?;
    assert_eq!(missing["kind"], "error", "{missing}");
    // Malformed params never reach the server.
    let (status, bad) = admin
        .post(
            "request",
            json!({"connection_id":sid,"method":"tools/call","params":{"arguments":{}}}),
        )
        .await?;
    assert_eq!(status, 422, "{bad}");

    // An HTTP server: this gateway's own /mcp, which answers with an MRTR checkout.
    let session = uuid::Uuid::new_v4().to_string();
    let (status, http) = admin
        .post(
            "connect",
            json!({"transport":"http","target":format!("http://{addr}/mcp"),"lifecycle":"2026-07-28","headers":{"Outrider-Session-Id":session}}),
        )
        .await?;
    assert_eq!(status, 200, "{http}");
    let hid = http["connection_id"].as_str().unwrap().to_owned();
    let (_, listen) = admin
        .post("listen", json!({"connection_id":hid,"tools":true}))
        .await?;
    assert!(listen["acknowledged"].is_object(), "{listen}");
    let (_, quote) = admin
        .post(
            "request",
            json!({"connection_id":hid,"method":"tools/call","params":{"name":"outrider_checkout_bundle","arguments":{"bundle_id":"evidence"}}}),
        )
        .await?;
    assert_eq!(quote["result"]["resultType"], "input_required", "{quote}");
    let state = quote["result"]["requestState"].as_str().unwrap().to_owned();
    // Resuming with a declined elicitation returns the gateway's actual answer.
    let key = quote["result"]["inputRequests"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let (_, resumed) = admin
        .post(
            "request",
            json!({"connection_id":hid,"method":"tools/call","params":{"name":"outrider_checkout_bundle","arguments":{"bundle_id":"evidence"},"requestState":state,"inputResponses":{key:{"action":"decline"}}}}),
        )
        .await?;
    assert_ne!(resumed["result"]["resultType"], "input_required", "{resumed}");

    // Every exchange is persisted, paired, and timed.
    let recorded = admin.state(&sid).await?;
    let messages = recorded["messages"].as_array().unwrap();
    let requests: Vec<&Value> = messages.iter().filter(|m| m["kind"] == "request").collect();
    assert!(requests.len() >= 3);
    for request in requests {
        let id = request["message_id"].as_i64().unwrap();
        let reply = messages
            .iter()
            .find(|m| m["reply_to"] == id)
            .context("every request has a recorded reply")?;
        assert!(reply["latency_ms"].as_i64().is_some());
    }
    // Header and environment values are never stored; only their names.
    let raw = std::fs::read(&db_path)?;
    let wal = std::fs::read(dir.path().join("outrider.db-wal")).unwrap_or_default();
    for bytes in [&raw, &wal] {
        let text = String::from_utf8_lossy(bytes);
        assert!(!text.contains("env-secret-value"));
        assert!(!text.contains(&session));
    }
    let connection = recorded["connections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["connection_id"] == sid)
        .unwrap();
    assert_eq!(connection["env_names"], json!(["OUTRIDER_TEST_SECRET"]));
    assert_eq!(connection["live"], true);

    // Answering a request that is not waiting fails instead of pretending.
    let (status, _) = admin
        .post("answer", json!({"request_id":"missing","result":{}}))
        .await?;
    assert_eq!(status, 422);

    for id in [&sid, &hid] {
        let (status, _) = admin.post("disconnect", json!({"connection_id":id})).await?;
        assert_eq!(status, 200);
    }
    let after = admin.state(&sid).await?;
    let connection = after["connections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["connection_id"] == sid)
        .unwrap();
    assert_eq!(connection["status"], "Disconnected");
    assert_eq!(connection["live"], false);
    let (status, _) = admin
        .post("request", json!({"connection_id":sid,"method":"ping"}))
        .await?;
    assert_eq!(status, 422);
    let _ = stop.send(());
    Ok(())
}
