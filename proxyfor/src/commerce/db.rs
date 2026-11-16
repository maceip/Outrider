use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use serde_json::Value;
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone)]
pub struct Database(pub(crate) Arc<Mutex<Connection>>);

pub const FIRST_RUN_DEMO_COMPLETED_KEY: &str = "first_run_demo_completed";

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs() as i64
}
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as i64
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(parent) = path.as_ref().parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        if path.as_ref() != Path::new(":memory:") {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            let file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(path.as_ref())?;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(10))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS agent_sessions (
              session_id TEXT PRIMARY KEY, subject TEXT NOT NULL, client_config TEXT NOT NULL,
              transport TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'Unprobed', created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clef_evaluations (
              evaluation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions,
              question TEXT NOT NULL, status TEXT NOT NULL, model_path TEXT, backend TEXT,
              prompt TEXT, rendered_input TEXT, raw_output TEXT, pick TEXT,
              input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER,
              option_scores TEXT DEFAULT NULL CHECK(option_scores IS NULL),
              error TEXT, created_at INTEGER NOT NULL
            );")?;
        connection.execute_batch(include_str!("schema.sql"))?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS commerce_transactions (
                tx_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                short_title TEXT NOT NULL,
                category_label TEXT NOT NULL,
                buyer_agent TEXT NOT NULL,
                seller_host TEXT NOT NULL,
                protocol TEXT NOT NULL,
                phase TEXT NOT NULL,
                status TEXT NOT NULL,
                status_detail TEXT NOT NULL,
                sub_status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS interception_events (
                event_id TEXT NOT NULL,
                tx_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                actor TEXT NOT NULL,
                direction TEXT NOT NULL,
                protocol TEXT NOT NULL,
                event_name TEXT NOT NULL,
                epistemic_kind TEXT NOT NULL,
                hold_state TEXT NOT NULL,
                status_code INTEGER,
                status_label TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                latency_ms INTEGER,
                observation TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(tx_id, event_id)
            );
            CREATE TABLE IF NOT EXISTS commercial_offers (
                offer_id TEXT NOT NULL,
                tx_id TEXT NOT NULL,
                parent_event_id TEXT NOT NULL,
                label TEXT NOT NULL,
                sku_title TEXT NOT NULL,
                price_cents INTEGER NOT NULL,
                currency TEXT NOT NULL,
                in_stock INTEGER NOT NULL,
                warranty TEXT NOT NULL,
                returns_policy TEXT NOT NULL,
                is_draft INTEGER NOT NULL,
                committed INTEGER NOT NULL,
                PRIMARY KEY(tx_id, offer_id)
            );
            CREATE TABLE IF NOT EXISTS interception_drafts (
                draft_id TEXT PRIMARY KEY,
                tx_id TEXT NOT NULL,
                target_event_id TEXT NOT NULL,
                lane TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                promo_offer_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                result_preview TEXT NOT NULL,
                delivery_state TEXT NOT NULL,
                proposed_payload TEXT NOT NULL,
                mcp_schema TEXT NOT NULL,
                mcp_schema_detail TEXT NOT NULL,
                seller_policy TEXT NOT NULL,
                seller_policy_detail TEXT NOT NULL,
                operator_approval TEXT NOT NULL,
                payment_auth TEXT NOT NULL,
                seller_floor_cents INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );",
        )?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }
    pub fn record_session(
        &self,
        session_id: &str,
        subject: &str,
        client: &Value,
        transport: &str,
    ) -> Result<()> {
        self.0.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?.execute(
            "INSERT INTO agent_sessions(session_id,subject,client_config,transport,created_at) VALUES (?1,?2,?3,?4,?5)",
            params![session_id,subject,client.to_string(),transport,now()])?;
        Ok(())
    }
    pub fn session_record(&self, session: &str) -> Result<Value> {
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let (client, transport): (String, String) = conn
            .query_row(
                "SELECT client_config,transport FROM agent_sessions WHERE session_id=?1",
                [session],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .context("Unknown session")?;
        drop(conn);
        let probes = self.rows_where("probe_runs", "session_id", session)?;
        let observations = self.rows_where("fingerprint_observations", "session_id", session)?;
        Ok(
            serde_json::json!({"session_id":session,"initialize":serde_json::from_str::<Value>(&client)?,"transport":transport,"probes":probes,"observations":observations}),
        )
    }
    pub fn evaluations(&self, session: &str) -> Result<Vec<Value>> {
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare("SELECT evaluation_id,status,model_path,backend,question,pick,input_tokens,output_tokens,latency_ms,option_scores,error,raw_output,rendered_input FROM clef_evaluations WHERE session_id=?1 ORDER BY rowid")?;
        let rows = stmt.query_map([session], |r| {
            let pick: Option<String> = r.get(5)?;
            Ok(serde_json::json!({"evaluation_id":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?,"model_path":r.get::<_,Option<String>>(2)?,"backend":r.get::<_,Option<String>>(3)?,"question":r.get::<_,String>(4)?,"pick":pick.and_then(|s| serde_json::from_str::<Value>(&s).ok()),"input_tokens":r.get::<_,Option<i64>>(6)?,"output_tokens":r.get::<_,Option<i64>>(7)?,"latency_ms":r.get::<_,Option<i64>>(8)?,"option_scores":r.get::<_,Option<String>>(9)?,"error":r.get::<_,Option<String>>(10)?,"raw_output":r.get::<_,Option<String>>(11)?,"rendered_input":r.get::<_,Option<String>>(12)?}))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
impl Database {
    fn map_row(columns: &[String], r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
        let mut obj = serde_json::Map::new();
        for (i, name) in columns.iter().enumerate() {
            let value = match r.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                rusqlite::types::ValueRef::Real(n) => Value::from(n),
                rusqlite::types::ValueRef::Text(s) => {
                    let s = String::from_utf8_lossy(s).to_string();
                    if [
                        "client_config",
                        "evidence",
                        "question",
                        "pick",
                        "descriptor",
                        "items",
                        "rules",
                        "request",
                        "item_digests",
                        "payload",
                        "details",
                        "body",
                        "response",
                        "head",
                        "detail",
                        "message",
                    ]
                    .contains(&name.as_str())
                    {
                        serde_json::from_str(&s).unwrap_or(Value::String(s))
                    } else {
                        Value::String(s)
                    }
                }
                rusqlite::types::ValueRef::Blob(_) => Value::Null,
            };
            obj.insert(name.clone(), value);
        }
        Ok(Value::Object(obj))
    }
    pub fn rows(&self, table: &str) -> Result<Value> {
        anyhow::ensure!(
            [
                "agent_sessions",
                "fingerprint_observations",
                "probe_runs",
                "clef_evaluations",
                "upstream_servers",
                "catalog_items",
                "bundles",
                "session_offers",
                "mrtr_quotes",
                "capability_receipts",
                "receipt_redemptions",
                "admin_audit_log",
                "mcp_frames",
                "proxy_traffic",
                "proxy_websocket_messages"
            ]
            .contains(&table),
            "Invalid table"
        );
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT * FROM {table} ORDER BY rowid DESC LIMIT 1000"
        ))?;
        let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
        let rows = stmt.query_map([], |r| Self::map_row(&columns, r))?;
        Ok(Value::Array(rows.collect::<rusqlite::Result<Vec<_>>>()?))
    }
    pub fn rows_where(&self, table: &str, column: &str, value: &str) -> Result<Vec<Value>> {
        anyhow::ensure!(
            matches!(
                (table, column),
                ("fingerprint_observations", "session_id")
                    | ("probe_runs", "session_id")
                    | ("clef_evaluations", "session_id")
                    | ("session_offers", "session_id")
                    | ("mcp_frames", "session_id")
                    | ("capability_receipts", "subject")
                    | ("receipt_redemptions", "session_id")
                    | ("receipt_redemptions", "receipt_id")
            ),
            "Invalid scoped query"
        );
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT * FROM {table} WHERE {column}=?1 ORDER BY rowid DESC"
        ))?;
        let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
        let rows = stmt.query_map([value], |r| Self::map_row(&columns, r))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
    pub fn admin_audit(
        &self,
        actor: &str,
        action: &str,
        target: &str,
        details: &Value,
    ) -> Result<()> {
        let mut conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let tx = conn.transaction()?;
        super::receipt::audit(&tx, actor, action, target, details)?;
        tx.commit()?;
        Ok(())
    }
    pub fn meta_get(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension as _;
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        Ok(conn
            .query_row("SELECT value FROM commerce_meta WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub fn meta_set(&self, key: &str, value: &str) -> Result<()> {
        let conn = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        conn.execute(
            "INSERT INTO commerce_meta(key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            params![key, value, now()],
        )?;
        Ok(())
    }
    pub fn is_first_run_demo_pending(&self) -> Result<bool> {
        Ok(self.meta_get(FIRST_RUN_DEMO_COMPLETED_KEY)?.is_none())
    }
    pub fn mark_first_run_demo_completed(&self) -> Result<()> {
        self.meta_set(FIRST_RUN_DEMO_COMPLETED_KEY, &now().to_string())
    }
}
