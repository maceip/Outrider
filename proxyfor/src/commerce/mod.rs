pub mod admin_auth;
pub mod bundler;
pub mod db;
pub mod http;
pub mod interception;
pub mod receipt;

use crate::clef::engine::ClefEngine;
use admin_auth::AdminAuth;
use anyhow::Result;
use db::Database;
use receipt::ReceiptAuthority;
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug)]
pub struct RuntimeListenerInfo {
    pub listen_addr: SocketAddr,
    pub ca_cert_pem: String,
}

pub struct Commerce {
    pub run_id: String,
    pub config_dir: PathBuf,
    pub listener_info: std::sync::RwLock<Option<RuntimeListenerInfo>>,
    pub errors: std::sync::Mutex<Vec<String>>,
    pub db: Database,
    pub clef: ClefEngine,
    pub receipts: ReceiptAuthority,
    pub auth: AdminAuth,
    pub codec: rmcp::model::RequestStateCodec,
    pub auto_probed: std::sync::Mutex<std::collections::HashSet<String>>,
    pub cadence:
        std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, Vec<f64>)>>,
    pub federation: crate::mcp_gateway::federation::Federation,
    pub skills: std::sync::RwLock<Option<Arc<rmcp::handler::server::skill_catalog::SkillCatalog>>>,
    pub tasks: rmcp::task_manager::TaskManager,
    pub task_owners: std::sync::Mutex<std::collections::HashMap<String, String>>,
    pub probe_policy: std::sync::RwLock<crate::fingerprint::active::ProbePolicy>,
    pub peers: std::sync::Mutex<std::collections::HashMap<String, rmcp::Peer<rmcp::RoleServer>>>,
    pub events: tokio::sync::broadcast::Sender<serde_json::Value>,
    pub inspector: crate::inspector::Inspector,
    pub interception: interception::InterceptionEngine,
}
impl std::fmt::Debug for Commerce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Commerce")
            .field("clef", self.clef.status())
            .finish_non_exhaustive()
    }
}
impl Commerce {
    pub fn new(
        db: Database,
        clef: ClefEngine,
        dir: &Path,
        allow_remote: bool,
    ) -> Result<(Arc<Self>, Option<String>)> {
        db.0.lock().map_err(|_|anyhow::anyhow!("database lock poisoned"))?.execute("UPDATE upstream_servers SET status='Disconnected',error='Runtime restarted; no live connection',updated_at=?1",[db::now()])?;
        crate::inspector::Inspector::reset_stale(&db)?;
        interception::InterceptionEngine::reset_stale(&db)?;
        let (auth, token, key) = AdminAuth::load(dir, allow_remote)?;
        let receipts = ReceiptAuthority::load(db.clone(), &dir.join("outrider-ed25519.pem"))?;
        let (events, _) = tokio::sync::broadcast::channel(256);
        Ok((
            Arc::new(Self {
                run_id: db::id(),
                config_dir: dir.to_path_buf(),
                listener_info: Default::default(),
                errors: Default::default(),
                db,
                clef,
                receipts,
                auth,
                codec: rmcp::model::RequestStateCodec::try_new(key)?,
                auto_probed: Default::default(),
                cadence: Default::default(),
                federation: Default::default(),
                skills: Default::default(),
                tasks: rmcp::task_manager::TaskManager::new(),
                task_owners: Default::default(),
                probe_policy: Default::default(),
                peers: Default::default(),
                events,
                inspector: Default::default(),
                interception: Default::default(),
            }),
            token,
        ))
    }
    pub fn set_listener_info(&self, listen_addr: SocketAddr, ca_cert_pem: String) {
        if let Ok(mut guard) = self.listener_info.write() {
            *guard = Some(RuntimeListenerInfo {
                listen_addr,
                ca_cert_pem,
            });
        }
    }

