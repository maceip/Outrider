use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Question {
    Noul {
        question: String,
    },
    Choice {
        question: String,
        options: Vec<String>,
    },
    Score {
        question: String,
        min: i64,
        max: i64,
    },
}
impl Question {
    pub fn schema(&self) -> Result<Value> {
        let pick = match self {
            Self::Noul { .. } => json!({"type":"boolean"}),
            Self::Choice { options, .. } => {
                ensure!(
                    !options.is_empty() && options.len() <= 64,
                    "Choice requires 1–64 options"
                );
                ensure!(options.iter().all(|s| !s.is_empty()), "Empty choice option");
                let unique: std::collections::HashSet<_> = options.iter().collect();
                ensure!(unique.len() == options.len(), "Duplicate choice options");
                json!({"type":"string","enum":options})
            }
            Self::Score { min, max, .. } => {
                ensure!(min <= max, "Invalid score range");
                json!({"type":"integer","minimum":min,"maximum":max})
            }
        };
        Ok(
            json!({"type":"object","properties":{"pick":pick},"required":["pick"],"additionalProperties":false}),
        )
    }
    pub fn validate(&self, output: &Value) -> Result<Value> {
        ensure!(
            output
                .as_object()
                .is_some_and(|o| o.len() == 1 && o.contains_key("pick")),
            "Expected exactly one pick field"
        );
        let pick = &output["pick"];
        ensure!(
            match self {
                Self::Noul { .. } => pick.is_boolean(),
                Self::Choice { options, .. } => pick
                    .as_str()
                    .is_some_and(|s| options.iter().any(|o| o == s)),
                Self::Score { min, max, .. } =>
                    pick.as_i64().is_some_and(|s| (*min..=*max).contains(&s)),
            },
            "Model output violates question schema"
        );
        Ok(pick.clone())
    }
}
