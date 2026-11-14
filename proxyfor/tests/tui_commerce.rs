use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{
        Commerce,
        bundler::{self, Bundle},
        db::{Database, now},
        tui::Workbench,
    },
};
use ratatui::{Terminal, backend::TestBackend};
use serde_json::json;
fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
async fn type_text(ui: &mut Workbench, text: &str) {
    for c in text.chars() {
        ui.key(key(KeyCode::Char(c))).await;
    }
    ui.key(key(KeyCode::Enter)).await;
}
async fn setup(
    model: Option<std::path::PathBuf>,
) -> Result<(tempfile::TempDir, std::sync::Arc<Commerce>)> {
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("db"))?;
    db.record_session(
        "tui-session",
        "tui-session",
        &json!({"clientInfo":{"name":"TUI recorded session"},"protocolVersion":"2026-07-28"}),
        "stdio",
    )?;
    let engine = ClefEngine::load(ClefConfig {
        model,
        backend: "cpu".into(),
        threads: 4,
        workers: 1,
        cache_dir: dir.path().join("cache"),
    })
    .await?;
    let rt = Commerce::new(db, engine, dir.path(), false)?.0;
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
    Ok((dir, rt))
}
#[tokio::test]
async fn seeded_database_render_and_keyboard_transitions() -> Result<()> {
    let (dir, rt) = setup(None).await?;
    let mut ui = Workbench::new(rt.clone(), true)?;
    let mut terminal = Terminal::new(TestBackend::new(160, 45))?;
    terminal.draw(|f| ui.render(f))?;
    let screen = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect::<String>();
    assert!(
        screen.contains("OUTRIDER")
            && screen.contains("Unconfigured")
            && screen.contains("TUI recorded session")
    );
    ui.key(key(KeyCode::Char('e'))).await;
    assert!(ui.status.contains("Unconfigured"));
    assert_eq!(rt.db.rows("clef_evaluations")?, json!([]));
    ui.key(key(KeyCode::Char('p'))).await;
    assert!(ui.status.contains("MCP 2026"));
    assert_eq!(rt.db.rows("probe_runs")?, json!([]));
    ui.key(key(KeyCode::Char('s'))).await;
    assert_eq!(rt.db.rows("session_offers")?.as_array().unwrap().len(), 1);
    ui.key(key(KeyCode::Char('i'))).await;
    type_text(&mut ui, &format!("evidence 3 {}", now() + 600)).await;
    assert!(ui.status.starts_with("Persisted"), "{}", ui.status);
    assert_eq!(rt.db.rows("capability_receipts")?[0]["remaining_calls"], 3);
    ui.key(key(KeyCode::Char('r'))).await;
    assert_eq!(rt.db.rows("capability_receipts")?[0]["revoked"], 1);
    ui.key(key(KeyCode::Char('u'))).await;
    type_text(
        &mut ui,
        &format!(
            "child {} --stdio --config-dir {} --probe-policy off",
            shell_words::quote(env!("CARGO_BIN_EXE_outrider")),
            shell_words::quote(dir.path().join("child").to_str().unwrap())
        ),
    )
    .await;
    assert!(ui.status.starts_with("Persisted"), "{}", ui.status);
    assert_eq!(rt.db.rows("upstream_servers")?[0]["status"], "Connected");
    ui.key(key(KeyCode::Tab)).await;
    ui.key(key(KeyCode::Char(']'))).await;
    ui.key(key(KeyCode::Down)).await;
    terminal.draw(|f| ui.render(f))?;
    let mut locked = Workbench::new(rt.clone(), false)?;
    locked.key(key(KeyCode::Char('i'))).await;
    assert!(locked.status.contains("Admin token required"));
    assert!(locked.input.is_none());
    Ok(())
}
#[tokio::test]
#[ignore = "requires OUTRIDER_CLEF_MODEL; run --ignored --nocapture"]
async fn real_model_tui_evaluation_updates_sqlite() -> Result<()> {
    let model = std::env::var_os("OUTRIDER_CLEF_MODEL").expect("OUTRIDER_CLEF_MODEL unset");
    let (_dir, rt) = setup(Some(model.into())).await?;
    let mut ui = Workbench::new(rt.clone(), true)?;
    ui.key(key(KeyCode::Char('e'))).await;
    assert!(ui.status.starts_with("Persisted"), "{}", ui.status);
    assert_eq!(rt.db.rows("clef_evaluations")?[0]["status"], "Verified");
    assert!(rt.db.rows("clef_evaluations")?[0]["option_scores"].is_null());
    Ok(())
}
