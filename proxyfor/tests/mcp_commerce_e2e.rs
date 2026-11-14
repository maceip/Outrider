mod common;
use anyhow::{Context, Result};
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{
        Commerce,
        bundler::{self, Bundle},
        db::{Database, now},
    },
};
use rmcp::{
    ClientLifecycleMode, ClientServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
fn retry(state: &str, token: Option<&str>) -> CallToolRequestParams {
    let mut r = CallToolRequestParams::new("up__outrider_catalog");
    r.request_state = Some(state.into());
    if let Some(token) = token {
        r.input_responses = Some(
            [(
                "capability_receipt".into(),
                serde_json::to_value(
                    ElicitResult::new(ElicitationAction::Accept)
                        .with_content(json!({"receipt":token})),
                )
                .unwrap(),
            )]
            .into(),
        );
    }
    r
}
#[tokio::test]
async fn real_child_upstream_http_mrtr_receipts_skills_subscriptions_and_tasks() -> Result<()> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let dir = tempfile::tempdir()?;
    let db_path = dir.path().join("outrider.db");
    let db = Database::open(&db_path)?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().into(),
        workers: 1,
    })
    .await?;
    let (rt, _) = Commerce::new(db, engine, dir.path(), false)?;
    *rt.probe_policy.write().unwrap() = proxyfor::fingerprint::active::ProbePolicy::Off;
    let child_config = dir.path().join("upstream");
    let command = format!(
        "{} --stdio --probe-policy off --config-dir {}",
        shell_words::quote(env!("CARGO_BIN_EXE_outrider")),
        shell_words::quote(child_config.to_str().unwrap())
    );
    rt.federation
        .connect(&rt, "up", &command, "admin:test")
        .await?;
    let skill_dir = dir.path().join("skills/research");
    std::fs::create_dir_all(&skill_dir)?;
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: research\ndescription: Read the recorded MCP catalog and its evidence.\n---\nUse actual catalog evidence.\n",
    )?;
    rt.load_skills(&dir.path().join("skills"), "admin:test")?;
    bundler::put_bundle(
        &rt.db,
        &Bundle {
            bundle_id: "research".into(),
            title: "Research tools and skill".into(),
            items: vec![
                "up__outrider_catalog".into(),
                "skill://research/SKILL.md".into(),
            ],
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
    // The header value is the client's secret; receipts bind to the derived public id.
    let session = uuid::Uuid::new_v4().to_string();
    let subject = proxyfor::mcp_gateway::handler::public_session_id(&session);
    assert_ne!(subject, session);
    let mut cfg = StreamableHttpClientTransportConfig::with_uri(format!("http://{addr}/mcp"));
    cfg.custom_headers
        .insert("outrider-session-id".parse()?, session.parse()?);
    let transport = StreamableHttpClientTransport::with_client(rmcp_http_client()?, cfg.clone());
    let client = ClientConfig::new(
        ClientCapabilities::builder().enable_elicitation().build(),
        Implementation::new("commerce-integration", "1"),
    )
    .serve_with_lifecycle(
        transport,
        ClientLifecycleMode::Discover {
            preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        },
    )
    .await?;
    let tools = client.list_all_tools().await?;
    assert!(!tools.iter().any(|t| t.name == "up__outrider_catalog"));
    assert!(client.list_all_skills().await?.is_empty());
    let mut subscription = client
        .listen(SubscriptionFilter::builder().tools_list_changed().build())
        .await?;
    // Unrelated activity, another session's redemption, and an admin change that leaves
    // this session's tools untouched must not announce a tool-list change.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    rt.changed("traffic.persisted", None);
    rt.changed("websocket.persisted", None);
    rt.changed("receipt.redeemed", Some("another-session"));
    rt.changed("/offers/synthesize", None);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), subscription.next())
            .await
            .is_err(),
        "tool-list notification sent although this session's tool list did not change"
    );
    let state = match client
        .call_tool_once(CallToolRequestParams::new("up__outrider_catalog"))
        .await?
    {
        CallToolResponse::InputRequired(r) => {
            let message = serde_json::to_string(&r.input_requests)?;
            assert!(message.contains("skill://research/SKILL.md"));
            r.request_state.context("Missing requestState")?
        }
        r => anyhow::bail!("Expected MRTR quote, got {r:?}"),
    };
    assert!(client.call_tool_once(retry(&state, None)).await.is_err());
    let mut tampered = state.clone().into_bytes();
    let i = tampered.len() / 2;
    tampered[i] = if tampered[i] == b'A' { b'B' } else { b'A' };
    assert!(
        client
            .call_tool_once(retry(std::str::from_utf8(&tampered)?, None))
            .await
            .is_err()
    );
    let wrong = rt
        .receipts
        .issue("other", "research", 5, now() + 600, "admin:test")?;
    assert!(
        client
            .call_tool_once(retry(&state, Some(&wrong.encode()?)))
            .await
            .is_err()
    );
    let valid = rt
        .receipts
        .issue(&subject, "research", 8, now() + 600, "admin:test")?;
    let mut forged = valid.clone();
    forged.receipt.max_calls = 100;
    assert!(
        client
            .call_tool_once(retry(&state, Some(&forged.encode()?)))
            .await
            .is_err()
    );
    let revoked = rt
        .receipts
        .issue(&subject, "research", 2, now() + 600, "admin:test")?;
    rt.receipts
        .revoke(&revoked.receipt.receipt_id, "admin:test")?;
    assert!(
        client
            .call_tool_once(retry(&state, Some(&revoked.encode()?)))
            .await
            .is_err()
    );
    let expired = rt
        .receipts
        .issue(&subject, "research", 1, now() + 1, "admin:test")?;
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert!(
        client
            .call_tool_once(retry(&state, Some(&expired.encode()?)))
            .await
            .is_err()
    );
    assert_eq!(
        rt.db.rows("receipt_redemptions")?.as_array().unwrap().len(),
        0
    );
    let result = client
        .call_tool_once(retry(&state, Some(&valid.encode()?)))
        .await?;
    let result = match result {
        CallToolResponse::Complete(r) => r,
        r => anyhow::bail!("Expected complete federated call, got {r:?}"),
    };
    assert!(
        result.content[0]
            .as_text()
            .unwrap()
            .text
            .contains("catalog")
    );
    assert!(
        client
            .call_tool_once(retry(&state, Some(&valid.encode()?)))
            .await
            .is_err()
    );
    assert_eq!(
        rt.db.rows("receipt_redemptions")?.as_array().unwrap().len(),
        1
    );
    tokio::time::timeout(std::time::Duration::from_secs(5), subscription.next())
        .await??
        .context("No list-changed notification")?;
    assert!(
        client
            .list_all_tools()
            .await?
            .iter()
            .any(|t| t.name == "up__outrider_catalog")
    );
    let skills = client.list_all_skills().await?;
    assert_eq!(skills.len(), 1);
    let skill = client
        .get_skill(GetSkillRequestParams::new("skill://research/SKILL.md"))
        .await?;
    assert_eq!(skill.skill.uri, "skill://research/SKILL.md");
    let read = client
        .read_resource(ReadResourceRequestParams::new("skill://research/SKILL.md"))
        .await?;
    assert!(!read.contents.is_empty());
    // The session id Outrider reports is a digest. Replaying it as Outrider-Session-Id
    // names a different session: no entitled tools, no skills, and no redemption.
    let catalog = match client
        .call_tool_once(CallToolRequestParams::new("outrider_catalog"))
        .await?
    {
        CallToolResponse::Complete(r) => r.content[0].as_text().unwrap().text.clone(),
        r => anyhow::bail!("Expected catalog, got {r:?}"),
    };
    assert_eq!(
        serde_json::from_str::<Value>(&catalog)?["session_id"],
        subject
    );
    let mut replay_cfg = cfg.clone();
    replay_cfg
        .custom_headers
        .insert("outrider-session-id".parse()?, subject.parse()?);
    let replay = ClientConfig::default()
        .serve_with_lifecycle(
            StreamableHttpClientTransport::with_client(rmcp_http_client()?, replay_cfg),
            ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
        )
        .await?;
    assert!(
        !replay
            .list_all_tools()
            .await?
            .iter()
            .any(|t| t.name == "up__outrider_catalog")
    );
    assert!(replay.list_all_skills().await?.is_empty());
    assert!(matches!(
        replay
            .call_tool_once(CallToolRequestParams::new("up__outrider_catalog"))
            .await?,
        CallToolResponse::InputRequired(_)
    ));
    assert_eq!(
        rt.db.rows("receipt_redemptions")?.as_array().unwrap().len(),
        1
    );
    // A secret supplied through _meta reaches persisted state only as its digest.
    let meta_secret = uuid::Uuid::new_v4().to_string();
    let mut meta_req = CallToolRequestParams::new("outrider_catalog");
    let mut meta = RequestMetaObject::new();
    meta.0.insert(
        "outrider/session_id".into(),
        Value::String(meta_secret.clone()),
    );
    meta_req.meta = Some(meta);
    replay.call_tool_once(meta_req).await?;
    replay.cancel().await?;
    let persisted = rt.snapshot()?.to_string();
    assert!(persisted.contains(&subject));
    assert!(
        persisted.contains(&proxyfor::mcp_gateway::handler::public_session_id(
            &meta_secret
        ))
    );
    assert!(
        !persisted.contains(&session) && !persisted.contains(&meta_secret),
        "a client session secret was persisted"
    );
    // Another valid HMAC quote is expired in persistent state; no redemption follows.
    let locked = uuid::Uuid::new_v4().to_string();
    let locked_subject = proxyfor::mcp_gateway::handler::public_session_id(&locked);
    let mut other_cfg = cfg.clone();
    other_cfg
        .custom_headers
        .insert("outrider-session-id".parse()?, locked.parse()?);
    let other = ClientConfig::default()
        .serve_with_lifecycle(
            StreamableHttpClientTransport::with_client(rmcp_http_client()?, other_cfg),
            ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
        )
        .await?;
    let old = match other
        .call_tool_once(CallToolRequestParams::new("up__outrider_catalog"))
        .await?
    {
        CallToolResponse::InputRequired(r) => r.request_state.unwrap(),
        _ => unreachable!(),
    };
    let quote: proxyfor::mcp_gateway::mrtr_checkout::QuoteCheckoutState =
        rt.codec.open_json(&old)?;
    rusqlite::Connection::open(&db_path)?.execute(
        "UPDATE mrtr_quotes SET expires_at_unix=?2 WHERE quote_id=?1",
        rusqlite::params![quote.quote_id, now() - 1],
    )?;
    let other_receipt =
        rt.receipts
            .issue(&locked_subject, "research", 1, now() + 600, "admin:test")?;
    assert!(
        other
            .call_tool_once(retry(&old, Some(&other_receipt.encode()?)))
            .await
            .is_err()
    );
    // Exhaust a one-call receipt, then prove it cannot execute again.
    // Also configure an alphabetically earlier bundle sharing the same tool to prove multi-bundle lookup matches the caller's receipt bundle.
    bundler::put_bundle(
        &rt.db,
        &Bundle {
            bundle_id: "alpha-shared".into(),
            title: "Alphabetically earlier bundle sharing tool".into(),
            items: vec!["up__outrider_catalog".into()],
            rules: json!({}),
        },
        "admin:test",
    )?;
    let once = rt
        .receipts
        .issue(&locked_subject, "research", 1, now() + 600, "admin:test")?;
    let mut once_req = CallToolRequestParams::new("up__outrider_catalog");
    let mut meta = RequestMetaObject::new();
    meta.0
        .insert("outrider/receipt".into(), Value::String(once.encode()?));
    once_req.meta = Some(meta);
    assert!(other.call_tool_once(once_req.clone()).await.is_ok());
    assert!(other.call_tool_once(once_req).await.is_err());
    // Prove upstream execution failure refunds the reserved quota instead of burning remaining_calls.
    {
        let conn = rusqlite::Connection::open(&db_path)?;
        conn.execute(
            "INSERT INTO upstream_servers(name,endpoint,status,updated_at) VALUES ('dead','http://127.0.0.1:9/mcp','Disconnected',?1)",
            [now()],
        )?;
        let dead_tool = Tool::new(
            "dead__unreachable",
            "Unreachable upstream tool",
            std::sync::Arc::new(serde_json::Map::new()),
        );
        let dead_desc = json!({"tool": dead_tool, "remote_name": "unreachable"});
        conn.execute(
            "INSERT INTO catalog_items(item_id,kind,digest,descriptor,upstream_name) VALUES ('dead__unreachable','tool',?1,?2,'dead')",
            rusqlite::params![bundler::digest(&dead_desc)?, dead_desc.to_string()],
        )?;
    }
    bundler::put_bundle(
        &rt.db,
        &Bundle {
            bundle_id: "dead-bundle".into(),
            title: "Dead upstream bundle".into(),
            items: vec!["dead__unreachable".into()],
            rules: json!({}),
        },
        "admin:test",
    )?;
    let refundable =
        rt.receipts
            .issue(&locked_subject, "dead-bundle", 1, now() + 600, "admin:test")?;
    let mut dead_req = CallToolRequestParams::new("dead__unreachable");
    let mut dead_meta = RequestMetaObject::new();
    dead_meta.0.insert(
        "outrider/receipt".into(),
        Value::String(refundable.encode()?),
    );
    dead_req.meta = Some(dead_meta);
    let redemptions_before = rt.db.rows("receipt_redemptions")?.as_array().unwrap().len();
    assert!(other.call_tool_once(dead_req).await.is_err());
    assert_eq!(
        rt.receipts
            .verify(&refundable, &locked_subject, "dead-bundle")?,
        1,
        "failed upstream execution must refund remaining_calls"
    );
    assert_eq!(
        rt.db.rows("receipt_redemptions")?.as_array().unwrap().len(),
        redemptions_before
    );
    assert_eq!(
        rusqlite::Connection::open(&db_path)?.query_row(
            "SELECT COUNT(*) FROM admin_audit_log WHERE action='receipt.refund_failed_call' AND target=?1",
            [&refundable.receipt.receipt_id],
            |r| r.get::<_, i64>(0)
        )?,
        1
    );
    // Tasks use the same persisted entitlement and execute the real child upstream.
    let tasks = ClientConfig::new(
        ClientCapabilities::builder().enable_tasks().build(),
        Implementation::new("commerce-task-client", "1"),
    )
    .serve_with_lifecycle(
        StreamableHttpClientTransport::with_client(rmcp_http_client()?, cfg),
        ClientLifecycleMode::Discover {
            preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        },
    )
    .await?;
    let task = match tasks
        .call_tool_once(CallToolRequestParams::new("up__outrider_catalog"))
        .await?
    {
        CallToolResponse::Task(t) => t.task,
        _ => anyhow::bail!("Expected a real fulfillment task"),
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let t = tasks
                .get_task(GetTaskParams::new(task.task_id.clone()))
                .await
                .unwrap();
            if t.task.status().is_terminal() {
                assert_eq!(t.task.status(), TaskStatus::Completed);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await?;
    let upstream_db = rusqlite::Connection::open(child_config.join("outrider.db"))?;
    assert!(
        upstream_db.query_row(
            "SELECT COUNT(*) FROM mcp_frames WHERE method='tools/call'",
            [],
            |r| r.get::<_, i64>(0)
        )? >= 3
    );
    subscription.cancel().await?;
    tasks.cancel().await?;
    other.cancel().await?;
    client.cancel().await?;
    let _ = stop.send(());
    Ok(())
}
fn rmcp_http_client() -> Result<reqwest13::Client> {
    Ok(reqwest13::Client::builder().build()?)
}
