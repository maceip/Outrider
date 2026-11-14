mod common;
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{Commerce, db::Database},
    server::{PrintMode, ServerBuilder},
};
use tokio_tungstenite::tungstenite::Message;
#[tokio::test]
async fn captured_http_and_websocket_records_survive_database_reopen() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("state.db");
    let db = Database::open(&path)?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        workers: 1,
        cache_dir: dir.path().into(),
    })
    .await?;
    let rt = Commerce::new(db, engine, dir.path(), false)?.0;
    let (upstream, stop_upstream) = common::start_http_server().await?;
    let server = ServerBuilder::new(common::build_ca()?)
        .commerce(rt.clone())
        .print_mode(PrintMode::Nothing)
        .reverse_proxy_url(Some(format!("http://{upstream}")))
        .build();
    let (addr, stop) = common::run_proxy_server(server).await?;
    let client = common::build_client()?;
    assert_eq!(
        client
            .get(format!("http://{addr}/hello"))
            .send()
            .await?
            .text()
            .await?,
        common::HELLO_WORLD
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/")).await?;
    ws.send(Message::Text("hello".into())).await?;
    assert_eq!(ws.next().await.unwrap()?.to_string(), common::WORLD);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let traffic = rt.db.rows("proxy_traffic").unwrap();
            let messages = rt.db.rows("proxy_websocket_messages").unwrap();
            if traffic.as_array().unwrap().iter().any(|t| {
                t["head"]["status"] == 200 && t["detail"].to_string().contains(common::HELLO_WORLD)
            }) && messages.as_array().unwrap().len() >= 2
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await?;
    ws.close(None).await?;
    let _ = stop.send(());
    let _ = stop_upstream.send(());
    let reopened = Database::open(&path)?;
    let traffic = reopened.rows("proxy_traffic")?;
    assert!(
        traffic
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["head"]["status"] == 200)
    );
    let messages = reopened.rows("proxy_websocket_messages")?;
    assert!(messages.to_string().contains("hello") && messages.to_string().contains(common::WORLD));
    Ok(())
}
