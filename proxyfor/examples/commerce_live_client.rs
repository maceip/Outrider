//! A real MCP client for operator validation; sampling requires a real model.
#![allow(deprecated)]
use anyhow::{Context, Result};
use proxyfor::clef::{
    engine::{ClefConfig, ClefEngine, EngineStatus},
    schema::Question,
};
use rmcp::{
    ClientHandler, ClientLifecycleMode, ClientServiceExt,
    model::*,
    service::{RequestContext, RoleClient},
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
#[derive(Clone)]
struct LiveClient {
    engine: Arc<ClefEngine>,
}
impl ClientHandler for LiveClient {
    fn get_info(&self) -> ClientConfig {
        ClientConfig::new(
            if matches!(self.engine.status(), EngineStatus::Ready { .. }) {
                ClientCapabilities::builder().enable_sampling().build()
            } else {
                ClientCapabilities::default()
            },
            Implementation::new("Outrider live validation client", "1"),
        )
    }
    async fn create_message(
        &self,
        request: CreateMessageRequestParams,
        _: RequestContext<RoleClient>,
    ) -> Result<CreateMessageResult, ErrorData> {
        let prompt = serde_json::to_value(&request)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let result=self.engine.evaluate(Question::Choice{question:"Return the requested acknowledgment value for the Outrider capability probe.".into(),options:vec!["outrider".into()]},json!({"sampling_request":prompt})).await.map_err(|e|ErrorData::internal_error(e.to_string(),None))?;
        Ok(CreateMessageResult::new(
            SamplingMessage::assistant_text(json!({"ack":result.pick}).to_string()),
            serde_json::to_string(self.engine.status()).unwrap(),
        ))
    }
}
#[tokio::main]
async fn main() -> Result<()> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let uri = std::env::args().nth(1).context("Pass an MCP HTTP URL")?;
    let model = std::env::var_os("OUTRIDER_CLIENT_MODEL").map(PathBuf::from);
    let engine = Arc::new(
        ClefEngine::load(ClefConfig {
            model,
            backend: "cpu".into(),
            threads: 4,
            workers: 1,
            cache_dir: std::env::temp_dir()
                .join(format!("outrider-live-client-{}", std::process::id())),
        })
        .await?,
    );
    if matches!(engine.status(), EngineStatus::ModelError { .. }) {
        anyhow::bail!("{:?}", engine.status())
    }
    let mut config = StreamableHttpClientTransportConfig::with_uri(uri);
    let session = std::env::var("OUTRIDER_CLIENT_SESSION")
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
    config
        .custom_headers
        .insert("outrider-session-id".parse()?, session.parse()?);
    let client = LiveClient { engine }
        .serve_with_lifecycle(
            StreamableHttpClientTransport::with_client(
                reqwest13::Client::builder().build()?,
                config,
            ),
            ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
        )
        .await?;
    let catalog = client
        .call_tool(CallToolRequestParams::new("outrider_catalog"))
        .await?;
    println!(
        "{}",
        catalog.content[0]
            .as_text()
            .context("No catalog text")?
            .text
    );
    let mut subscription = client
        .listen(SubscriptionFilter::builder().tools_list_changed().build())
        .await?;
    if let Some(path) = std::env::var_os("OUTRIDER_CLIENT_READY") {
        std::fs::write(path, session)?;
    }
    loop {
        tokio::select! {_=tokio::signal::ctrl_c()=>break,event=subscription.next()=>{if event?.is_none(){break}}}
    }
    subscription.cancel().await?;
    client.cancel().await?;
    Ok(())
}
