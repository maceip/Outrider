use super::{
    engine::{ClefEngine, EngineStatus},
    schema::Question,
};
use crate::commerce::db::{Database, id, now};
use anyhow::Result;
use rusqlite::params;
use serde_json::Value;

pub async fn evaluate_session(
    db: &Database,
    engine: &ClefEngine,
    session: &str,
    question: Question,
) -> Result<Value> {
    question.schema()?;
    let record = db.session_record(session)?;
    let evaluation_id = id();
    let question_json = serde_json::to_string(&question)?;
    let started = std::time::Instant::now();
    let result = engine.evaluate(question, record).await;
    let (model, backend) = match engine.status() {
        EngineStatus::Ready {
            model_path,
            backend,
        } => (Some(model_path.as_str()), Some(backend.as_str())),
        EngineStatus::ModelError { model_path, .. } => (Some(model_path.as_str()), None),
        _ => (None, None),
    };
    let mut conn =
        db.0.lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
    let tx = conn.transaction()?;
    match result {
        Ok(e) => {
            tx.execute(
                "UPDATE agent_sessions SET state='CLEF Evaluated' WHERE session_id=?1",
                [session],
            )?;
            tx.execute("INSERT INTO clef_evaluations(evaluation_id,session_id,question,status,model_path,backend,prompt,rendered_input,raw_output,pick,input_tokens,output_tokens,latency_ms,created_at) VALUES (?1,?2,?3,'Verified',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![evaluation_id,session,question_json,model,backend,e.prompt,e.rendered_input,e.raw_output,e.pick.to_string(),e.input_tokens as i64,e.output_tokens as i64,e.latency_ms as i64,now()])?;
        }
        Err(error) => {
            let status = if matches!(engine.status(), EngineStatus::Unconfigured) {
                "Unconfigured"
            } else {
                "ModelError"
            };
            tx.execute("INSERT INTO clef_evaluations(evaluation_id,session_id,question,status,model_path,backend,error,created_at,latency_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![evaluation_id,session,question_json,status,model,backend,format!("{error:#}"),now(),started.elapsed().as_millis() as i64])?;
        }
    }
    tx.commit()?;
    drop(conn);
    db.evaluations(session)?
        .into_iter()
        .find(|e| e["evaluation_id"] == evaluation_id)
        .ok_or_else(|| anyhow::anyhow!("evaluation was not persisted"))
}
