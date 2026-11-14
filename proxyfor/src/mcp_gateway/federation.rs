use anyhow::{Result,Context,ensure,anyhow};
use rmcp::{ClientServiceExt,ClientLifecycleMode,service::{RunningService,RoleClient},transport::{TokioChildProcess,StreamableHttpClientTransport},model::*};
use rusqlite::params;
use serde_json::{Value,json};
use std::{collections::HashMap,sync::Arc};
use crate::commerce::{Commerce,db::{Database,now},bundler::digest};
type Upstream=RunningService<RoleClient,()>;
#[derive(Default)]
pub struct Federation {clients:tokio::sync::RwLock<HashMap<String,Arc<Upstream>>>}
impl Federation {
 pub async fn connect(&self,commerce:&Arc<Commerce>,name:&str,endpoint:&str,actor:&str)->Result<Value> {
  ensure!(!name.is_empty() && name.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-'),"Invalid upstream name");
  {
   let mut conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;let tx=conn.transaction()?;
   tx.execute("INSERT INTO upstream_servers(name,endpoint,status,updated_at) VALUES (?1,?2,'Connecting',?3) ON CONFLICT(name) DO UPDATE SET endpoint=excluded.endpoint,status='Connecting',error=NULL,updated_at=excluded.updated_at",params![name,endpoint,now()])?;
   crate::commerce::receipt::audit(&tx,actor,"upstream.connect",name,&json!({"endpoint":endpoint}))?;tx.commit()?;
  }
  let connected=tokio::time::timeout(std::time::Duration::from_secs(30),async {
   let service=if endpoint.starts_with("http://")||endpoint.starts_with("https://") {
    ().serve_with_lifecycle(StreamableHttpClientTransport::from_uri(endpoint.to_owned()),ClientLifecycleMode::Auto{preferred_versions:vec![ProtocolVersion::V_2026_07_28],legacy_version:None}).await?
   } else {
    let parts=shell_words::split(endpoint)?;ensure!(!parts.is_empty(),"Empty upstream command");
    let mut command=tokio::process::Command::new(&parts[0]);command.args(&parts[1..]);command.stderr(std::process::Stdio::inherit());
    ().serve_with_lifecycle(TokioChildProcess::new(command)?,ClientLifecycleMode::Auto{preferred_versions:vec![ProtocolVersion::V_2026_07_28],legacy_version:None}).await?
   };
   let tools=service.list_all_tools().await?;
   let info=service.peer_info();
   let prompts=if info.as_ref().is_some_and(|i|i.capabilities.prompts.is_some()){service.list_all_prompts().await?}else{vec![]};
   let resources=if info.as_ref().is_some_and(|i|i.capabilities.resources.is_some()){service.list_all_resources().await?}else{vec![]};
   Ok::<_,anyhow::Error>((service,tools,prompts,resources))
  }).await.map_err(|_|anyhow!("Upstream connection timed out")).and_then(|r|r);
  match connected {
   Ok((service,tools,prompts,resources))=>{
    let count=tools.len();
    {let mut conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;let tx=conn.transaction()?;
     tx.execute("DELETE FROM catalog_items WHERE upstream_name=?1",[name])?;
     for mut tool in tools {let original=tool.name.to_string();let alias=format!("{name}__{original}");tool.name=alias.clone().into();let descriptor=json!({"tool":tool,"remote_name":original});tx.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor,upstream_name) VALUES (?1,'tool',?2,?3,?4)",params![alias,digest(&descriptor)?,descriptor.to_string(),name])?;}
     for prompt in prompts {let item=format!("{name}__prompt__{}",prompt.name);let descriptor=json!({"prompt":prompt});tx.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor,upstream_name) VALUES (?1,'prompt',?2,?3,?4)",params![item,digest(&descriptor)?,descriptor.to_string(),name])?;}
     for resource in resources {let uri=resource.uri.clone();let item=format!("{name}__resource__{uri}");let descriptor=json!({"resource":resource,"remote_uri":uri});tx.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor,upstream_name) VALUES (?1,'resource',?2,?3,?4)",params![item,digest(&descriptor)?,descriptor.to_string(),name])?;}
     tx.execute("UPDATE upstream_servers SET status='Connected',error=NULL,updated_at=?2 WHERE name=?1",params![name,now()])?;tx.commit()?;
    }
    self.clients.write().await.insert(name.into(),Arc::new(service));
    frame(&commerce.db,None,Some(name),"response","upstream/catalog",&json!({"tools":count}))?;
    commerce.changed("upstream.connected",None);Ok(json!({"name":name,"status":"Connected","tools":count}))
   },
   Err(e)=>{let error=format!("{e:#}");commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("UPDATE upstream_servers SET status='Failed',error=?2,updated_at=?3 WHERE name=?1",params![name,error,now()])?;self.clients.write().await.remove(name);commerce.changed("upstream.failed",None);Err(e)}
  }
 }
 pub async fn client(&self,name:&str)->Result<Arc<Upstream>> {self.clients.read().await.get(name).cloned().with_context(||format!("Upstream {name} is not connected"))}
 pub async fn call(&self,commerce:&Commerce,session:&str,name:&str,tool:&str,args:serde_json::Map<String,Value>)->Result<CallToolResult> {
  frame(&commerce.db,Some(session),Some(name),"request","tools/call",&json!({"name":tool,"arguments":args}))?;
  let result=self.client(name).await?.call_tool(CallToolRequestParams::new(tool.to_owned()).with_arguments(args)).await;
  match result {Ok(r)=>{frame(&commerce.db,Some(session),Some(name),"response","tools/call",&serde_json::to_value(&r)?)?;Ok(r)},Err(e)=>{frame(&commerce.db,Some(session),Some(name),"error","tools/call",&json!({"error":e.to_string()}))?;commerce.changed("upstream.call_failed",Some(session));Err(e.into())}}
 }
}
pub fn frame(db:&Database,session:Option<&str>,upstream:Option<&str>,direction:&str,method:&str,body:&Value)->Result<()> {
 db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO mcp_frames(session_id,upstream_name,direction,method,body,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![session,upstream,direction,method,body.to_string(),now()])?;Ok(())
}
