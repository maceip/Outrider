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
                .max_num_tokens(4096)
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
            let prompt = format!("Evaluate only the evidence in this MCP session record. Question: {}. Return exactly JSON matching {}. Session evidence: {}", serde_json::to_string(&question)?,schema,record);
            let mut conversation = engine.create_conversation(ConversationConfig {
                session:SessionConfig { max_output_tokens:Some(256), ..Default::default() },
                system_message:Some(serde_json::to_value(Message::system("You evaluate recorded MCP session evidence. Follow the supplied JSON schema."))?),
                enable_constrained_decoding:Some(true),use_ll_guidance:Some(true),
                extra_context:Some(json!({"enable_thinking":false})),
                thinking:Some(ThinkingConfig {enable_thinking:Some(false),thinking_token_budget:Some(0)}),
                ..Default::default()
            })?;
            let message = Message::user(&prompt);
            let rendered_input = format!("{}{}",conversation.render_preface()?,conversation.render_message(&message)?);
            let input_tokens = engine.tokenize(&rendered_input)?.len();
            let output = conversation.send_message_with(message, SendOptions { optional_args:Some(ConversationOptionalArgs {
                constraint_type:Some(ConstraintType::JsonSchema),constraint_string:Some(schema.to_string()),max_output_tokens:Some(256),..Default::default()
            }), ..Default::default() })?;
            let raw_output = output.text().context("No model response text")?;
            let value: Value = serde_json::from_str(&raw_output).context("Model returned invalid JSON")?;
            let pick = question.validate(&value)?;
            let output_tokens = engine.tokenize(&raw_output)?.len();
            Ok(Evaluation {prompt,rendered_input,raw_output,pick,input_tokens,output_tokens,latency_ms:started.elapsed().as_millis()})
        }).await?
    }
}
