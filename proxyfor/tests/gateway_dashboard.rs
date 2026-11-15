mod common;

use anyhow::Result;
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{Commerce, db::Database},
    server::{PrintMode, ServerBuilder, WEB_PREFIX},
};
use serde_json::{Value, json};
use std::net::Ipv4Addr;
use std::time::Duration;

#[tokio::test]
async fn probe_policy_mutation_auth_persistence_audit_and_validation() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("commerce.db"))?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().join("clef-cache"),
        workers: 1,
    })
    .await?;
    let (commerce, token) = Commerce::new(db, engine, dir.path(), false)?;
    let token = token.expect("fresh admin token");

    let server = ServerBuilder::new(common::build_ca()?)
        .commerce(commerce.clone())
        .print_mode(PrintMode::Nothing)
        .web(true)
        .build();
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let stop = server.run(listener).await?;

    let client = common::build_client()?;
    let base = format!("http://127.0.0.1:{port}{WEB_PREFIX}/commerce");

    let initial_status: Value = client
        .get(format!("{base}/status"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(initial_status["probe_policy"], "auto");

    // 401 without token and with wrong token
    let no_auth = client
        .post(format!("{base}/probe-policy"))
        .json(&json!({"probe_policy": "off"}))
        .send()
        .await?;
    assert_eq!(no_auth.status(), 401);

    let bad_auth = client
        .post(format!("{base}/probe-policy"))
        .bearer_auth("wrong-token")
        .json(&json!({"probe_policy": "off"}))
        .send()
        .await?;
    assert_eq!(bad_auth.status(), 401);

    // Valid transitions across off -> on-request -> auto
    for expected in ["off", "on-request", "auto"] {
        let res = client
            .post(format!("{base}/probe-policy"))
            .bearer_auth(&token)
            .json(&json!({"probe_policy": expected}))
            .send()
            .await?;
        assert_eq!(res.status(), 200);
        let body: Value = res.json().await?;
        assert_eq!(body, json!({"probe_policy": expected}));

        let status: Value = client
            .get(format!("{base}/status"))
            .send()
            .await?
            .json()
            .await?;
        assert_eq!(status["probe_policy"], expected);

        let snapshot: Value = client
            .get(format!("{base}/snapshot"))
            .bearer_auth(&token)
            .send()
            .await?
            .json()
            .await?;
        assert_eq!(snapshot["probe_policy"], expected);
    }

    // Verify admin_audit_log rows
    let snapshot: Value = client
        .get(format!("{base}/snapshot"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    let audits: Vec<&Value> = snapshot["admin_audit_log"]
        .as_array()
        .expect("admin_audit_log array")
        .iter()
        .filter(|row| row["action"] == "probe_policy.set")
        .collect();
    assert_eq!(audits.len(), 3);
    assert_eq!(audits[0]["actor"], "admin:http");
    assert_eq!(audits[0]["target"], "gateway");
    assert_eq!(audits[0]["details"], json!({"probe_policy": "auto"}));

    // Invalid policy and missing field must return 422 without mutating state
    let invalid = client
        .post(format!("{base}/probe-policy"))
        .bearer_auth(&token)
        .json(&json!({"probe_policy": "invalid-mode"}))
        .send()
        .await?;
    assert_eq!(invalid.status(), 422);

    let missing = client
        .post(format!("{base}/probe-policy"))
        .bearer_auth(&token)
        .json(&json!({}))
        .send()
        .await?;
    assert_eq!(missing.status(), 422);

    let after_invalid: Value = client
        .get(format!("{base}/status"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(after_invalid["probe_policy"], "auto");

    let _ = stop.send(());
    Ok(())
}

#[tokio::test]
async fn outrider_dashboard_dir_serves_static_export_and_preserves_api_routes() -> Result<()> {
    let workspace = tempfile::tempdir()?;
    let secret_path = workspace.path().join("secret.txt");
    std::fs::write(&secret_path, "TOP_SECRET_DO_NOT_SERVE")?;

    let export_dir = workspace.path().join("out");
    std::fs::create_dir_all(export_dir.join("orders"))?;
    std::fs::create_dir_all(export_dir.join("inspector"))?;
    std::fs::create_dir_all(export_dir.join("traffic"))?;
    std::fs::create_dir_all(export_dir.join("_next/static/chunks"))?;
    std::fs::create_dir_all(export_dir.join("_next/static/media"))?;

    std::fs::write(
        export_dir.join("index.html"),
        "<!doctype html><html><head><title>Outrider</title></head><body>outrider-home-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("orders/index.html"),
        "<!doctype html><html><head><title>Outrider</title></head><body>outrider-orders-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("inspector/index.html"),
        "<!doctype html><html><head><title>Outrider</title></head><body>outrider-inspector-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("traffic/index.html"),
        "<!doctype html><html><head><title>Outrider</title></head><body>outrider-traffic-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("traffic/index.txt"),
        "0:[\"$\",\"div\",null,{\"children\":\"outrider-traffic-rsc\"}]\n",
    )?;
    std::fs::write(
        export_dir.join("settings.html"),
        "<!doctype html><html><head><title>Outrider</title></head><body>outrider-settings-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("404.html"),
        "<!doctype html><html><body>outrider-404-export</body></html>",
    )?;
    std::fs::write(
        export_dir.join("_next/static/chunks/app-main.js"),
        b"console.log('outrider-static-chunk');",
    )?;

    // Deliberately include invalid UTF-8 byte sequences in binary .woff2 payload
    let woff2_bytes: Vec<u8> = vec![
        b'w', b'O', b'F', b'2', 0x00, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x80, 0x9d, 0xde, 0xad, 0xbe,
        0xef,
    ];
    std::fs::write(
        export_dir.join("_next/static/media/inter-var.woff2"),
        &woff2_bytes,
    )?;

    // Pick an ephemeral port, release it, and spawn the real `outrider` binary with OUTRIDER_DASHBOARD_DIR
    let probe_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = probe_listener.local_addr()?.port();
    drop(probe_listener);

    let cfg_dir = workspace.path().join("config");
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_outrider"))
        .arg("--web")
        .arg("--no-open")
        .arg("--listen")
        .arg(format!("127.0.0.1:{port}"))
        .arg("--config-dir")
        .arg(&cfg_dir)
        .env("OUTRIDER_DASHBOARD_DIR", &export_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()?;

    let client = common::build_client()?;
    let root_url = format!("http://127.0.0.1:{port}{WEB_PREFIX}");

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(res) = client
                .get(format!("{root_url}/commerce/status"))
                .send()
                .await
                && res.status() == 200
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await?;

    // Root route (`/__proxyfor__` and `/__proxyfor__/`)
    for suffix in ["", "/"] {
        let res = client.get(format!("{root_url}{suffix}")).send().await?;
        assert_eq!(res.status(), 200);
        assert_eq!(
            res.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("text/html; charset=UTF-8")
        );
        assert_eq!(
            res.headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok()),
            Some("no-cache")
        );
        let text = res.text().await?;
        assert!(text.contains("<title>Outrider</title>"));
        assert!(text.contains("outrider-home-export"));
    }

    // Nested directory index routes (`/orders/`, `/orders`, `/inspector/`, `/inspector`, `/traffic/`, `/traffic`) and `{trimmed}.html` (`/settings`, `/settings/`)
    for (route, marker) in [
        ("/orders/", "outrider-orders-export"),
        ("/orders", "outrider-orders-export"),
        ("/inspector/", "outrider-inspector-export"),
        ("/inspector", "outrider-inspector-export"),
        ("/traffic/", "outrider-traffic-export"),
        ("/traffic", "outrider-traffic-export"),
        ("/settings", "outrider-settings-export"),
        ("/settings/", "outrider-settings-export"),
    ] {
        let res = client.get(format!("{root_url}{route}")).send().await?;
        assert_eq!(res.status(), 200, "route {route}");
        assert_eq!(
            res.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("text/html; charset=UTF-8")
        );
        assert_eq!(
            res.headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok()),
            Some("no-cache")
        );
        assert!(res.text().await?.contains(marker), "route {route}");
    }

    // HEAD `/traffic/` and GET `/traffic/index.txt` (Next.js RSC flight payload) must route to static export, not numeric `handle_get_traffic`
    let head_traffic_res = client.head(format!("{root_url}/traffic/")).send().await?;
    assert_eq!(head_traffic_res.status(), 200);
    let rsc_traffic_res = client
        .get(format!("{root_url}/traffic/index.txt"))
        .send()
        .await?;
    assert_eq!(rsc_traffic_res.status(), 200);
    assert!(
        rsc_traffic_res
            .text()
            .await?
            .contains("outrider-traffic-rsc")
    );

    // Immutable hashed Next.js JS asset
    let js_res = client
        .get(format!("{root_url}/_next/static/chunks/app-main.js"))
        .send()
        .await?;
    assert_eq!(js_res.status(), 200);
    assert_eq!(
        js_res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("application/javascript; charset=UTF-8")
    );
    assert_eq!(
        js_res
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(
        js_res.bytes().await?.as_ref(),
        b"console.log('outrider-static-chunk');"
    );

    // Binary .woff2 asset (must never be corrupted by UTF-8 conversion)
    let font_res = client
        .get(format!("{root_url}/_next/static/media/inter-var.woff2"))
        .send()
        .await?;
    assert_eq!(font_res.status(), 200);
    assert_eq!(
        font_res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("font/woff2")
    );
    assert_eq!(
        font_res
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(font_res.bytes().await?.as_ref(), woff2_bytes.as_slice());

    // Unmatched route returns 404 with exported 404.html body and no-cache
    let missing_res = client
        .get(format!("{root_url}/does-not-exist"))
        .send()
        .await?;
    assert_eq!(missing_res.status(), 404);
    assert_eq!(
        missing_res
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok()),
        Some("no-cache")
    );
    assert!(missing_res.text().await?.contains("outrider-404-export"));

    // Path traversal attempts over raw HTTP TCP socket (bypassing client-side URL normalization)
    // must be rejected with 404 and never leak parent files
    for attempt in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/orders/%2e%2e/%2e%2e/secret.txt",
        "/..%2fsecret.txt",
    ] {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut raw_sock = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
        let raw_req = format!(
            "GET {WEB_PREFIX}{attempt} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        raw_sock.write_all(raw_req.as_bytes()).await?;
        let mut resp_buf = Vec::new();
        raw_sock.read_to_end(&mut resp_buf).await?;
        let resp_text = String::from_utf8_lossy(&resp_buf);
        assert!(
            resp_text.starts_with("HTTP/1.1 404 "),
            "attempt {attempt} got: {}",
            resp_text.lines().next().unwrap_or("")
        );
        assert!(!resp_text.contains("TOP_SECRET_DO_NOT_SERVE"));
    }

    // Preserved WEB_PREFIX API routes (`/traffics` and `/certificate/*`)
    let (upstream_addr, stop_upstream) = common::start_http_server().await?;
    let proxy_client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?)
        .build()?;
    let proxied = proxy_client
        .get(format!("http://127.0.0.1:{}/hello", upstream_addr.port()))
        .send()
        .await?;
    assert_eq!(proxied.status(), 200);

    let traffics_res = client.get(format!("{root_url}/traffics")).send().await?;
    assert_eq!(traffics_res.status(), 200);
    let traffics_json: Value = traffics_res.json().await?;
    assert!(traffics_json.as_array().is_some_and(|arr| !arr.is_empty()));

    // Numeric `/traffic/<id>` and `/traffic/<id>?har` API routes remain routed to `handle_get_traffic`
    let first_id = traffics_json[0]["id"].as_u64().expect("numeric traffic id");
    let traffic_detail_res = client
        .get(format!("{root_url}/traffic/{first_id}"))
        .send()
        .await?;
    assert_eq!(traffic_detail_res.status(), 200);
    let traffic_detail_json: Value = traffic_detail_res.json().await?;
    assert!(
        traffic_detail_json["uri"]
            .as_str()
            .is_some_and(|u| u.ends_with("/hello"))
    );
    let traffic_har_res = client
        .get(format!("{root_url}/traffic/{first_id}?har"))
        .send()
        .await?;
    assert_eq!(traffic_har_res.status(), 200);
    let traffic_har_json: Value = traffic_har_res.json().await?;
    assert!(
        traffic_har_json["log"]["entries"]
            .as_array()
            .is_some_and(|entries| entries.len() == 1)
    );

    let cert_page = client
        .get(format!("{root_url}/certificate/"))
        .send()
        .await?;
    assert_eq!(cert_page.status(), 200);
    assert_eq!(
        cert_page
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("text/html; charset=UTF-8")
    );

    for cert_file in ["proxyfor-ca-cert.cer", "proxyfor-ca-cert.pem"] {
        let cert_res = client
            .get(format!("{root_url}/certificate/{cert_file}"))
            .send()
            .await?;
        assert_eq!(cert_res.status(), 200);
        assert_eq!(
            cert_res
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("application/x-x509-ca-cert")
        );
        assert!(cert_res.text().await?.contains("BEGIN CERTIFICATE"));
    }

    let _ = stop_upstream.send(());
    let _ = child.kill().await;
    Ok(())
}
