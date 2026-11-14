use anyhow::{Result,Context,ensure,anyhow};
use rmcp::{ServerHandler,model::*,service::{RequestContext,RoleServer,SubscriptionContext},task_manager::{TaskExit,TaskOptions}};
use rusqlite::{params,OptionalExtension};
use serde_json::{Value,json};
use std::{sync::Arc,borrow::Cow,collections::HashSet};
use crate::commerce::{Commerce,db::{id,now},receipt::SignedReceipt,bundler};
use super::{mrtr_checkout::{self},federation::frame};

#[derive(Clone)]
pub struct CommerceGateway {pub commerce:Arc<Commerce>,legacy_session:Arc<String>}
fn error(e:impl std::fmt::Display)->ErrorData {ErrorData::invalid_params(e.to_string(),None)}
fn complete(v:Value)->CallToolResponse {CallToolResult::success(vec![ContentBlock::text(v.to_string())]).into()}
const BUILTINS:[&str;7]=["outrider_catalog","outrider_fingerprint_me","outrider_run_probe","outrider_synthesized_offers","outrider_checkout_bundle","outrider_verify_receipt","outrider_receipt_status"];
impl CommerceGateway {
 pub fn new(commerce:Arc<Commerce>)->Self {Self{commerce,legacy_session:Arc::new(id())}}
 fn token(&self,context:&RequestContext<RoleServer>)->Option<String> {
  let meta=serde_json::to_value(&context.meta).ok()?;
  meta["outrider/receipt"].as_str().map(str::to_owned).or_else(||context.extensions.get::<http::request::Parts>().and_then(|p|p.headers.get("authorization")).and_then(|v|v.to_str().ok()).and_then(|s|s.strip_prefix("Bearer ")).map(str::to_owned))
 }
 async fn session(&self,context:&RequestContext<RoleServer>,quote:Option<&str>)->Result<(String,String)> {
  let meta=serde_json::to_value(&context.meta)?;
  let parts=context.extensions.get::<http::request::Parts>();
  let explicit=meta["outrider/session_id"].as_str().or_else(||parts.and_then(|p|p.headers.get("outrider-session-id")).and_then(|h|h.to_str().ok()));
  let sealed=quote.map(|s|self.commerce.codec.open_json::<Value>(s)).transpose()?;
  let signed=self.token(context).map(|s|SignedReceipt::decode(&s)).transpose()?;
  if let Some(s)=&signed {self.commerce.receipts.verify_signature(s)?;}
  let connection=parts.and_then(|p|p.extensions.get::<crate::fingerprint::passive::ConnectionEvidence>());
  let fallback=connection.map(|c|c.connection_id.as_str()).unwrap_or(self.legacy_session.as_str());
  let session=if let Some(state)=&sealed {if let Some(explicit)=explicit {ensure!(Some(explicit)==state["session_id"].as_str(),"Quote belongs to another session");}state["session_id"].as_str().context("Sealed state has no session")?.to_owned()}
   else if let Some(explicit)=explicit {ensure!(uuid::Uuid::parse_str(explicit).is_ok(),"Outrider session id must be a UUID");explicit.into()}
   else if let Some(receipt)=&signed {if !receipt.receipt.subject.starts_with("https://") {receipt.receipt.subject.clone()}else{fallback.into()}}
   else {fallback.into()};
  let client_id=meta["outrider/client_id"].as_str();
  let mut subject=client_id.unwrap_or(&session).to_owned();
  let existing:Option<String>={let conn=self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;conn.query_row("SELECT subject FROM agent_sessions WHERE session_id=?1",[&session],|r|r.get(0)).optional()?};
  let is_new=existing.is_none();
  if let Some(old)=existing {if client_id.is_some(){ensure!(old==subject,"Session client_id cannot change");}subject=old;}
  else {
   let client=json!({"protocolVersion":context.protocol_version(),"clientInfo":context.client_info(),"capabilities":context.client_capabilities()});
   if let Some(url)=client_id {let metadata=crate::fingerprint::passive::cimd(url).await?;crate::fingerprint::passive::observe(&self.commerce.db,None,connection.map(|c|c.connection_id.as_str()),"cimd",json!({"client_id":url,"metadata":metadata,"verification":"HTTPS metadata validated; ownership is not authenticated"}))?;}
   let conn=self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;
   conn.execute("INSERT OR IGNORE INTO agent_sessions(session_id,subject,client_config,transport,created_at) VALUES (?1,?2,?3,?4,?5)",params![session,subject,client.to_string(),if parts.is_some(){"http"}else{"stdio"},now()])?;
  }
  if let Some(connection)=connection {self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("UPDATE fingerprint_observations SET session_id=?1 WHERE connection_id=?2 AND session_id IS NULL",params![session,connection.connection_id])?;}
  if let Some(signed)=signed {self.commerce.receipts.verify(&signed,&subject,&signed.receipt.bundle_id)?;self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT OR IGNORE INTO presented_receipts(session_id,receipt_id) VALUES (?1,?2)",params![session,signed.receipt.receipt_id])?;}
  {let mut peers=self.commerce.peers.lock().map_err(|_|anyhow!("peer registry poisoned"))?;
   if peers.get(&session).is_none_or(|p|p.is_transport_closed()) {peers.insert(session.clone(),context.peer.clone());}}

  if is_new {self.commerce.changed("session.connected",Some(&session));}
  {
   if context.protocol_version().is_none_or(|v|v<ProtocolVersion::V_2026_07_28) && *self.commerce.probe_policy.read().unwrap()==crate::fingerprint::active::ProbePolicy::Auto && context.client_capabilities().is_some_and(|c|c.sampling.is_some()) {
    let start={self.commerce.auto_probed.lock().unwrap().insert(session.clone())};
    if start {crate::fingerprint::active::run(&self.commerce,&session,context.peer.clone(),true).await?;}
   }
  }
  Ok((session,subject))
 }
 fn record(&self,context:&RequestContext<RoleServer>,session:&str,method:&str,body:&Value)->Result<()> {
  frame(&self.commerce.db,Some(session),None,"request",method,body)?;
  let parts=context.extensions.get::<http::request::Parts>();
  let mut cadence=self.commerce.cadence.lock().map_err(|_|anyhow!("cadence lock poisoned"))?;
  let is_first=!cadence.contains_key(session);
  let entry=cadence.entry(session.into()).or_insert_with(||(std::time::Instant::now(),Vec::new()));
  let elapsed=entry.0.elapsed().as_secs_f64()*1000.;entry.0=std::time::Instant::now();if !is_first {entry.1.push(elapsed);}if entry.1.len()>1024 {entry.1.remove(0);}
  let mut values=entry.1.clone();values.sort_by(f64::total_cmp);let len=values.len();
  let evidence=json!({"user_agent":parts.and_then(|p|p.headers.get("user-agent")).and_then(|h|h.to_str().ok()),"mcp_session_id":parts.and_then(|p|p.headers.get("mcp-session-id")).and_then(|h|h.to_str().ok()),"request_id":context.id,"cadence_ms":{"sample_count":len,"mean":if len>0{Some(values.iter().sum::<f64>()/len as f64)}else{None},"p50":values.get(((len as f64*0.50).ceil()as usize).saturating_sub(1)),"p95":values.get(((len as f64*0.95).ceil()as usize).saturating_sub(1))}});
  drop(cadence);crate::fingerprint::passive::observe(&self.commerce.db,Some(session),None,"mcp_request",evidence)
 }
 fn receipts(&self,session:&str,subject:&str)->Result<Vec<SignedReceipt>> {
  let records={let conn=self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;let mut stmt=conn.prepare("SELECT r.payload,r.signature FROM capability_receipts r JOIN presented_receipts p ON p.receipt_id=r.receipt_id WHERE p.session_id=?1")?;stmt.query_map([session],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?};
  let mut valid=Vec::new();for (payload,signature) in records {let signed=SignedReceipt{receipt:serde_json::from_str(&payload)?,signature};if self.commerce.receipts.verify(&signed,subject,&signed.receipt.bundle_id).is_ok(){valid.push(signed)}}Ok(valid)
 }
 fn entitled(&self,session:&str,subject:&str)->Result<HashSet<String>> {
  let receipts=self.receipts(session,subject)?;let bundles=bundler::bundles(&self.commerce.db)?;
  Ok(bundles.into_iter().filter(|b|receipts.iter().any(|r|r.receipt.bundle_id==b.bundle_id)).flat_map(|b|b.items).collect())
 }
 fn catalog(&self)->Result<Vec<Value>> {Ok(self.commerce.db.rows("catalog_items")?.as_array().unwrap().clone())}
 fn builtin(name:&str)->Tool {
  Tool::new(name.to_owned(),match name {"outrider_catalog"=>"List configured catalog and receipt requirements", "outrider_fingerprint_me"=>"Read your own captured fingerprint evidence","outrider_run_probe"=>"Run a disclosed capability probe","outrider_synthesized_offers"=>"Read or synthesize session bundle offers","outrider_checkout_bundle"=>"Present an operator-issued receipt to unlock or execute a bundle","outrider_verify_receipt"=>"Verify a capability receipt for your own subject",_=>"Read remaining quota and expiry of your own receipts"},Arc::new(json!({"type":"object","properties":{"bundle_id":{"type":"string"},"receipt":{"type":"string"},"execute":{"type":"boolean"},"tool_arguments":{"type":"object"}}}).as_object().unwrap().clone()))
 }
 async fn call(&self,mut request:CallToolRequestParams,context:RequestContext<RoleServer>)->Result<CallToolResponse> {
  let (session,subject)=self.session(&context,request.request_state.as_deref()).await?;
  self.record(&context,&session,"tools/call",&serde_json::to_value(&request)?)?;
  let is_2026=context.protocol_version().is_some_and(|v|v>=ProtocolVersion::V_2026_07_28);
  let was_probe=is_2026 && crate::fingerprint::mrtr::is_probe(&self.commerce,request.request_state.as_deref())?;
  if was_probe {
   let result=crate::fingerprint::mrtr::finish(&self.commerce,&session,&subject,&request).await?;
   if request.name=="outrider_run_probe" {return Ok(complete(result))}
   request.request_state=None;request.input_responses=None;
  } else if is_2026 && request.request_state.is_none() {
   let forced=request.name=="outrider_run_probe";
   let policy=*self.commerce.probe_policy.read().unwrap();
   let seen={let conn=self.commerce.db.0.lock().unwrap();conn.query_row("SELECT COUNT(*) FROM probe_runs WHERE session_id=?1",[&session],|r|r.get::<_,i64>(0))?>0};
   if forced || (policy==crate::fingerprint::active::ProbePolicy::Auto && !seen && context.client_capabilities().is_some_and(|c|c.sampling.is_some())) {
    return crate::fingerprint::mrtr::begin(&self.commerce,&session,&subject,&request,&context.client_capabilities().unwrap_or_default());
   }
  }
  let args=request.arguments.clone().unwrap_or_default();
  let name=request.name.as_ref();
  match name {
   "outrider_catalog"=>return Ok(complete(json!({"session_id":session,"subject":subject,"clef":self.commerce.clef.status(),"catalog":self.catalog()?,"bundles":bundler::bundles(&self.commerce.db)?}))),
   "outrider_fingerprint_me"=>{let rows=self.commerce.db.rows("fingerprint_observations")?;return Ok(complete(json!({"session_id":session,"observations":rows.as_array().unwrap().iter().filter(|r|r["session_id"]==session).collect::<Vec<_>>()})))},
   "outrider_run_probe"=>return Ok(complete(crate::fingerprint::active::run(&self.commerce,&session,context.peer,false).await?)),
   "outrider_synthesized_offers"=>return Ok(complete(bundler::synthesize(&self.commerce.db,self.commerce.clef.status(),&session,"agent:offer-request")?)),
   "outrider_verify_receipt"=>{let signed=SignedReceipt::decode(args.get("receipt").and_then(Value::as_str).context("Missing receipt")?)?;let remaining=self.commerce.receipts.verify(&signed,&subject,&signed.receipt.bundle_id)?;return Ok(complete(json!({"signature_verified":true,"remaining_calls":remaining,"expires_at_unix":signed.receipt.expires_at_unix})))},
   "outrider_receipt_status"=>{let rows=self.commerce.db.rows("capability_receipts")?;return Ok(complete(json!({"receipts":rows.as_array().unwrap().iter().filter(|r|r["subject"]==subject).map(|r|json!({"receipt_id":r["receipt_id"],"bundle_id":r["bundle_id"],"remaining_calls":r["remaining_calls"],"expires_at_unix":r["expires_at_unix"],"revoked":r["revoked"]})).collect::<Vec<_>>()})))},_=>{}
  }
  let bundle=if name=="outrider_checkout_bundle" {args.get("bundle_id").and_then(Value::as_str).context("Missing bundle_id")?.to_owned()}
   else {ensure!(self.catalog()?.iter().any(|i|i["item_id"]==name && i["kind"]=="tool"),"Unknown tool");bundler::bundles(&self.commerce.db)?.into_iter().find(|b|b.items.iter().any(|i|i==name)).context("Tool has no configured bundle")?.bundle_id};
  let (signed,quote)=if request.request_state.is_some() {let (state,signed)=mrtr_checkout::finish(&self.commerce,&session,&subject,&request)?;ensure!(state.bundle_id==bundle,"Quote bundle mismatch");(signed,Some(state.quote_id))}
   else if let Some(token)=self.token(&context) {let signed=SignedReceipt::decode(&token)?;self.commerce.receipts.verify(&signed,&subject,&bundle)?;(signed,None)}
   else if let Some(signed)=self.receipts(&session,&subject)?.into_iter().find(|r|r.receipt.bundle_id==bundle) {(signed,None)}
   else {return mrtr_checkout::begin(&self.commerce,&session,&subject,&bundle,&request)};
  self.commerce.receipts.redeem(&signed,&subject,&bundle,&session,name,quote.as_deref())?;
  self.commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("UPDATE agent_sessions SET state='Entitled' WHERE session_id=?1",[&session])?;
  self.commerce.changed("receipt.redeemed",Some(&session));
  if name=="outrider_checkout_bundle" && args.get("execute")!=Some(&Value::Bool(true)) {return Ok(complete(json!({"session_id":session,"bundle_id":bundle,"receipt_id":signed.receipt.receipt_id,"remaining_calls":self.commerce.receipts.verify(&signed,&subject,&bundle).ok()})))}
  let items=if name=="outrider_checkout_bundle" {bundler::bundles(&self.commerce.db)?.into_iter().find(|b|b.bundle_id==bundle).unwrap().items}else{vec![name.into()]};
  let jobs=self.catalog()?.into_iter().filter(|i|i["kind"]=="tool" && items.iter().any(|s|i["item_id"]==*s)).map(|i|{let tool=i["descriptor"]["remote_name"].as_str().unwrap_or("").to_owned();let upstream=i["upstream_name"].as_str().unwrap_or("").to_owned();let args=if name=="outrider_checkout_bundle" {args.get("tool_arguments").and_then(|v|v.get(i["item_id"].as_str().unwrap())).and_then(Value::as_object).cloned().unwrap_or_default()}else{args.clone()};(upstream,tool,args)}).collect::<Vec<_>>();
  ensure!(!jobs.is_empty(),"Bundle contains no executable tools");
  if context.client_capabilities().is_some_and(|c|c.supports_tasks()) {
   let commerce=self.commerce.clone();let owner=session.clone();
   let task=self.commerce.tasks.spawn(TaskOptions::default(),move|ctx|Box::pin(async move {
    let mut outputs=Vec::new();for (upstream,tool,args) in jobs {tokio::select! {
     _=ctx.cancelled()=>return Err(TaskExit::Cancelled),
     result=commerce.federation.call(&commerce,&owner,&upstream,&tool,args)=>outputs.push(result.map_err(|e|TaskExit::Error(error(e)))?)
    }}Ok(CallToolResult::success(vec![ContentBlock::text(serde_json::to_string(&outputs).map_err(|e|TaskExit::Error(error(e)))?)]))
   }));
   frame(&self.commerce.db,Some(&session),None,"response","tasks/create",&serde_json::to_value(&task)?)?;
  self.commerce.task_owners.lock().unwrap().insert(task.task_id.clone(),session);
   return Ok(CallToolResponse::Task(CreateTaskResult::new(task)))
  }
  let mut outputs=Vec::new();for (upstream,tool,args) in jobs {outputs.push(self.commerce.federation.call(&self.commerce,&session,&upstream,&tool,args).await?);}
  if outputs.len()==1 {Ok(outputs.remove(0).into())}else{Ok(complete(serde_json::to_value(outputs)?))}
 }
 fn allowed_skill_files(&self,items:&HashSet<String>)->HashSet<String> {
  self.commerce.skills.read().unwrap().as_ref().map(|s|s.skills().into_iter().filter(|s|items.contains(&s.uri)).flat_map(|s|match s.resources {SkillResources::Files(f)=>f.into_iter().map(|f|f.uri).collect(),_=>vec![]}).collect()).unwrap_or_default()
 }
}
impl ServerHandler for CommerceGateway {
 fn supported_protocol_versions(&self)->Cow<'static,[ProtocolVersion]> {Cow::Borrowed(&[ProtocolVersion::V_2026_07_28])}
 fn get_info(&self)->ServerConfig {let mut info=ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_tool_list_changed().enable_resources().enable_prompts().enable_skills_with_directory_read().enable_tasks().build()).with_instructions("Outrider uses operator-issued Ed25519 receipts. No agent action issues a receipt. Supply Outrider-Session-Id or _meta outrider/session_id to retain a logical session across stateless HTTP connections. Automatic capability probes disclose their purpose.");info.protocol_version=ProtocolVersion::V_2026_07_28;info}
 fn get_tool(&self,name:&str)->Option<Tool> {if BUILTINS.contains(&name){Some(Self::builtin(name))}else{self.catalog().ok()?.into_iter().find(|v|v["item_id"]==name).and_then(|v|serde_json::from_value(v["descriptor"]["tool"].clone()).ok())}}
 async fn initialize(&self,request:InitializeRequestParams,context:RequestContext<RoleServer>)->Result<InitializeResult,ErrorData>{context.peer.set_peer_info(request.clone());self.negotiate_initialize(&request)}
 async fn discover(&self,context:RequestContext<RoleServer>)->Result<DiscoverResult,ErrorData>{let (session,_)=self.session(&context,None).await.map_err(error)?;self.record(&context,&session,"server/discover",&json!({})).map_err(error)?;Ok(DiscoverResult::from_server_info(self.supported_protocol_versions().into_owned(),self.get_info()))}
 async fn list_tools(&self,_:Option<PaginatedRequestParams>,context:RequestContext<RoleServer>)->Result<ListToolsResult,ErrorData>{let (session,subject)=self.session(&context,None).await.map_err(error)?;self.record(&context,&session,"tools/list",&json!({})).map_err(error)?;let entitled=self.entitled(&session,&subject).map_err(error)?;let mut tools=BUILTINS.iter().map(|n|Self::builtin(n)).collect::<Vec<_>>();for row in self.catalog().map_err(error)? {if row["kind"]=="tool" && entitled.contains(row["item_id"].as_str().unwrap_or("")) {tools.push(serde_json::from_value(row["descriptor"]["tool"].clone()).map_err(error)?);}}Ok(ListToolsResult::with_all_items(tools).with_ttl_ms(0).with_cache_scope(CacheScope::Private))}
 async fn call_tool(&self,r:CallToolRequestParams,c:RequestContext<RoleServer>)->Result<CallToolResponse,ErrorData>{self.call(r,c).await.map_err(error)}
 fn accepted_subscription_filter(&self,r:&SubscriptionFilter)->Option<SubscriptionFilter>{Some(r.supported_by(&self.get_info().capabilities))}
 async fn listen(&self,c:SubscriptionContext)->Result<(),ErrorData>{let (_session,_)=self.session(c.request_context(),None).await.map_err(error)?;let mut events=self.commerce.events.subscribe();loop {tokio::select!{_=c.cancelled()=>return Ok(()),e=events.recv()=>{if e.is_err(){continue}c.sink().notify_tool_list_changed().await.map_err(error)?;}}}}
 async fn list_skills(&self,_:Option<PaginatedRequestParams>,c:RequestContext<RoleServer>)->Result<ListSkillsResult,ErrorData>{let (s,u)=self.session(&c,None).await.map_err(error)?;let items=self.entitled(&s,&u).map_err(error)?;let skills=self.commerce.skills.read().unwrap().as_ref().map(|cat|cat.skills().into_iter().filter(|s|items.contains(&s.uri)).collect()).unwrap_or_default();Ok(ListSkillsResult::with_all_items(skills).with_ttl_ms(0).with_cache_scope(CacheScope::Private))}
 async fn get_skill(&self,r:GetSkillRequestParams,c:RequestContext<RoleServer>)->Result<GetSkillResult,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;ensure_mcp(self.entitled(&s,&u).map_err(error)?.contains(&r.uri),"Skill requires a valid bundle receipt")?;self.commerce.skills.read().unwrap().as_ref().ok_or_else(||error("No skill catalog configured"))?.get_skill(&r.uri)}
 async fn list_resources(&self,_:Option<PaginatedRequestParams>,c:RequestContext<RoleServer>)->Result<ListResourcesResult,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;let allowed=self.allowed_skill_files(&self.entitled(&s,&u).map_err(error)?);let mut resources:Vec<Resource>=self.commerce.skills.read().unwrap().as_ref().map(|s|s.resources().into_iter().filter(|r|allowed.contains(&r.uri)).collect()).unwrap_or_default();
  let items=self.entitled(&s,&u).map_err(error)?;
  for item in self.catalog().map_err(error)? {if item["kind"]=="resource" && items.contains(item["item_id"].as_str().unwrap_or("")){resources.push(serde_json::from_value(item["descriptor"]["resource"].clone()).map_err(error)?);}}
  Ok(ListResourcesResult::with_all_items(resources).with_ttl_ms(0).with_cache_scope(CacheScope::Private))}
 async fn read_resource(&self,r:ReadResourceRequestParams,c:RequestContext<RoleServer>)->Result<ReadResourceResponse,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;let allowed=self.allowed_skill_files(&self.entitled(&s,&u).map_err(error)?);if allowed.contains(&r.uri) {return self.commerce.skills.read().unwrap().as_ref().and_then(|s|s.read_resource(&r.uri)).map(Into::into).ok_or_else(||error("Unknown resource"))}
  let items=self.entitled(&s,&u).map_err(error)?;
  let item=self.catalog().map_err(error)?.into_iter().find(|i|i["kind"]=="resource" && i["descriptor"]["resource"]["uri"]==r.uri && items.contains(i["item_id"].as_str().unwrap_or(""))).ok_or_else(||error("Resource requires a valid bundle receipt"))?;
  let upstream=item["upstream_name"].as_str().unwrap();let remote=item["descriptor"]["remote_uri"].as_str().unwrap();
  frame(&self.commerce.db,Some(&s),Some(upstream),"request","resources/read",&json!({"uri":remote})).map_err(error)?;
  let mut result=self.commerce.federation.client(upstream).await.map_err(error)?.read_resource(ReadResourceRequestParams::new(remote.to_owned())).await.map_err(error)?;
  for contents in &mut result.contents {match contents {ResourceContents::TextResourceContents{uri,..}|ResourceContents::BlobResourceContents{uri,..}=>*uri=r.uri.clone(),_=>{}}}
  frame(&self.commerce.db,Some(&s),Some(upstream),"response","resources/read",&serde_json::to_value(&result).map_err(error)?).map_err(error)?;
  Ok(result.into())}
 async fn read_resource_directory(&self,r:ReadResourceDirectoryRequestParams,c:RequestContext<RoleServer>)->Result<ReadResourceDirectoryResult,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;let allowed=self.allowed_skill_files(&self.entitled(&s,&u).map_err(error)?);let skills=self.commerce.skills.read().unwrap();let cat=skills.as_ref().ok_or_else(||error("No skill catalog configured"))?;let mut result=cat.read_resource_directory(&r.uri)?;result.resources.retain(|entry|allowed.contains(&entry.uri));Ok(result)}
 async fn list_prompts(&self,_:Option<PaginatedRequestParams>,c:RequestContext<RoleServer>)->Result<ListPromptsResult,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;let allowed=self.entitled(&s,&u).map_err(error)?;let mut prompts=Vec::new();for i in self.catalog().map_err(error)? {if i["kind"]=="prompt" && allowed.contains(i["item_id"].as_str().unwrap_or("")){let mut p:Prompt=serde_json::from_value(i["descriptor"]["prompt"].clone()).map_err(error)?;p.name=i["item_id"].as_str().unwrap().into();prompts.push(p)}}Ok(ListPromptsResult::with_all_items(prompts).with_ttl_ms(0).with_cache_scope(CacheScope::Private))}
 async fn get_prompt(&self,r:GetPromptRequestParams,c:RequestContext<RoleServer>)->Result<GetPromptResponse,ErrorData>{let(s,u)=self.session(&c,None).await.map_err(error)?;ensure_mcp(self.entitled(&s,&u).map_err(error)?.contains(&r.name),"Prompt requires a valid bundle receipt")?;let item=self.catalog().map_err(error)?.into_iter().find(|i|i["item_id"]==r.name).ok_or_else(||error("Unknown prompt"))?;let client=self.commerce.federation.client(item["upstream_name"].as_str().unwrap()).await.map_err(error)?;let mut req=r;req.name=item["descriptor"]["prompt"]["name"].as_str().unwrap().into();client.get_prompt(req).await.map(Into::into).map_err(error)}
 async fn get_task(&self,r:GetTaskParams,c:RequestContext<RoleServer>)->Result<GetTaskResult,ErrorData>{let(s,_)=self.session(&c,None).await.map_err(error)?;ensure_mcp(self.commerce.task_owners.lock().unwrap().get(&r.task_id)==Some(&s),"Task belongs to another session")?;{let task=self.commerce.tasks.get_task(&r.task_id)?;frame(&self.commerce.db,Some(&s),None,"response","tasks/get",&serde_json::to_value(&task).map_err(error)?).map_err(error)?;Ok(GetTaskResult::new(task))}}
 async fn update_task(&self,r:UpdateTaskParams,c:RequestContext<RoleServer>)->Result<(),ErrorData>{let(s,_)=self.session(&c,None).await.map_err(error)?;ensure_mcp(self.commerce.task_owners.lock().unwrap().get(&r.task_id)==Some(&s),"Task belongs to another session")?;self.record(&c,&s,"tasks/update",&serde_json::to_value(&r).map_err(error)?).map_err(error)?;self.commerce.tasks.update_task(&r.task_id,r.input_responses)}
 async fn cancel_task(&self,r:CancelTaskParams,c:RequestContext<RoleServer>)->Result<(),ErrorData>{let(s,_)=self.session(&c,None).await.map_err(error)?;ensure_mcp(self.commerce.task_owners.lock().unwrap().get(&r.task_id)==Some(&s),"Task belongs to another session")?;self.record(&c,&s,"tasks/cancel",&serde_json::to_value(&r).map_err(error)?).map_err(error)?;self.commerce.tasks.cancel_task(&r.task_id)}
}
fn ensure_mcp(condition:bool,message:&str)->Result<(),ErrorData>{if condition {Ok(())}else{Err(error(message))}}
