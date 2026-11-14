#![allow(deprecated)]
use anyhow::{Result,ensure,anyhow};
use rmcp::{Peer,RoleServer,model::*,schemars};
use rusqlite::params;
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use std::{sync::Arc,time::Instant};
use crate::commerce::{Commerce,db::{id,now}};
#[derive(Clone,Copy,Debug,Default,Serialize,Deserialize,clap::ValueEnum,PartialEq,Eq)]
#[serde(rename_all="kebab-case")]
pub enum ProbePolicy {Off,OnRequest,#[default] Auto}
pub const PURPOSE:&str="This is an Outrider capability probe. Its purpose is to measure response latency and JSON structural compliance for this MCP session. Reply exactly with the JSON object {\"ack\":\"outrider\"}.";
#[derive(Debug,Serialize,Deserialize,schemars::JsonSchema)]
pub struct Preferences {pub sla_tier:String,pub bundle_preference:String}
rmcp::elicit_safe!(Preferences);

pub async fn run(commerce:&Arc<Commerce>,session:&str,peer:Peer<RoleServer>,automatic:bool)->Result<Value> {
 let policy=*commerce.probe_policy.read().map_err(|_|anyhow!("probe policy lock poisoned"))?;
 ensure!(policy!=ProbePolicy::Off,"Probes disabled by operator");
 ensure!(!automatic || policy==ProbePolicy::Auto,"Automatic probes disabled by policy");
 let info=peer.peer_info();let capabilities=info.as_ref().map(|i|&i.capabilities);
 ensure!(capabilities.is_some_and(|c|c.sampling.is_some()),"Client does not advertise sampling");
 let probe=id();let started=Instant::now();
 let response=tokio::time::timeout(std::time::Duration::from_secs(30),peer.create_message(CreateMessageRequestParams::new(vec![SamplingMessage::user_text(PURPOSE)],32).with_include_context(ContextInclusion::None).with_temperature(0.0))).await;
 let latency=started.elapsed().as_millis() as i64;
 let (status,body,error,compliance,output)=match response {
  Ok(Ok(result))=>{let text=result.message.content.iter().filter_map(|v|v.as_text()).map(|v|v.text.as_str()).collect::<String>();let compliant=serde_json::from_str::<Value>(&text).ok().is_some_and(|v|v==json!({"ack":"outrider"}));("Completed",Some(serde_json::to_value(result)?),None,Some(compliant),Some(text))},
  Ok(Err(e))=>{let message=e.to_string();let status=if message.to_lowercase().contains("declin"){"Declined"}else{"Failed"};(status,None,Some(message),None,None)},
  Err(_)=>("Failed",None,Some("Capability probe timed out".into()),None,None)
 };
 let input_tokens=commerce.clef.tokenize(PURPOSE).ok().map(|n|n as i64);
 let output_tokens=output.as_deref().and_then(|s|commerce.clef.tokenize(s).ok()).map(|n|n as i64);
 {
  let mut conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;let tx=conn.transaction()?;
  tx.execute("INSERT INTO probe_runs(probe_id,session_id,purpose,status,latency_ms,input_tokens,output_tokens,structural_compliance,response,error,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![probe,session,PURPOSE,status,latency,input_tokens,output_tokens,compliance,body.as_ref().map(Value::to_string),error,now()])?;
  if status=="Completed" {tx.execute("UPDATE agent_sessions SET state='Probed' WHERE session_id=?1",[session])?;}
  tx.commit()?;
 }
 commerce.changed("probe.finished",Some(session));
 if capabilities.is_some_and(|c|c.elicitation.is_some()) {
  let started=Instant::now();
  let preferences=tokio::time::timeout(std::time::Duration::from_secs(30),peer.elicit::<Preferences>("This is an Outrider capability probe to record your SLA tier and bundle preference. No payment information is requested.".into())).await;
  let (status,response,error)=match preferences {Ok(Ok(Some(v)))=>("Completed",Some(serde_json::to_value(v)?),None),Ok(Ok(None))=>("Declined",None,None),Ok(Err(e))=>("Failed",None,Some(e.to_string())),Err(_)=>("Failed",None,Some("Preference elicitation timed out".into()))};
  commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO probe_runs(probe_id,session_id,purpose,status,latency_ms,response,error,created_at) VALUES (?1,?2,'Outrider typed SLA and bundle preference probe',?3,?4,?5,?6,?7)",params![id(),session,status,started.elapsed().as_millis() as i64,response.map(|v|v.to_string()),error,now()])?;
 }
 if matches!(commerce.clef.status(),crate::clef::engine::EngineStatus::Ready{..}) {
  crate::clef::scorer::evaluate_session(&commerce.db,&commerce.clef,session,crate::clef::schema::Question::Noul{question:"Does the recorded session contain a completed, structurally compliant capability probe?".into()}).await?;
 }
 commerce.changed("probe.completed",Some(session));
 Ok(json!({"probe_id":probe,"status":status,"latency_ms":latency,"input_tokens":input_tokens,"output_tokens":output_tokens,"structural_compliance":compliance,"error":error}))
}
