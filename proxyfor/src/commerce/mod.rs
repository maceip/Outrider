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
    pub db:Database,pub clef:ClefEngine,pub receipts:ReceiptAuthority,pub auth:AdminAuth,
    pub codec:rmcp::model::RequestStateCodec,
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
        Ok((Arc::new(Self{db,clef,receipts,auth,codec:rmcp::model::RequestStateCodec::try_new(key)?,probe_policy:Default::default(),peers:Default::default(),events}),token))
    }
    pub fn changed(&self,kind:&str,session:Option<&str>) {let _=self.events.send(serde_json::json!({"kind":kind,"session_id":session}));}
    pub fn snapshot(&self)->Result<serde_json::Value> {
        let mut result=serde_json::Map::new();
        result.insert("clef".into(),serde_json::to_value(self.clef.status())?);
        result.insert("public_key".into(),self.receipts.public_key().into());
        for table in ["agent_sessions","fingerprint_observations","probe_runs","clef_evaluations","upstream_servers","catalog_items","bundles","session_offers","mrtr_quotes","capability_receipts","receipt_redemptions","admin_audit_log","mcp_frames"] {
            result.insert(table.into(),self.db.rows(table)?);
        }
        Ok(result.into())
    }
}
