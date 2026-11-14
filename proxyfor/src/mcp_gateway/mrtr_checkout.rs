use anyhow::{Result,ensure,Context,anyhow};
use rmcp::model::*;
use rusqlite::params;
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use crate::commerce::{Commerce,db::{id,now},receipt::SignedReceipt,bundler::bundle_digests};
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuoteCheckoutState {pub quote_id:String,pub session_id:String,pub subject:String,pub bundle_id:String,pub request_digest:String,pub expires_at_unix:i64}
pub fn begin(commerce:&Commerce,session:&str,subject:&str,bundle:&str,request:&CallToolRequestParams)->Result<CallToolResponse> {
 let mut original=request.clone();original.request_state=None;original.input_responses=None;original.meta=None;
 let encoded=serde_json::to_value(&original)?;
 let mut conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;
 let tx=conn.transaction()?;let digests=bundle_digests(&tx,bundle)?;
 let items:String=tx.query_row("SELECT items FROM bundles WHERE bundle_id=?1",[bundle],|r|r.get(0))?;
 let state=QuoteCheckoutState{quote_id:id(),session_id:session.into(),subject:subject.into(),bundle_id:bundle.into(),request_digest:crate::commerce::bundler::digest(&encoded)?,expires_at_unix:now()+300};
 tx.execute("INSERT INTO mrtr_quotes(quote_id,session_id,subject,bundle_id,request,item_digests,expires_at_unix) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![state.quote_id,session,subject,bundle,encoded.to_string(),serde_json::to_string(&digests)?,state.expires_at_unix])?;tx.commit()?;
 let sealed=commerce.codec.seal_json(&state)?;
 let mut requests=InputRequests::new();
 requests.insert("capability_receipt".into(),InputRequest::Elicitation(ElicitRequest::new(ElicitRequestParams::FormElicitationParams {
  meta:None,message:format!("Outrider bundle {bundle} contains exactly these item IDs: {items}. Item digests: {}. Present an operator-issued Ed25519 capability receipt. This request never issues a receipt.",serde_json::to_string(&digests)?),
  requested_schema:serde_json::from_value(json!({"type":"object","properties":{"receipt":{"type":"string","description":"Encoded signed capability receipt issued by the operator"}},"required":["receipt"]}))?
 })));
 Ok(InputRequiredResult::new(Some(requests),Some(sealed)).into())
}
pub fn finish(commerce:&Commerce,session:&str,subject:&str,request:&CallToolRequestParams)->Result<(QuoteCheckoutState,SignedReceipt)> {
 let state:QuoteCheckoutState=commerce.codec.open_json(request.request_state.as_deref().context("Missing requestState")?)?;
 ensure!(state.session_id==session && state.subject==subject && state.expires_at_unix>now(),"Quote session/subject mismatch or expiry");
 let mut original=request.clone();original.request_state=None;original.input_responses=None;original.meta=None;
 ensure!(state.request_digest==crate::commerce::bundler::digest(&serde_json::to_value(original)?)?,"Original tool request changed during checkout");
 let response=request.input_responses.as_ref().and_then(|r|r.get("capability_receipt")).context("Missing capability receipt elicitation response")?;
 let response:ElicitResult=serde_json::from_value(response.clone())?;
 ensure!(response.action==ElicitationAction::Accept,"Receipt elicitation was declined or cancelled");
 let signed=SignedReceipt::decode(response.content.as_ref().and_then(|v|v["receipt"].as_str()).context("Accepted response contains no receipt")?)?;
 // Quota and quote consumption occur together in ReceiptAuthority::redeem.
 commerce.receipts.verify(&signed,subject,&state.bundle_id)?;
 let conn=commerce.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?;
 let (saved_digests,consumed,expiry):(String,bool,i64)=conn.query_row("SELECT item_digests,consumed,expires_at_unix FROM mrtr_quotes WHERE quote_id=?1",[&state.quote_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
 ensure!(!consumed && expiry>now(),"Quote expired or already consumed");
 ensure!(serde_json::from_str::<Vec<String>>(&saved_digests)?==bundle_digests(&conn,&state.bundle_id)?,"Quoted bundle changed");
 Ok((state,signed))
}
