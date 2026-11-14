//! Phase 0: record exactly what the pinned runtime returns. No score inference.
use anyhow::{Context, Result, ensure};
use litert_lm_rust::{
    Backend, ConstraintType, ConversationConfig, ConversationOptionalArgs, Engine, InputData,
    Message, SendOptions, SessionConfig, ThinkingConfig,
};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Instant};

fn main() -> Result<()> {
    let model = std::env::var("OUTRIDER_CLEF_MODEL")
        .context("OUTRIDER_CLEF_MODEL must name a real .litertlm model")?;
    let backend = match std::env::var("OUTRIDER_CLEF_BACKEND").as_deref() {
        Ok("gpu") => Backend::Gpu,
        _ => Backend::Cpu,
    };
    let cache = std::env::temp_dir().join("outrider-clef-spike");
    std::fs::create_dir_all(&cache)?;
    let engine = Engine::builder(&model)
        .backend(backend.clone())
        .num_threads(4)
        .cache_dir(&cache)
        .max_num_tokens(2048)
        .build()?;
    let mut results = Vec::new();
    let cases = [
        (
            "noul",
            "Is the recorded client initialized?",
            json!({"type":"boolean"}),
        ),
        (
            "choice",
            "Choose the observed transport.",
            json!({"type":"string","enum":["http","stdio"]}),
        ),
        (
            "score",
            "Score the completeness of the initialize record from 0 to 5.",
            json!({"type":"integer","minimum":0,"maximum":5}),
        ),
    ];
    let record = json!({"method":"initialize","params":{"protocolVersion":"2026-07-28","clientInfo":{"name":"Outrider feasibility client","version":"1"},"capabilities":{}},"transport":"http"});
    for (kind, question, pick_schema) in cases {
        let schema = json!({"type":"object","properties":{"pick":pick_schema},"required":["pick"],"additionalProperties":false});
        let prompt = format!(
            "Evaluate this recorded MCP session. {question} Return only JSON matching {schema}. Session: {record}"
        );
        let mut conversation = engine.create_conversation(ConversationConfig {
            session: SessionConfig {
                max_output_tokens: Some(128),
                ..Default::default()
            },
            enable_constrained_decoding: Some(true),
            use_ll_guidance: Some(true),
            extra_context: Some(json!({"enable_thinking":false})),
            thinking: Some(ThinkingConfig {
                enable_thinking: Some(false),
                thinking_token_budget: Some(0),
            }),
            ..Default::default()
        })?;
        let input_tokens = engine.tokenize(&prompt)?.len();
        let started = Instant::now();
        let message = conversation.send_message_with(
            Message::user(&prompt),
            SendOptions {
                optional_args: Some(ConversationOptionalArgs {
                    constraint_type: Some(ConstraintType::JsonSchema),
                    constraint_string: Some(schema.to_string()),
                    max_output_tokens: Some(128),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let text = message.text().context("No text in constrained response")?;
        let output: Value =
            serde_json::from_str(&text).context(format!("Invalid constrained JSON: {text}"))?;
        let pick = &output["pick"];
        ensure!(
            output.as_object().is_some_and(|o| o.len() == 1),
            "Unexpected response fields"
        );
        ensure!(
            match kind {
                "noul" => pick.is_boolean(),
                "choice" => ["http", "stdio"].contains(&pick.as_str().unwrap_or("")),
                _ => pick.as_i64().is_some_and(|n| (0..=5).contains(&n)),
            },
            "Pick violates schema: {output}"
        );
        results.push(json!({"question_type":kind,"schema":schema,"prompt":prompt,"output":output,"raw_text":text,"input_tokens":input_tokens,"output_tokens":engine.tokenize(&text)?.len(),"latency_ms":started.elapsed().as_millis()}));
    }
    let mut session = engine.create_session(SessionConfig {
        max_output_tokens: Some(16),
        ..Default::default()
    })?;
    let responses = session.generate_content_responses(&[InputData::Text(
        "Answer with one word: what is 1 plus 1?".into(),
    )])?;
    let candidates: Vec<_> = (0..responses.num_candidates()).map(|i| json!({"text":responses.text_at(i).ok(),"score_at":responses.score_at(i),"token_scores_at":responses.token_scores_at(i),"token_length_at":responses.token_length_at(i)})).collect();
    let result = json!({"model":model,"backend":format!("{backend:?}"),"crate_version":"0.2.4","record":record,"constrained_questions":results,"session_candidates":candidates,"option_scores_supported":false,"option_scores_reason":"Generated-candidate scores are not per-option scores; no measured option-distribution source is exposed by this crate's generation API."});
    let path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("proxyfor/tests/fixtures/phase0/clef_runtime.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&result)?)?;
    println!("Recorded live runtime measurements in {}", path.display());
    Ok(())
}
