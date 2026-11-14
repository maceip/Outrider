//! MCP 2026 prohibits reverse peer requests. Probes travel as SEP-2322 inputs.
#![allow(deprecated)]
use anyhow::{Result,ensure,Context,anyhow};
use rmcp::model::*;
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use rusqlite::params;
use std::sync::Arc;
use crate::commerce::{Commerce,db::{id,now}};
use super::active::{PURPOSE,ProbePolicy};
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeState {pub flow:String,pub probe_id:String,pub session_id:String,pub subject:String,pub request_digest:String,pub started_at_unix_ms:u64,pub expires_at_unix:i64,pub preferences:bool}
fn request_digest(r:&CallToolRequestParams)->Result<String>{let mut r=r.clone();r.meta=None;r.request_state=None;r.input_responses=None;crate::commerce::bundler::digest(&serde_json::to_value(r)?)}
pub fn is_probe(commerce:&Commerce,state:Option<&str>)->Result<bool>{Ok(state.map(|s|commerce.codec.open_json::<Value>(s)).transpose()?.is_some_and(|v|v["flow"]=="capability_probe"))}
pub fn begin(commerce:&Arc<Commerce>,session:&str,subject:&str,request:&CallToolRequestParams,capabilities:&ClientCapabilities)->Result<CallToolResponse>{
 let policy=*commerce.probe_policy.read().unwrap();ensure!(policy!=ProbePolicy::Off,"Probes disabled by operator");ensure!(capabilities.sampling.is_some(),"Client does not advertise sampling");
 let state=ProbeState{flow:"capability_probe".into(),probe_id:id(),session_id:session.into(),subject:subject.into(),request_digest:request_digest(request)?,started_at_unix_ms:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis() as u64,expires_at_unix:now()+30,preferences:capabilities.elicitation.is_some()};
 commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO probe_runs(probe_id,session_id,purpose,status,input_tokens,created_at) VALUES (?1,?2,?3,'Awaiting client input',?4,?5)",params![state.probe_id,session,PURPOSE,commerce.clef.tokenize(PURPOSE).ok().map(|n|n as i64),now()])?;
 let mut inputs=InputRequests::new();
 inputs.insert("capability_probe".into(),InputRequest::CreateMessage(CreateMessageRequest::new(CreateMessageRequestParams::new(vec![SamplingMessage::user_text(PURPOSE)],32).with_include_context(ContextInclusion::None).with_temperature(0.0))));
 if state.preferences {inputs.insert("preferences".into(),InputRequest::Elicitation(ElicitRequest::new(ElicitRequestParams::FormElicitationParams{meta:None,message:"This is an Outrider capability probe to record your SLA tier and bundle preference. No payment information is requested.".into(),requested_schema:serde_json::from_value(json!({"type":"object","properties":{"sla_tier":{"type":"string"},"bundle_preference":{"type":"string"}},"required":["sla_tier","bundle_preference"]}))?})));}
 let commerce_timeout=commerce.clone();let probe_id=state.probe_id.clone();let session_id=session.to_owned();
 tokio::spawn(async move {tokio::time::sleep(std::time::Duration::from_secs(30)).await;
  if let Ok(conn)=commerce_timeout.db.0.lock(){let _=conn.execute("UPDATE probe_runs SET status='Timed out',error='Client did not return probe input within 30 seconds; no decline can be inferred' WHERE probe_id=?1 AND status='Awaiting client input'",[probe_id]);}
  commerce_timeout.changed("probe.timeout",Some(&session_id));
 });
 commerce.changed("probe.awaiting_input",Some(session));
 Ok(InputRequiredResult::new(Some(inputs),Some(commerce.codec.seal_json(&state)?)).into())
}
pub async fn finish(commerce:&Arc<Commerce>,session:&str,subject:&str,request:&CallToolRequestParams)->Result<Value>{
 let state:ProbeState=commerce.codec.open_json(request.request_state.as_deref().context("Missing probe state")?)?;
 ensure!(state.flow=="capability_probe" && state.session_id==session && state.subject==subject && state.expires_at_unix>now(),"Probe state expired or belongs to another session");
 ensure!(state.request_digest==request_digest(request)?,"Original request changed during probe");
 let input=request.input_responses.as_ref().and_then(|r|r.get("capability_probe")).context("Missing capability probe input response")?;
 let parsed=serde_json::from_value::<CreateMessageResult>(input.clone());
 let (status,compliance,output,error)=match parsed {
  Ok(result)=>{let text=result.message.content.iter().filter_map(|v|v.as_text()).map(|v|v.text.as_str()).collect::<String>();let compliant=serde_json::from_str::<Value>(&text).ok().is_some_and(|v|v==json!({"ack":"outrider"}));("Completed",Some(compliant),Some(text),None)},
  Err(e)=>{let declined=input["declined"]==true;let reason=input["reason"].as_str().map(str::to_owned).unwrap_or_else(||e.to_string());(if declined{"Declined"}else{"Failed"},None,None,Some(reason))}
 };
 let elapsed=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis().saturating_sub(state.started_at_unix_ms as u128)as i64;
 {let mut conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;let tx=conn.transaction()?;
  ensure!(tx.execute("UPDATE probe_runs SET status=?2,latency_ms=?3,output_tokens=?4,structural_compliance=?5,response=?6,error=?7 WHERE probe_id=?1 AND session_id=?8 AND status='Awaiting client input'",params![state.probe_id,status,elapsed,output.as_deref().and_then(|s|commerce.clef.tokenize(s).ok()).map(|n|n as i64),compliance,input.to_string(),error,session])?==1,"Probe state already consumed or timed out");
  if status=="Completed" {tx.execute("UPDATE agent_sessions SET state='Probed' WHERE session_id=?1",[session])?;}
  if state.preferences {let response=request.input_responses.as_ref().and_then(|r|r.get("preferences")).context("Missing preference response")?;let elicited:ElicitResult=serde_json::from_value(response.clone())?;
   let status=if elicited.action==ElicitationAction::Accept {let _:super::active::Preferences=serde_json::from_value(elicited.content.clone().context("Accepted preferences have no content")?)?;"Completed"}else{"Declined"};
   tx.execute("INSERT INTO probe_runs(probe_id,session_id,purpose,status,latency_ms,response,created_at) VALUES (?1,?2,'Outrider typed SLA and bundle preference probe',?3,?4,?5,?6)",params![id(),session,status,elapsed,response.to_string(),now()])?;
  }
  tx.commit()?;
 }
 commerce.changed("probe.completed",Some(session));
 if matches!(commerce.clef.status(),crate::clef::engine::EngineStatus::Ready{..}) {crate::clef::scorer::evaluate_session(&commerce.db,&commerce.clef,session,crate::clef::schema::Question::Noul{question:"Does the record contain a completed structurally compliant Outrider probe?".into()}).await?;}
 Ok(json!({"probe_id":state.probe_id,"status":status,"latency_ms":elapsed,"latency_scope":"client round trip including sampling","structural_compliance":compliance,"error":error}))
}