    pub fn loopback_connect_addr(&self) -> Option<SocketAddr> {
        let info = self.listener_info.read().ok()?.clone()?;
        let ip = match info.listen_addr.ip() {
            std::net::IpAddr::V4(v4) if v4.is_unspecified() => {
                std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
            }
            std::net::IpAddr::V6(v6) if v6.is_unspecified() => {
                std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)
            }
            other => other,
        };
        Some(SocketAddr::new(ip, info.listen_addr.port()))
    }

    pub fn mcp_http_url(&self) -> Option<String> {
        let addr = self.loopback_connect_addr()?;
        Some(format!("http://{addr}/mcp"))
    }

    pub fn changed(&self, kind: &str, session: Option<&str>) {
        let _ = self
            .events
            .send(serde_json::json!({"kind":kind,"session_id":session}));
    }
    pub fn snapshot(&self) -> Result<serde_json::Value> {
        self.refresh_session_states()?;
        let mut result = serde_json::Map::new();
        result.insert("errors".into(), self.errors.lock().unwrap().clone().into());
        result.insert("run_id".into(), self.run_id.clone().into());
        result.insert("clef".into(), serde_json::to_value(self.clef.status())?);
        result.insert("active_peers".into(),self.peers.lock().map_err(|_|anyhow::anyhow!("peer registry poisoned"))?.iter().map(|(session,peer)|serde_json::json!({"session_id":session,"connected":!peer.is_transport_closed(),"sampling":peer.peer_info().is_some_and(|p|p.capabilities.sampling.is_some())})).collect::<Vec<_>>().into());
        result.insert(
            "probe_policy".into(),
            serde_json::to_value(*self.probe_policy.read().unwrap())?,
        );
        result.insert("public_key".into(), self.receipts.public_key().into());
        result.insert("interception".into(), self.interception.state(self)?);
        for table in [
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
            "proxy_websocket_messages",
        ] {
            let mut rows = self.db.rows(table)?;
            if table == "capability_receipts" {
                for row in rows.as_array_mut().unwrap() {
                    let signed = receipt::SignedReceipt {
                        receipt: serde_json::from_value(row["payload"].clone())?,
                        signature: row["signature"].as_str().unwrap_or("").into(),
                    };
                    row["signature_verified"] =
                        self.receipts.verify_signature(&signed).is_ok().into();
                }
            }
            result.insert(table.into(), rows);
        }
        Ok(result.into())
    }
}
impl Commerce {
    pub fn load_skills(&self, path: &Path, actor: &str) -> Result<()> {
        let catalog = Arc::new(rmcp::handler::server::skill_catalog::SkillCatalog::from_dir(path)?);
        {
            let mut conn = self
                .db
                .0
                .lock()
                .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM catalog_items WHERE kind='skill'", [])?;
            for skill in catalog.skills() {
                let descriptor = serde_json::to_value(&skill)?;
                tx.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor) VALUES (?1,'skill',?2,?3)",rusqlite::params![skill.uri,bundler::digest(&descriptor)?,descriptor.to_string()])?;
            }
            receipt::audit(
                &tx,
                actor,
                "skills.load",
                &path.display().to_string(),
                &serde_json::json!({"skills":catalog.skills().len()}),
            )?;
            tx.commit()?;
        }
        *self.skills.write().unwrap() = Some(catalog);
        self.changed("skills.loaded", None);
        Ok(())
    }
}
impl Commerce {
    pub fn register_local_tools(&self) -> Result<()> {
        let tool = rmcp::model::Tool::new(
            "outrider_session_evidence",
            "Read the persisted evidence for the current session",
            Arc::new(
                serde_json::json!({"type":"object","properties":{}})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        );
        let descriptor =
            serde_json::json!({"tool":tool,"local":true,"remote_name":"outrider_session_evidence"});
        self.db.0.lock().map_err(|_|anyhow::anyhow!("database lock poisoned"))?.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor) VALUES ('outrider_session_evidence','tool',?1,?2) ON CONFLICT(item_id) DO UPDATE SET digest=excluded.digest,descriptor=excluded.descriptor",rusqlite::params![bundler::digest(&descriptor)?,descriptor.to_string()])?;
        Ok(())
    }
}
pub mod tui;

impl Commerce {
    fn refresh_session_states(&self) -> Result<()> {
        use rusqlite::OptionalExtension as _;
        let sessions = self.db.rows("agent_sessions")?;
        for session in sessions.as_array().unwrap() {
            let id = session["session_id"].as_str().unwrap();
            let subject = session["subject"].as_str().unwrap();
            let (receipts, latest_status, has_completed_probe) = {
                let conn = self
                    .db
                    .0
                    .lock()
                    .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
                let mut stmt = conn.prepare("SELECT r.payload,r.signature FROM capability_receipts r JOIN presented_receipts p ON p.receipt_id=r.receipt_id WHERE p.session_id=?1")?;
                let receipts = stmt
                    .query_map([id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let latest_status: Option<String> = conn
                    .query_row(
                        "SELECT status FROM clef_evaluations WHERE session_id=?1 ORDER BY rowid DESC LIMIT 1",
                        [id],
                        |r| r.get(0),
                    )
                    .optional()?;
                let has_completed_probe: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM probe_runs WHERE session_id=?1 AND status='Completed')",
                    [id],
                    |r| r.get(0),
                )?;
                (receipts, latest_status, has_completed_probe)
            };
            let entitled = receipts.into_iter().any(|(payload, signature)| {
                serde_json::from_str::<receipt::CapabilityReceipt>(&payload)
                    .ok()
                    .is_some_and(|receipt| {
                        let bundle = receipt.bundle_id.clone();
                        self.receipts
                            .verify(
                                &receipt::SignedReceipt { receipt, signature },
                                subject,
                                &bundle,
                            )
                            .is_ok()
                    })
            });
            let state = if entitled {
                "Entitled"
            } else if latest_status.as_deref() == Some("Verified") {
                // The pick answers the operator's own question; no verdict is inferred from it.
                "CLEF Evaluated"
            } else if has_completed_probe {
                "Probed"
            } else {
                "Unprobed"
            };
            if session["state"] != state {
                self.db
                    .0
                    .lock()
                    .map_err(|_| anyhow::anyhow!("database lock poisoned"))?
                    .execute(
                        "UPDATE agent_sessions SET state=?2 WHERE session_id=?1",
                        rusqlite::params![id, state],
                    )?;
            }
        }
        Ok(())
    }
}
