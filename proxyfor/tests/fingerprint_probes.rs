#![allow(deprecated)]
mod common;
use anyhow::Result;
use proxyfor::{clef::engine::{ClefConfig,ClefEngine},commerce::{Commerce,db::Database},fingerprint::active::{self,ProbePolicy}};
use rmcp::{ServerHandler,ClientHandler,ServiceExt,model::*,service::{RequestContext,NotificationContext,RoleServer,RoleClient}};
use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
use serde_json::json;

async fn runtime(dir:&std::path::Path)->Result<Arc<Commerce>> {
 let db=Database::open(dir.join("db.sqlite"))?;let engine=ClefEngine::load(ClefConfig{model:None,backend:"cpu".into(),threads:1,workers:1,cache_dir:dir.into()}).await?;
 Ok(Commerce::new(db,engine,dir,false)?.0)
}
#[derive(Clone)]
struct ProbeServer(Arc<Commerce>);
impl ServerHandler for ProbeServer {
 async fn initialize(&self,r:InitializeRequestParams,c:RequestContext<RoleServer>)->Result<InitializeResult,ErrorData>{
  self.0.db.record_session("s","s",&serde_json::to_value(&r).unwrap(),"duplex").unwrap();c.peer.set_peer_info(r.clone());self.negotiate_initialize(&r)
 }
 async fn on_initialized(&self,c:NotificationContext<RoleServer>){
  if *self.0.probe_policy.read().unwrap()==ProbePolicy::Auto {active::run(&self.0,"s",c.peer,true).await.unwrap();}
 }
}
#[derive(Clone)]
struct ProbeClient {count:Arc<AtomicUsize>,decline:bool}
impl ClientHandler for ProbeClient {
 fn get_info(&self)->ClientConfig {ClientConfig::new(ClientCapabilities::builder().enable_sampling().build(),Implementation::new("probe-integration","1"))}
 async fn create_message(&self,r:CreateMessageRequestParams,_:RequestContext<RoleClient>)->Result<CreateMessageResult,ErrorData>{
  self.count.fetch_add(1,Ordering::SeqCst);
  let text=r.messages[0].content.first().unwrap().as_text().unwrap().text.clone();
  assert!(text.contains("This is an Outrider capability probe") && text.contains("purpose"));
  if self.decline {Err(ErrorData::invalid_request("Client explicitly declined capability probe",None))} else {Ok(CreateMessageResult::new(SamplingMessage::assistant_text("{\"ack\":\"outrider\"}"),"integration-client".into()))}
 }
}
#[tokio::test]
async fn real_client_default_auto_off_and_declined()->Result<()> {
 for (policy,decline,expected) in [(ProbePolicy::Auto,false,"Completed"),(ProbePolicy::Off,false,"None"),(ProbePolicy::Auto,true,"Declined")] {
  let dir=tempfile::tempdir()?;let rt=runtime(dir.path()).await?;*rt.probe_policy.write().unwrap()=policy;
  let (server,client)=tokio::io::duplex(65536);let handler=ProbeServer(rt.clone());
  let serving=tokio::spawn(async move{handler.serve(server).await.unwrap().waiting().await});
  let count=Arc::new(AtomicUsize::new(0));let client=ProbeClient{count:count.clone(),decline}.serve(client).await?;
  tokio::time::timeout(std::time::Duration::from_secs(5),async{loop {
   let rows=rt.db.rows("probe_runs").unwrap();
   if policy==ProbePolicy::Off {client.ping().await.unwrap();tokio::time::sleep(std::time::Duration::from_millis(100)).await;assert_eq!(count.load(Ordering::SeqCst),0);assert_eq!(rows,json!([]));break}
   if let Some(row)=rows.as_array().unwrap().first(){assert_eq!(row["status"],expected);assert!(row["latency_ms"].is_i64());assert!(row["input_tokens"].is_null());assert!(row["output_tokens"].is_null());if !decline{assert_eq!(row["structural_compliance"],1)}break}
   tokio::time::sleep(std::time::Duration::from_millis(10)).await;
  }}).await?;
  client.cancel().await?;serving.await??;
 }
 Ok(())
}
/// Independent raw-wire decoder used only by the real TLS integration gate.
fn independent_fingerprint(raw:&[u8])->String {
 use sha2::{Sha256,Digest};
 fn hash(s:String)->String{format!("{:x}",Sha256::digest(s.as_bytes()))[..12].into()}
 fn vector(v:&[u16])->String{v.iter().map(|n|format!("{n:04x}")).collect::<Vec<_>>().join(",")}
 let mut h=Vec::new();let mut offset=0;
 while offset+5<=raw.len(){let n=u16::from_be_bytes([raw[offset+3],raw[offset+4]])as usize;h.extend_from_slice(&raw[offset+5..offset+5+n]);offset+=5+n;}
 let mut p=4+2+32;let session=h[p]as usize;p+=1+session;let n=u16::from_be_bytes([h[p],h[p+1]])as usize;p+=2;
 let mut c:Vec<u16>=h[p..p+n].chunks_exact(2).map(|b|u16::from_be_bytes([b[0],b[1]])).filter(|v|v&0x0f0f!=0x0a0a).collect();p+=n;let comp=h[p]as usize;p+=1+comp;
 let extlen=u16::from_be_bytes([h[p],h[p+1]])as usize;p+=2;let end=p+extlen;let mut e=Vec::new();let mut sig=Vec::new();let mut sni=false;let mut alpn="00".to_owned();let mut version="12";
 while p<end {let kind=u16::from_be_bytes([h[p],h[p+1]]);let len=u16::from_be_bytes([h[p+2],h[p+3]])as usize;p+=4;let data=&h[p..p+len];p+=len;
  if kind&0x0f0f!=0x0a0a {e.push(kind)}
  match kind {0=>sni=true,16=>{let a=&data[3..3+data[2]as usize];alpn=format!("{}{}",a[0]as char,a[a.len()-1]as char)},13=>{sig=data[2..].chunks_exact(2).map(|b|u16::from_be_bytes([b[0],b[1]])).collect()},43=>{if data[1..].chunks_exact(2).any(|b|b==[3,4]){version="13"}},_=>{}}
 }
 c.sort_unstable();let count=e.len();e.retain(|n|*n!=0 && *n!=16);e.sort_unstable();
 format!("t{version}{}{:02}{count:02}{alpn}_{}_{}",if sni{"d"}else{"i"},c.len(),hash(vector(&c)),hash(format!("{}_{}",vector(&e),vector(&sig))))
}
#[tokio::test]
async fn real_rustls_configurations_store_independently_verified_client_hellos()->Result<()> {
 use tokio::io::{AsyncWriteExt,AsyncReadExt};use tokio_rustls::{TlsConnector,rustls};use base64::Engine as _;
 let _=rustls::crypto::ring::default_provider().install_default();
 let dir=tempfile::tempdir()?;let rt=runtime(dir.path()).await?;let server=proxyfor::server::ServerBuilder::new(common::build_ca()?).commerce(rt.clone()).build();
 let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await?;let addr=listener.local_addr()?;let stop=server.run(listener).await?;
 for version in [&rustls::version::TLS13,&rustls::version::TLS12] {
  let mut roots=rustls::RootCertStore::empty();let cert=std::fs::read(common::resolve_fixture_path("proxyfor-ca-cert.cer"))?;for cert in rustls_pemfile::certs(&mut cert.as_slice()){roots.add(cert?)?;}
  let mut config=rustls::ClientConfig::builder_with_protocol_versions(&[version]).with_root_certificates(roots).with_no_client_auth();config.alpn_protocols=vec![b"http/1.1".to_vec()];
  let socket=tokio::net::TcpStream::connect(addr).await?;let mut tls=TlsConnector::from(Arc::new(config)).connect("localhost".try_into()?,socket).await?;
  tls.write_all(b"GET /__proxyfor__/commerce/status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").await?;let mut response=String::new();tls.read_to_string(&mut response).await?;assert!(response.starts_with("HTTP/1.1 200"));
 }
 let rows=rt.db.rows("fingerprint_observations")?;let hellos:Vec<_>=rows.as_array().unwrap().iter().filter(|r|r["kind"]=="client_hello").collect();assert_eq!(hellos.len(),2);
 let mut fingerprints=Vec::new();for row in hellos {
  let raw=base64::engine::general_purpose::STANDARD.decode(row["evidence"]["raw_client_hello_base64"].as_str().unwrap())?;
  let expected=independent_fingerprint(&raw);assert_eq!(row["evidence"]["parsed"]["fingerprint"],expected);fingerprints.push(expected);
 }
 assert_ne!(fingerprints[0],fingerprints[1]);assert_eq!(rows.as_array().unwrap().iter().filter(|r|r["kind"]=="negotiated_tls").count(),2);
 let _=stop.send(());Ok(())
}
