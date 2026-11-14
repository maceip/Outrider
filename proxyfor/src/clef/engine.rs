use super::schema::Question;
use anyhow::{Context, Result, anyhow, ensure};
use litert_lm_rust::{
    Backend, ConstraintType, ConversationConfig, ConversationOptionalArgs, Engine, Message,
    SendOptions, SessionConfig, ThinkingConfig,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Instant};
use tokio::sync::Semaphore;

pub const MAX_CONTEXT_TOKENS: usize = 4096;
pub const MAX_OUTPUT_TOKENS: usize = 256;
const TOKEN_SAFETY_MARGIN: usize = 32;
pub const MAX_INPUT_TOKENS: usize = MAX_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS - TOKEN_SAFETY_MARGIN;

#[derive(Clone, Debug)]
pub struct ClefConfig {
    pub model: Option<PathBuf>,
    pub backend: String,
    pub threads: usize,
    pub cache_dir: PathBuf,
    pub workers: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum EngineStatus {
    Unconfigured,
    Ready { model_path: String, backend: String },
    ModelError { model_path: String, error: String },
}
#[derive(Clone)]
pub struct ClefEngine {
    engine: Option<Arc<Engine>>,
    status: EngineStatus,
    workers: Arc<Semaphore>,
}
#[derive(Debug, Serialize)]
pub struct Evaluation {
    pub prompt: String,
    pub rendered_input: String,
    pub raw_output: String,
    pub pick: Value,
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub latency_ms: u128,
}
impl ClefEngine {
    pub async fn load(config: ClefConfig) -> Result<Self> {
        ensure!(
            (1..=256).contains(&config.threads),
            "CLEF threads must be 1–256"
        );
        ensure!(
            (1..=16).contains(&config.workers),
            "CLEF workers must be 1–16"
        );
        let backend = match config.backend.as_str() {
            "cpu" => Backend::Cpu,
            "gpu" => Backend::Gpu,
            _ => return Err(anyhow!("CLEF backend must be cpu or gpu")),
        };
        let Some(model) = &config.model else {
            return Ok(Self {
                engine: None,
                status: EngineStatus::Unconfigured,
                workers: Arc::new(Semaphore::new(config.workers)),
            });
        };
        let model_path = model.display().to_string();
        let model = model.clone();
        let loaded = tokio::task::spawn_blocking(move || -> Result<Engine> {
            ensure!(
                model.extension().is_some_and(|s| s == "litertlm"),
                "Model must be a .litertlm file"
            );
            ensure!(model.is_file(), "Model file does not exist");
            std::fs::create_dir_all(&config.cache_dir)?;
            Ok(Engine::builder(model)
                .backend(backend)
                .num_threads(config.threads as i32)
                .cache_dir(config.cache_dir)
                .max_num_tokens(MAX_CONTEXT_TOKENS as i32)
                .build()?)
        })
        .await?;
        let (engine, status) = match loaded {
            Ok(e) => (
                Some(Arc::new(e)),
                EngineStatus::Ready {
                    model_path,
                    backend: config.backend,
                },
            ),
            Err(e) => (
                None,
                EngineStatus::ModelError {
                    model_path,
                    error: format!("{e:#}"),
                },
            ),
        };
        Ok(Self {
            engine,
            status,
            workers: Arc::new(Semaphore::new(config.workers)),
        })
    }
    pub fn status(&self) -> &EngineStatus {
        &self.status
    }
    pub fn tokenize(&self, text: &str) -> Result<usize> {
        Ok(self
            .engine
            .as_ref()
            .context("CLEF model is not ready")?
            .tokenize(text)?
            .len())
    }
    pub async fn evaluate(&self, question: Question, record: Value) -> Result<Evaluation> {
        let engine = self.engine.clone().context("CLEF model is not ready")?;
        let schema = question.schema()?;
        let permit = self
            .workers
            .clone()
            .try_acquire_owned()
            .context("CLEF worker pool busy")?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let started = Instant::now();
            let mut conversation = engine.create_conversation(ConversationConfig {
                session: SessionConfig {
                    max_output_tokens: Some(MAX_OUTPUT_TOKENS as i32),
                    ..Default::default()
                },
                system_message: Some(serde_json::to_value(Message::system(
                    "You evaluate recorded MCP session evidence. Follow the supplied JSON schema.",
                ))?),
                enable_constrained_decoding: Some(true),
                use_ll_guidance: Some(true),
                extra_context: Some(json!({"enable_thinking": false})),
                thinking: Some(ThinkingConfig {
                    enable_thinking: Some(false),
                    thinking_token_budget: Some(0),
                }),
                ..Default::default()
            })?;
            let question_json = serde_json::to_string(&question)?;
            let preface = conversation.render_preface()?;
            let measure = |candidate: &Value| -> Result<(String, String, usize)> {
                let prompt = format!(
                    "Evaluate only the evidence in this MCP session record. Question: {question_json}. Return exactly JSON matching {schema}. Session evidence: {candidate}"
                );
                let msg = Message::user(&prompt);
                let rendered = format!("{preface}{}", conversation.render_message(&msg)?);
                let tokens = engine.tokenize(&rendered)?.len();
                Ok((prompt, rendered, tokens))
            };
            let (prompt, rendered_input, input_tokens) = {
                let initial = measure(&record)?;
                if initial.2 <= MAX_INPUT_TOKENS {
                    initial
                } else {
                    fit_session_evidence(&record, &measure)?
                }
            };
            let message = Message::user(&prompt);
            let output = conversation.send_message_with(
                message,
                SendOptions {
                    optional_args: Some(ConversationOptionalArgs {
                        constraint_type: Some(ConstraintType::JsonSchema),
                        constraint_string: Some(schema.to_string()),
                        max_output_tokens: Some(MAX_OUTPUT_TOKENS as i32),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )?;
            let raw_output = output.text().context("No model response text")?;
            let value: Value =
                serde_json::from_str(&raw_output).context("Model returned invalid JSON")?;
            let pick = question.validate(&value)?;
            let output_tokens = engine.tokenize(&raw_output)?.len();
            Ok(Evaluation {
                prompt,
                rendered_input,
                raw_output,
                pick,
                input_tokens,
                output_tokens,
                latency_ms: started.elapsed().as_millis(),
            })
        })
        .await?
    }
}

fn fit_session_evidence<F>(record: &Value, measure: &F) -> Result<(String, String, usize)>
where
    F: Fn(&Value) -> Result<(String, String, usize)>,
{
    let Some(base) = record.as_object() else {
        let (_, _, tokens) = measure(record)?;
        anyhow::bail!(
            "CLEF prompt exceeds {MAX_CONTEXT_TOKENS}-token context window ({tokens} input tokens > {MAX_INPUT_TOKENS} max input budget)"
        );
    };
    let probes = base
        .get("probes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let observations = base
        .get("observations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let build = |keep_probes: usize, keep_obs: usize, drop_init: bool| -> Value {
        let mut map = base.clone();
        if drop_init {
            map.insert(
                "initialize".into(),
                json!({"omitted_for_context_budget": true}),
            );
        }
        map.insert(
            "probes".into(),
            Value::Array(probes.iter().take(keep_probes).cloned().collect()),
        );
        map.insert(
            "observations".into(),
            Value::Array(observations.iter().take(keep_obs).cloned().collect()),
        );
        if keep_probes < probes.len() {
            map.insert(
                "omitted_probes".into(),
                Value::from(probes.len() - keep_probes),
            );
        }
        if keep_obs < observations.len() {
            map.insert(
                "omitted_observations".into(),
                Value::from(observations.len() - keep_obs),
            );
        }
        Value::Object(map)
    };
    // First keep all probes if possible and binary-search how many newest observations fit.
    let no_obs = measure(&build(probes.len(), 0, false))?;
    if no_obs.2 <= MAX_INPUT_TOKENS {
        let (mut lo, mut hi) = (0usize, observations.len());
        let mut best = no_obs;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            let m = measure(&build(probes.len(), mid, false))?;
            if m.2 <= MAX_INPUT_TOKENS {
                best = m;
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return Ok(best);
    }
    // Otherwise binary-search how many newest probes fit with 0 observations.
    let empty_evidence = measure(&build(0, 0, false))?;
    if empty_evidence.2 <= MAX_INPUT_TOKENS {
        let (mut lo, mut hi) = (0usize, probes.len());
        let mut best = empty_evidence;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            let m = measure(&build(mid, 0, false))?;
            if m.2 <= MAX_INPUT_TOKENS {
                best = m;
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return Ok(best);
    }
    let minimal = measure(&build(0, 0, true))?;
    if minimal.2 <= MAX_INPUT_TOKENS {
        return Ok(minimal);
    }
    anyhow::bail!(
        "CLEF prompt exceeds {MAX_CONTEXT_TOKENS}-token context window ({} input tokens > {MAX_INPUT_TOKENS} max input budget)",
        minimal.2
    )
}
