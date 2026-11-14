use anyhow::Result;
use proxyfor::{clef::{engine::{ClefConfig,ClefEngine,EngineStatus},schema::Question,scorer::evaluate_session},commerce::db::Database};
use rmcp::{ServerHandler,ServiceExt,model::*,service::{RequestContext,RoleServer}};
use serde_json::json;

#[derive(Clone)]
struct Recorder(Database);
impl ServerHandler for Recorder {
    async fn initialize(&self, request: InitializeRequestParams, context: RequestContext<RoleServer>) -> Result<InitializeResult,ErrorData> {
        self.0.record_session("live-session","live-session",&serde_json::to_value(&request).unwrap(),"duplex").map_err(|e| ErrorData::internal_error(e.to_string(),None))?;
        context.peer.set_peer_info(request.clone());
        self.negotiate_initialize(&request)
    }
}
fn config(model: Option<std::path::PathBuf>, dir: &std::path::Path) -> ClefConfig {
    ClefConfig {model,backend:"cpu".into(),threads:4,cache_dir:dir.into(),workers:1}
}
#[tokio::test]
#[ignore = "requires real model: OUTRIDER_CLEF_MODEL=<path.litertlm> cargo test -p proxyfor --test clef_litertlm_e2e -- --ignored --nocapture"]
async fn real_model_persists_all_question_types() -> Result<()> {
    let Some(model) = std::env::var_os("OUTRIDER_CLEF_MODEL") else { anyhow::bail!("OUTRIDER_CLEF_MODEL unset; live model gate cannot run"); };
    let temp = tempfile::tempdir()?;
    let db = Database::open(temp.path().join("test.db"))?;
    let (server,client) = tokio::io::duplex(65536);
    let recorder = Recorder(db.clone());
    let serving = tokio::spawn(async move { recorder.serve(server).await.unwrap().waiting().await });
    let client = ().serve(client).await?;
    assert!(db.session_record("live-session")?["initialize"]["clientInfo"].is_object());
    let engine = ClefEngine::load(config(Some(model.into()),temp.path())).await?;
    assert!(matches!(engine.status(),EngineStatus::Ready{..}), "{:?}",engine.status());
    for question in [Question::Noul {question:"Does this record contain clientInfo?".into()},Question::Choice {question:"Select the recorded transport".into(),options:vec!["duplex".into(),"http".into()]},Question::Score {question:"Rate evidence completeness between 0 and 5".into(),min:0,max:5}] {
        let row = evaluate_session(&db,&engine,"live-session",question.clone()).await?;
        assert_eq!(row["status"],"Verified","{row}");
        question.validate(&json!({"pick":row["pick"]}))?;
        assert!(row["option_scores"].is_null());
        let input = row["rendered_input"].as_str().unwrap();
        assert_eq!(row["input_tokens"].as_u64().unwrap(),engine.tokenize(input)? as u64);
        assert_eq!(row["output_tokens"].as_u64().unwrap(),engine.tokenize(row["raw_output"].as_str().unwrap())? as u64);
        assert!(row["latency_ms"].as_i64().unwrap()>0);
    }
    assert_eq!(db.evaluations("live-session")?.len(),3);
    client.cancel().await?;
    serving.await??;
    Ok(())
}
#[tokio::test]
async fn unconfigured_and_model_error_have_no_scores_or_tokens() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let db = Database::open(temp.path().join("test.db"))?;
    db.record_session("s","s",&json!({}),"stdio")?;
    for model in [None,Some(temp.path().join("missing.litertlm"))] {
        let engine = ClefEngine::load(config(model,temp.path())).await?;
        let row = evaluate_session(&db,&engine,"s",Question::Noul {question:"Any evidence?".into()}).await?;
        assert!(["Unconfigured","ModelError"].contains(&row["status"].as_str().unwrap()));
        for field in ["pick","input_tokens","output_tokens","option_scores"] {assert!(row[field].is_null());}
    }
    Ok(())
}
