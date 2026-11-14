use proxyfor::clef::fetch::fetch;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;

/// Minimal HTTP server: serves `/m` (body) and `/m.sha256` (sidecar), 404 otherwise.
fn serve(body: Vec<u8>, sidecar: String) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    std::thread::spawn(move || {
        for s in l.incoming() {
            let mut s = s.unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
            let (status, data) = match path.as_str() {
                "/m" => ("200 OK", body.clone()),
                "/m.sha256" => ("200 OK", sidecar.clone().into_bytes()),
                _ => ("404 Not Found", vec![]),
            };
            let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", data.len());
            let _ = s.write_all(&data);
        }
    });
    format!("http://{addr}/m")
}

fn install_crypto() {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
}

#[tokio::test]
async fn downloads_and_verifies_model() {
    install_crypto();
    let body = b"litertlm-bytes".repeat(1000);
    let sum = format!("{:x}  clef-flash.litertlm\n", Sha256::digest(&body));
    let url = serve(body.clone(), sum);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("models/clef-flash.litertlm");
    fetch(&url, &dest).await.unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), body);
    assert!(!dest.with_extension("litertlm.part").exists());
}

#[tokio::test]
async fn rejects_checksum_mismatch_without_installing() {
    install_crypto();
    let url = serve(b"tampered".to_vec(), "0".repeat(64));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("models/clef-flash.litertlm");
    assert!(fetch(&url, &dest).await.is_err());
    assert!(!dest.exists());
}

#[tokio::test]
async fn missing_remote_model_is_an_error_not_a_file() {
    install_crypto();
    let url = serve(vec![], String::new()).replace("/m", "/absent");
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("models/clef-flash.litertlm");
    assert!(fetch(&url, &dest).await.is_err());
    assert!(!dest.exists());
}
