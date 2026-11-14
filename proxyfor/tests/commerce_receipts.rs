mod common;
use anyhow::Result;
use proxyfor::{clef::engine::{ClefEngine,ClefConfig},commerce::{Commerce,db::{Database,now},receipt::ReceiptAuthority,bundler::{self,Bundle}}};
use serde_json::json;
use std::{sync::Arc,net::{IpAddr,Ipv4Addr,SocketAddr}};

fn seed(db:&Database,path:&std::path::Path)->Result<ReceiptAuthority> {
    db.record_session("session","subject",&json!({}),"stdio")?;
    // A configured catalog entry, not an execution result.
    let connection=rusqlite::Connection::open(path)?;
    connection.execute("INSERT INTO catalog_items(item_id,kind,digest,descriptor) VALUES ('tool','tool','sha256:test-configured-item','{}')",[])?;
    bundler::put_bundle(db,&Bundle{bundle_id:"bundle".into(),title:"Configured bundle".into(),items:vec!["tool".into()],rules:json!({})},"admin:test")?;
    Ok(ReceiptAuthority::load(db.clone(),&path.with_extension("pem"))?)
}
#[test]
fn receipt_rejects_tamper_wrong_subject_revocation_and_exhaustion()->Result<()> {
    let dir=tempfile::tempdir()?;let path=dir.path().join("test.db");let db=Database::open(&path)?;let authority=seed(&db,&path)?;
    let signed=authority.issue("subject","bundle",1,now()+600,"admin:test")?;
    authority.verify_signature(&signed)?;
    assert_eq!(authority.verify(&signed,"subject","bundle")?,1);
    let mut forged=signed.clone();forged.receipt.max_calls=100;
    assert!(authority.verify(&forged,"subject","bundle").is_err());
    assert!(authority.verify(&signed,"other","bundle").is_err());
    assert!(authority.verify(&signed,"subject","other").is_err());
    assert_eq!(authority.redeem(&signed,"subject","bundle","session","tool",None)?,0);
    assert!(authority.redeem(&signed,"subject","bundle","session","tool",None).is_err());
    let revoked=authority.issue("subject","bundle",2,now()+600,"admin:test")?;
    authority.revoke(&revoked.receipt.receipt_id,"admin:test")?;
    assert!(authority.verify(&revoked,"subject","bundle").is_err());
    let conn=rusqlite::Connection::open(&path)?;
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM receipt_redemptions",[],|r|r.get::<_,i64>(0))?,1);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM admin_audit_log WHERE action LIKE 'receipt.%'",[],|r|r.get::<_,i64>(0))?,3);
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(std::fs::metadata(path.with_extension("pem"))?.permissions().mode() & 0o777,0o600);}
    Ok(())
}
#[test]
fn concurrent_redemption_across_connections_cannot_overdraw()->Result<()> {
    let dir=tempfile::tempdir()?;let path=dir.path().join("test.db");let db=Database::open(&path)?;let authority=seed(&db,&path)?;
    let signed=authority.issue("subject","bundle",7,now()+600,"admin:test")?;
    let barrier=Arc::new(std::sync::Barrier::new(24));
    let threads:Vec<_>=(0..24).map(|_|{let path=path.clone();let signed=signed.clone();let barrier=barrier.clone();std::thread::spawn(move||{
        let db=Database::open(&path).unwrap();let authority=ReceiptAuthority::load(db,&path.with_extension("pem")).unwrap();
        barrier.wait();authority.redeem(&signed,"subject","bundle","session","tool",None).is_ok()
    })}).collect();
    let successes=threads.into_iter().filter(|t|t.thread().id()!=std::thread::current().id()).map(|t|t.join().unwrap()).filter(|r|*r).count();
    assert_eq!(successes,7);
    let conn=rusqlite::Connection::open(&path)?;
    assert_eq!(conn.query_row("SELECT MIN(remaining_calls) FROM capability_receipts",[],|r|r.get::<_,i64>(0))?,0);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM receipt_redemptions",[],|r|r.get::<_,i64>(0))?,7);
    Ok(())
}
#[tokio::test]
async fn expired_receipt_is_rejected()->Result<()> {
    let dir=tempfile::tempdir()?;let path=dir.path().join("test.db");let db=Database::open(&path)?;let authority=seed(&db,&path)?;
    let signed=authority.issue("subject","bundle",1,now()+1,"admin:test")?;
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert!(authority.verify(&signed,"subject","bundle").is_err());Ok(())
}
#[tokio::test]
async fn real_http_admin_auth_and_no_agent_issuance()->Result<()> {
    let dir=tempfile::tempdir()?;let path=dir.path().join("test.db");let db=Database::open(&path)?;seed(&db,&path)?;
    let engine=ClefEngine::load(ClefConfig{model:None,backend:"cpu".into(),threads:1,cache_dir:dir.path().into(),workers:1}).await?;
    let (commerce,token)=Commerce::new(db,engine,dir.path(),false)?;let token=token.unwrap();
    assert_eq!(commerce.auth.authorize(Some("192.0.2.1".parse()?),Some(&format!("Bearer {token}"))),Err(403));
    let server=proxyfor::server::ServerBuilder::new(common::build_ca()?).commerce(commerce.clone()).build();
    let listener=tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED,0)).await?;let port=listener.local_addr()?.port();
    let stop=server.run(listener).await?;
    let client=common::build_client()?;let url=format!("http://127.0.0.1:{port}/__proxyfor__/commerce/receipts/issue");
    let body=json!({"subject":"subject","bundle_id":"bundle","max_calls":1,"expires_at_unix":now()+600});
    assert_eq!(client.post(&url).json(&body).send().await?.status(),401);
    assert_eq!(client.post(&url).bearer_auth("wrong").json(&body).send().await?.status(),401);
    assert_eq!(client.post(&url).bearer_auth(&token).json(&body).send().await?.status(),200);
    let socket=std::net::UdpSocket::bind("0.0.0.0:0")?;socket.connect("192.0.2.1:80")?;
    let ip=socket.local_addr()?.ip();
    if !ip.is_loopback() && ip!=IpAddr::V4(Ipv4Addr::UNSPECIFIED) {
        let remote=client.post(format!("http://{ip}:{port}/__proxyfor__/commerce/receipts/issue")).bearer_auth(&token).json(&body).send().await?;
        assert_eq!(remote.status(),403);
    }
    for route in ["/mcp/receipts/issue","/receipts/issue"] {
        assert!(!client.post(format!("http://127.0.0.1:{port}{route}")).json(&body).send().await?.status().is_success());
    }
    let rows=commerce.db.rows("capability_receipts")?;assert_eq!(rows.as_array().unwrap().len(),1);
    let _=stop.send(());
    Ok(())
}
