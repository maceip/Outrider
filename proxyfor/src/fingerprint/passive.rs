use crate::commerce::db::{Database, id, now};
use anyhow::{Result, anyhow, ensure};
use rusqlite::params;
use serde_json::{Value, json};

#[derive(Clone, Debug)]
pub struct ConnectionEvidence {
    pub connection_id: String,
}
pub fn observe(
    db: &Database,
    session: Option<&str>,
    connection: Option<&str>,
    kind: &str,
    evidence: Value,
) -> Result<()> {
    db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO fingerprint_observations(observation_id,session_id,connection_id,kind,evidence,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![id(),session,connection,kind,evidence.to_string(),now()])?;
    Ok(())
}
pub fn record_hello(db: &Database, connection: &str, raw: &[u8]) -> Result<()> {
    use base64::Engine as _;
    let mut evidence = json!({"raw_client_hello_base64":base64::engine::general_purpose::STANDARD.encode(raw),"fingerprint_algorithm":"Outrider JA4-style v1"});
    match super::client_hello::parse(raw) {
        Ok(h) => {
            evidence["parsed"] = serde_json::to_value(h)?;
            evidence["status"] = "Parsed".into()
        }
        Err(e) => {
            evidence["status"] = "Unparsed".into();
            evidence["error"] = e.to_string().into()
        }
    }
    observe(db, None, Some(connection), "client_hello", evidence)
}
pub fn record_tls<IO>(
    db: &Database,
    connection: &str,
    stream: &tokio_rustls::server::TlsStream<IO>,
) -> Result<()> {
    let tls = stream.get_ref().1;
    observe(
        db,
        None,
        Some(connection),
        "negotiated_tls",
        json!({"tls_version":tls.protocol_version().map(|v|format!("{v:?}")),"alpn":tls.alpn_protocol().map(|v|String::from_utf8_lossy(v).to_string()),"cipher_suite":tls.negotiated_cipher_suite().map(|v|format!("{:?}",v.suite()))}),
    )
}
/// Validate URL structure and fetched CIMD document. Metadata does not prove client ownership.
pub async fn cimd(raw: &str) -> Result<Value> {
    let url = url::Url::parse(raw)?;
    ensure!(
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.path() != "/"
            && !url.path().is_empty()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none(),
        "Invalid HTTPS CIMD client_id URL"
    );
    // Refuse local destinations before fetching untrusted client URLs.
    let host = url.host_str().unwrap();
    let port = url.port_or_known_default().unwrap();
    let addresses: Vec<_> = tokio::net::lookup_host((host, port)).await?.collect();
    ensure!(
        !addresses.is_empty()
            && addresses.iter().all(|a| match a.ip() {
                std::net::IpAddr::V4(v) =>
                    !v.is_private()
                        && !v.is_loopback()
                        && !v.is_link_local()
                        && !v.is_unspecified()
                        && !v.is_multicast()
                        && v.octets()[0] != 0,
                std::net::IpAddr::V6(v) =>
                    !v.is_loopback()
                        && !v.is_unspecified()
                        && !v.is_unique_local()
                        && !v.is_unicast_link_local()
                        && !v.is_multicast(),
            }),
        "CIMD URL resolves to a local/reserved address"
    );
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .resolve_to_addrs(host, &addresses)
        .build()?;
    let response = client.get(url.clone()).send().await?.error_for_status()?;
    ensure!(
        response.content_length().is_none_or(|n| n <= 65536),
        "CIMD document too large"
    );
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(
            bytes.len() + chunk.len() <= 65536,
            "CIMD document too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    let document: Value = serde_json::from_slice(&bytes)?;
    ensure!(
        document.is_object() && document["client_id"] == raw,
        "CIMD metadata client_id mismatch"
    );
    ensure!(
        document.get("client_secret").is_none()
            && document.get("client_secret_expires_at").is_none(),
        "CIMD metadata must not contain secrets"
    );
    if let Some(method) = document["token_endpoint_auth_method"].as_str() {
        ensure!(
            !method.starts_with("client_secret"),
            "CIMD shared-secret auth is forbidden"
        );
    }
    Ok(document)
}
pub async fn http_prefix<I: tokio::io::AsyncRead + Unpin>(stream: &mut I) -> Vec<u8> {
    use tokio::io::AsyncReadExt;
    let mut raw = Vec::new();
    let mut buffer = [0u8; 4096];
    while raw.len() < 65536 {
        if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.starts_with(b"PRI * HTTP/2.0") {
            break;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut buffer))
            .await
        {
            Ok(Ok(n)) if n > 0 => raw.extend_from_slice(&buffer[..n]),
            _ => break,
        }
    }
    raw
}
pub fn record_header_order(db: &Database, connection: &str, raw: &[u8]) -> Result<()> {
    use sha2::{Digest, Sha256};
    if raw.starts_with(b"PRI * HTTP/2.0") {
        return observe(
            db,
            None,
            Some(connection),
            "http_header_order",
            json!({"status":"Unavailable","reason":"HTTP/2 headers are compressed; no wire-order digest captured"}),
        );
    }
    let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return Ok(());
    };
    let text = std::str::from_utf8(&raw[..end])?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let names = lines
        .map(|s| s.split_once(':').map(|(name, _)| name.to_owned()))
        .collect::<Option<Vec<_>>>();
    if let Some(names) = names {
        let digest = format!("{:x}", Sha256::digest(names.join("\n").as_bytes()));
        observe(
            db,
            None,
            Some(connection),
            "http_header_order",
            json!({"status":"Captured","scope":"first HTTP/1 request on connection","request_line":request_line,"header_names_in_wire_order":names,"sha256":digest}),
        )?;
    }
    Ok(())
}
