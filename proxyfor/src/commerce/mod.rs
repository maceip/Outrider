pub mod db;
pub mod admin_auth;
pub mod bundler;
pub mod receipt;
pub mod http;

use std::{path::Path,sync::Arc};
use anyhow::Result;
use crate::clef::engine::ClefEngine;
use admin_auth::AdminAuth;
use receipt::ReceiptAuthority;
use db::Database;

pub struct Commerce {
    pub run_id:String,
    pub errors:std::sync::Mutex<Vec<String>>,
    pub db:Database,pub clef:ClefEngine,pub receipts:ReceiptAuthority,pub auth:AdminAuth,
    pub codec:rmcp::model::RequestStateCodec,
    pub auto_probed:std::sync::Mutex<std::collections::HashSet<String>>,
    pub cadence:std::sync::Mutex<std::collections::HashMap<String,(std::time::Instant,Vec<f64>)>>,
    pub federation:crate::mcp_gateway::federation::Federation,
    pub skills:std::sync::RwLock<Option<Arc<rmcp::handler::server::skill_catalog::SkillCatalog>>>,
    pub tasks:rmcp::task_manager::TaskManager,
    pub task_owners:std::sync::Mutex<std::collections::HashMap<String,String>>,
    pub probe_policy:std::sync::RwLock<crate::fingerprint::active::ProbePolicy>,
    pub peers:std::sync::Mutex<std::collections::HashMap<String,rmcp::Peer<rmcp::RoleServer>>>,
    pub events:tokio::sync::broadcast::Sender<serde_json::Value>,
}
impl std::fmt::Debug for Commerce {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {f.debug_struct("Commerce").field("clef",self.clef.status()).finish_non_exhaustive()}
}
impl Commerce {
    pub fn new(db:Database,clef:ClefEngine,dir:&Path,allow_remote:bool)->Result<(Arc<Self>,Option<String>)> {
        let (auth,token,key)=AdminAuth::load(dir,allow_remote)?;
        let receipts=ReceiptAuthority::load(db.clone(),&dir.join("outrider-ed25519.pem"))?;
        let (events,_)=tokio::sync::broadcast::channel(256);
        Ok((Arc::new(Self{run_id:db::id(),errors:Default::default(),db,clef,receipts,auth,codec:rmcp::model::RequestStateCodec::try_new(key)?,auto_probed:Default::default(),cadence:Default::default(),federation:Default::default(),skills:Default::default(),tasks:rmcp::task_manager::TaskManager::new(),task_owners:Default::default(),probe_policy:Default::default(),peers:Default::default(),events}),token))
    }
    pub fn changed(&self,kind:&str,session:Option<&str>) {let _=self.events.send(serde_json::json!({"kind":kind,"session_id":session}));}
    pub fn snapshot(&self)->Result<serde_json::Value> {
        let mut result=serde_json::Map::new();
        result.insert("errors".into(),self.errors.lock().unwrap().clone().into());
        result.insert("run_id".into(),self.run_id.clone().into());
        result.insert("clef".into(),serde_json::to_value(self.clef.status())?);
        result.insert("active_peers".into(),self.peers.lock().map_err(|_|anyhow::anyhow!("peer registry poisoned"))?.iter().map(|(session,peer)|serde_json::json!({"session_id":session,"connected":!peer.is_transport_closed(),"sampling":peer.peer_info().is_some_and(|p|p.capabilities.sampling.is_some())})).collect::<Vec<_>>().into());
        result.insert("probe_policy".into(),serde_json::to_value(*self.probe_policy.read().unwrap())?);
        result.insert("public_key".into(),self.receipts.public_key().into());
        for table in ["agent_sessions","fingerprint_observations","probe_runs","clef_evaluations","upstream_servers","catalog_items","bundles","session_offers","mrtr_quotes","capability_receipts","receipt_redemptions","admin_audit_log","mcp_frames","proxy_traffic","proxy_websocket_messages"] {
            let mut rows=self.db.rows(table)?;
            if table=="capability_receipts" {for row in rows.as_array_mut().unwrap() {
                let signed=receipt::SignedReceipt{receipt:serde_json::from_value(row["payload"].clone())?,signature:row["signature"].as_str().unwrap_or("").into()};
                row["signature_verified"]=self.receipts.verify_signature(&signed).is_ok().into();
            }}
            result.insert(table.into(),rows);
        }
        Ok(result.into())
    }
}
impl Commerce {
    pub fn load_skills(&self,path:&Path,actor:&str)->Result<()> {
        let catalog=Arc::new(rmcp::handler::server::skill_catalog::SkillCatalog::from_dir(path)?);
        {let mut conn=self.db.0.lock().map_err(|_|anyhow::anyhow!("database lock poisoned"))?;let tx=conn.transaction()?;
         tx.execute("DELETE FROM catalog_items WHERE kind='skill'",[])?;
         for skill in catalog.skills() {let descriptor=serde_json::to_value(&skill)?;tx.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor) VALUES (?1,'skill',?2,?3)",rusqlite::params![skill.uri,bundler::digest(&descriptor)?,descriptor.to_string()])?;}
         receipt::audit(&tx,actor,"skills.load",&path.display().to_string(),&serde_json::json!({"skills":catalog.skills().len()}))?;tx.commit()?;}
        *self.skills.write().unwrap()=Some(catalog);self.changed("skills.loaded",None);Ok(())
    }
}
impl Commerce {
    pub fn register_local_tools(&self)->Result<()> {
        let tool=rmcp::model::Tool::new("outrider_session_evidence","Read the persisted evidence for the current session",Arc::new(serde_json::json!({"type":"object","properties":{}}).as_object().unwrap().clone()));
        let descriptor=serde_json::json!({"tool":tool,"local":true,"remote_name":"outrider_session_evidence"});
        self.db.0.lock().map_err(|_|anyhow::anyhow!("database lock poisoned"))?.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor) VALUES ('outrider_session_evidence','tool',?1,?2) ON CONFLICT(item_id) DO UPDATE SET digest=excluded.digest,descriptor=excluded.descriptor",rusqlite::params![bundler::digest(&descriptor)?,descriptor.to_string()])?;Ok(())
    }
}
pub mod tui;
