use anyhow::{Result,Context};
use bytes::Bytes;
use http_body_util::{BodyExt,Full,Limited,StreamBody,combinators::BoxBody};
use hyper::{Request,Response,body::{Incoming,Frame}};
use serde_json::{Value,json};
use futures_util::StreamExt;
use std::{net::SocketAddr,sync::Arc};
use super::{Commerce,bundler};

#[derive(Clone,Copy,Debug)]
pub struct PeerAddress(pub SocketAddr);
type HttpResponse=Response<BoxBody<Bytes,anyhow::Error>>;
pub fn json_response(status:u16,value:Value)->HttpResponse {
    Response::builder().status(status).header("content-type","application/json").header("cache-control","no-store")
        .body(Full::new(Bytes::from(value.to_string())).map_err(|e|anyhow::anyhow!(e)).boxed()).expect("valid HTTP response")
}
pub async fn route(commerce:Arc<Commerce>,request:Request<Incoming>)->HttpResponse {
    let path=request.uri().path().strip_prefix("/__proxyfor__/commerce").unwrap_or("").to_owned();
    let method=request.method().as_str().to_owned();
    if method=="GET" && path=="/status" {return json_response(200,json!({"clef":commerce.clef.status(),"admin_allow_remote":commerce.auth.allow_remote,"probe_policy":*commerce.probe_policy.read().unwrap()}));}
    let peer=request.extensions().get::<PeerAddress>().map(|p|p.0.ip());
    let authorization=request.headers().get("authorization").and_then(|v|v.to_str().ok());
    if let Err(status)=commerce.auth.authorize(peer,authorization) {return json_response(status,json!({"error":if status==401 {"Admin bearer token required"}else{"Admin access requires a loopback peer"}}));}
    if method=="GET" && path=="/events" {
        let stream=tokio_stream::wrappers::BroadcastStream::new(commerce.events.subscribe()).filter_map(|r|async move {
            match r {Ok(event)=>Some(Ok::<_,anyhow::Error>(Frame::data(Bytes::from(format!("data: {event}\n\n"))))),Err(_)=>Some(Ok(Frame::data(Bytes::from_static(b"event: resync\ndata: {}\n\n"))))}
        });
        return Response::builder().header("content-type","text/event-stream").header("cache-control","no-cache").body(BodyExt::boxed(StreamBody::new(stream))).unwrap();
    }
    if method=="GET" && path=="/snapshot" {return match commerce.snapshot(){Ok(v)=>json_response(200,v),Err(e)=>json_response(500,json!({"error":e.to_string()}))};}
    if method!="POST" {return json_response(405,json!({"error":"Method not allowed"}));}
    let bytes=match Limited::new(request.into_body(),256*1024).collect().await {Ok(b)=>b.to_bytes(),Err(e)=>return json_response(413,json!({"error":e.to_string()}))};
    let body:Value=match serde_json::from_slice(&bytes) {Ok(v)=>v,Err(e)=>return json_response(400,json!({"error":e.to_string()}))};
    let result=mutate(&commerce,&path,body,"admin:http").await;
    match result {Ok(value)=>{commerce.changed(&path,None);json_response(200,value)},Err(e)=>json_response(422,json!({"error":format!("{e:#}")}))}
}
pub async fn mutate(commerce:&Arc<Commerce>,path:&str,body:Value,actor:&str)->Result<Value> {
    let string=|key:&str|->Result<&str>{body[key].as_str().with_context(||format!("Missing {key}"))};
    match path {
        "/receipts/issue"=>{
            let signed=commerce.receipts.issue(string("subject")?,string("bundle_id")?,body["max_calls"].as_i64().context("Missing max_calls")?,body["expires_at_unix"].as_i64().context("Missing expires_at_unix")?,actor)?;
            commerce.receipts.verify_signature(&signed)?;
            Ok(json!({"token":signed.encode()?,"signed_receipt":signed,"signature_verified":true}))
        },
        "/receipts/revoke"=>{commerce.receipts.revoke(string("receipt_id")?,actor)?;Ok(json!({"revoked":string("receipt_id")?}))},
        "/bundles/put"=>{let bundle:bundler::Bundle=serde_json::from_value(body)?;bundler::put_bundle(&commerce.db,&bundle,actor)?;Ok(serde_json::to_value(bundle)?)},
        "/evaluate"=>{
            let session=string("session_id")?;
            let question=serde_json::from_value(body["question"].clone())?;
            let row=crate::clef::scorer::evaluate_session(&commerce.db,&commerce.clef,session,question).await?;
            commerce.db.admin_audit(actor,"clef.evaluate",session,&row)?;
            anyhow::ensure!(row["status"]=="Verified","CLEF evaluation failed: {}",row["error"]);
            Ok(row)
        },
        "/probe"=>{
            let session=string("session_id")?;
            let peer=commerce.peers.lock().map_err(|_|anyhow::anyhow!("peer registry lock poisoned"))?.get(session).cloned().context("Session has no active MCP client")?;
            let result=crate::fingerprint::active::run(commerce,session,peer,false).await?;
            commerce.db.admin_audit(actor,"probe.run",session,&result)?;Ok(result)
        },
        "/offers/synthesize"=>bundler::synthesize(&commerce.db,commerce.clef.status(),string("session_id")?,actor),
        _=>anyhow::bail!("Unknown admin action")
    }
}
