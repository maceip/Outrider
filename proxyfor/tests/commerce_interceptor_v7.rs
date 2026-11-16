mod common;

use anyhow::{Context, Result};
use proxyfor::{
    clef::engine::{ClefConfig, ClefEngine},
    commerce::{
        Commerce,
        db::Database,
        interception::{validate_mcp_offers_schema, validate_seller_policy},
    },
    server::{PrintMode, ServerBuilder, WEB_PREFIX},
};
use serde_json::{Value, json};
use std::{net::Ipv4Addr, time::Duration};

#[tokio::test]
async fn commerce_interceptor_v7_cold_boot_hold_validate_release_and_ed25519_fulfill() -> Result<()>
{
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("conduit-v7.db"))?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().join("clef-cache"),
        workers: 1,
    })
    .await?;
    let (commerce, token) = Commerce::new(db, engine, dir.path(), false)?;
    let token = token.expect("fresh admin bearer token");

    let server = ServerBuilder::new(common::build_ca()?)
        .commerce(commerce.clone())
        .print_mode(PrintMode::Nothing)
        .web(true)
        .build();
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let stop = server.run(listener).await?;

    let client = common::build_client()?;
    let web_base = format!("http://127.0.0.1:{port}{WEB_PREFIX}");
    let commerce_base = format!("{web_base}/commerce");

    // 1. Cold boot MUST have 0 `/traffics` and 0 interception rows.
    let cold_traffics: Value = client
        .get(format!("{web_base}/traffics"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        cold_traffics,
        json!([]),
        "Cold boot /traffics must be empty"
    );

    let unauth_state = client
        .get(format!("{commerce_base}/interception/state"))
        .send()
        .await?;
    assert_eq!(unauth_state.status(), 401);

    let cold_state: Value = client
        .get(format!("{commerce_base}/interception/state"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(cold_state["active_intercepting"], true);
    assert_eq!(cold_state["held_count"], 0);
    assert_eq!(cold_state["transactions"], json!([]));
    assert_eq!(cold_state["events"], json!([]));
    assert_eq!(cold_state["offers"], json!([]));
    assert_eq!(cold_state["drafts"], json!([]));

    let cold_snap: Value = client
        .get(format!("{commerce_base}/snapshot"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(cold_snap["interception"]["transactions"], json!([]));

    // 2. Run AudioShop scenario (+ peer sessions) and verify R02 is held with live suspended buyer task.
    let run_res = client
        .post(format!("{commerce_base}/interception/run-scenario"))
        .bearer_auth(&token)
        .json(&json!({"preset": "audioshop", "include_peers": true}))
        .send()
        .await?;
    assert_eq!(run_res.status(), 200);
    let held_state_1: Value = run_res.json().await?;

    assert_eq!(held_state_1["active_intercepting"], true);
    assert_eq!(held_state_1["held_count"], 1);

    let txs = held_state_1["transactions"].as_array().context("txs array")?;
    assert_eq!(txs.len(), 4);
    assert_eq!(txs[0]["tx_id"], "audioshop");
    assert_eq!(txs[0]["title"], "AudioShop — Headphone Purchase");
    assert_eq!(txs[0]["short_title"], "AudioShop");
    assert_eq!(txs[0]["buyer_agent"], "agent-7f2");
    assert_eq!(txs[0]["seller_host"], "audioshop.com");
    assert_eq!(txs[0]["phase"], "negotiate");
    assert_eq!(txs[0]["status"], "held");
    assert_eq!(txs[1]["tx_id"], "skyport");
    assert_eq!(txs[1]["phase"], "negotiate");
    assert_eq!(txs[1]["status"], "live");
    assert_eq!(txs[2]["tx_id"], "displayco");
    assert_eq!(txs[2]["phase"], "discover");
    assert_eq!(txs[2]["status"], "live");
    assert_eq!(txs[3]["tx_id"], "cloudstore");
    assert_eq!(txs[3]["phase"], "fulfill");
    assert_eq!(txs[3]["status"], "complete");

    let audio_events: Vec<&Value> = held_state_1["events"]
        .as_array()
        .context("events array")?
        .iter()
        .filter(|e| e["tx_id"] == "audioshop")
        .collect();
    assert_eq!(audio_events.len(), 6);
    assert_eq!(audio_events[0]["event_id"], "C01");
    assert_eq!(audio_events[0]["status_code"], 200);
    assert_eq!(audio_events[0]["observation"], "Products found (12)");
    assert_eq!(audio_events[1]["event_id"], "C02");
    assert_eq!(audio_events[1]["status_code"], 200);
    assert_eq!(audio_events[1]["observation"], "Call to get_offers");
    assert_eq!(audio_events[2]["event_id"], "R02");
    assert_eq!(audio_events[2]["direction"], "seller_to_buyer");
    assert_eq!(audio_events[2]["epistemic_kind"], "held");
    assert_eq!(audio_events[2]["hold_state"], "held");
    assert_eq!(audio_events[2]["status_label"], "HELD");
    let initial_hold_ms = audio_events[2]["hold_ms"]
        .as_i64()
        .context("R02 must report live hold_ms while held")?;
    assert!(initial_hold_ms >= 0);

    for (idx, expected_id) in [(3, "C03"), (4, "C04"), (5, "C05")] {
        assert_eq!(audio_events[idx]["event_id"], expected_id);
        assert_eq!(audio_events[idx]["epistemic_kind"], "pending");
        assert!(audio_events[idx]["status_code"].is_null());
        assert_eq!(audio_events[idx]["status_label"], "PENDING");
    }

    let audio_offers: Vec<&Value> = held_state_1["offers"]
        .as_array()
        .context("offers array")?
        .iter()
        .filter(|o| o["tx_id"] == "audioshop")
        .collect();
    assert_eq!(audio_offers.len(), 3);
    assert_eq!(audio_offers[0]["offer_id"], "O01");
    assert_eq!(audio_offers[0]["parent_event_id"], "C02");
    assert_eq!(audio_offers[0]["price_cents"], 21_900);
    assert_eq!(audio_offers[0]["is_draft"], false);
    assert_eq!(audio_offers[1]["offer_id"], "O02");
    assert_eq!(audio_offers[1]["parent_event_id"], "C02");
    assert_eq!(audio_offers[1]["price_cents"], 22_900);
    assert_eq!(audio_offers[2]["offer_id"], "O03");
    assert_eq!(audio_offers[2]["parent_event_id"], "R02");
    assert_eq!(audio_offers[2]["price_cents"], 20_900);
    assert_eq!(audio_offers[2]["is_draft"], true);
    assert_eq!(audio_offers[2]["committed"], false);

    let draft = &held_state_1["drafts"][0];
    assert_eq!(draft["draft_id"], "draft-r02");
    assert_eq!(draft["enabled"], true);
    assert_eq!(draft["validation"]["mcp_schema"], "valid");
    assert_eq!(draft["validation"]["seller_policy"], "pending_validation");
    assert_eq!(draft["validation"]["operator_approval"], "awaiting_operator");
    assert_eq!(draft["validation"]["payment_auth"], "unverified");

    // Verify live hold_ms advances over wall-clock time while the buyer task stays suspended.
    tokio::time::sleep(Duration::from_millis(30)).await;
    let held_state_2: Value = client
        .get(format!("{commerce_base}/interception/state"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    let r02_after_wait = held_state_2["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tx_id"] == "audioshop" && e["event_id"] == "R02")
        .unwrap();
    let later_hold_ms = r02_after_wait["hold_ms"].as_i64().unwrap();
    assert!(
        later_hold_ms > initial_hold_ms,
        "Expected live hold_ms to advance ({later_hold_ms} <= {initial_hold_ms})"
    );

    // Verify `/traffics` captured the real loopback proxy wire packets.
    let live_traffics: Value = client
        .get(format!("{web_base}/traffics"))
        .send()
        .await?
        .json()
        .await?;
    assert!(
        live_traffics.as_array().unwrap().len() >= 2,
        "Expected real proxied HTTP/MCP requests in /traffics"
    );

    // 3. Test policy rejection guard below floor ($185 < $199) and confirm R02 stays held!
    let low_draft: Value = client
        .post(format!("{commerce_base}/interception/draft"))
        .bearer_auth(&token)
        .json(&json!({
            "tx_id": "audioshop",
            "target_event_id": "R02",
            "lane": "buyer_to_seller",
            "enabled": true,
            "promo_price_cents": 18_500
        }))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(low_draft["drafts"][0]["lane"], "buyer_to_seller");

    let rejected_val: Value = client
        .post(format!("{commerce_base}/interception/validate"))
        .bearer_auth(&token)
        .json(&json!({"tx_id": "audioshop", "target_event_id": "R02"}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        rejected_val["drafts"][0]["validation"]["seller_policy"],
        "rejected"
    );

    let blocked_release = client
        .post(format!("{commerce_base}/interception/release"))
        .bearer_auth(&token)
        .json(&json!({"tx_id": "audioshop", "target_event_id": "R02", "mode": "replacement"}))
        .send()
        .await?;
    assert_eq!(
        blocked_release.status(),
        422,
        "Release must reject replacement payload violating seller floor"
    );

    // Restore valid $209 promotional offer on seller_to_buyer lane and run `/interception/validate`.
    let restored_draft: Value = client
        .post(format!("{commerce_base}/interception/draft"))
        .bearer_auth(&token)
        .json(&json!({
            "tx_id": "audioshop",
            "target_event_id": "R02",
            "lane": "seller_to_buyer",
            "enabled": true,
            "promo_price_cents": 20_900
        }))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        restored_draft["drafts"][0]["validation"]["seller_policy"],
        "pending_validation"
    );

    let validated_state: Value = client
        .post(format!("{commerce_base}/interception/validate"))
        .bearer_auth(&token)
        .json(&json!({"tx_id": "audioshop", "target_event_id": "R02"}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        validated_state["drafts"][0]["validation"]["mcp_schema"],
        "valid"
    );
    assert_eq!(
        validated_state["drafts"][0]["validation"]["seller_policy"],
        "valid"
    );
    assert_eq!(validated_state["held_count"], 1);

    // 4. Release R02 ("replacement"): unblocks suspended buyer task to execute C03 ($209) & C04 (200).
    let release_res = client
        .post(format!("{commerce_base}/interception/release"))
        .bearer_auth(&token)
        .json(&json!({
            "tx_id": "audioshop",
            "target_event_id": "R02",
            "mode": "replacement"
        }))
        .send()
        .await?;
    assert_eq!(release_res.status(), 200);
    let released_state: Value = release_res.json().await?;

    assert_eq!(released_state["held_count"], 0);
    let audio_tx_after_release = &released_state["transactions"][0];
    assert_eq!(audio_tx_after_release["phase"], "payment");
    assert_eq!(audio_tx_after_release["status"], "live");
    assert_eq!(audio_tx_after_release["category_label"], "Audio · $209");

    let draft_after_release = &released_state["drafts"][0];
    assert_eq!(draft_after_release["delivery_state"], "committed");
    assert_eq!(
        draft_after_release["validation"]["operator_approval"],
        "approved"
    );

    let o03_after_release = released_state["offers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["tx_id"] == "audioshop" && o["offer_id"] == "O03")
        .unwrap();
    assert_eq!(o03_after_release["committed"], true);
    assert_eq!(o03_after_release["is_draft"], false);

    let events_after_release: Vec<&Value> = released_state["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["tx_id"] == "audioshop")
        .collect();
    assert_eq!(events_after_release[2]["event_id"], "R02");
    assert_eq!(events_after_release[2]["epistemic_kind"], "observed");
    assert_eq!(events_after_release[2]["hold_state"], "replaced");
    assert_eq!(events_after_release[2]["status_code"], 200);
    assert_eq!(events_after_release[2]["status_label"], "200");
    assert!(events_after_release[2]["hold_ms"].is_null());

    assert_eq!(events_after_release[3]["event_id"], "C03");
    assert_eq!(events_after_release[3]["epistemic_kind"], "observed");
    assert_eq!(events_after_release[3]["status_code"], 200);
    assert!(
        events_after_release[3]["observation"]
            .as_str()
            .unwrap()
            .contains("O03")
            && events_after_release[3]["observation"]
                .as_str()
                .unwrap()
                .contains("$209.00"),
        "Buyer must select O03 ($209.00) on replacement release, got: {}",
        events_after_release[3]["observation"]
    );

    assert_eq!(events_after_release[4]["event_id"], "C04");
    assert_eq!(events_after_release[4]["epistemic_kind"], "observed");
    assert_eq!(events_after_release[4]["status_code"], 200);

    assert_eq!(events_after_release[5]["event_id"], "C05");
    assert_eq!(events_after_release[5]["epistemic_kind"], "pending");

    // 5. Authorize payment: mints real Ed25519 receipt for agent-7f2, verifies signature, and completes C05 (`fulfill`).
    let auth_res = client
        .post(format!("{commerce_base}/interception/authorize-payment"))
        .bearer_auth(&token)
        .json(&json!({
            "tx_id": "audioshop",
            "bundle_id": "conduit_session_evidence"
        }))
        .send()
        .await?;
    assert_eq!(auth_res.status(), 200);
    let fulfilled_state: Value = auth_res.json().await?;

    assert_eq!(fulfilled_state["signature_verified"], true);
    let receipt_id = fulfilled_state["receipt_id"]
        .as_str()
        .context("Expected minted receipt_id")?
        .to_owned();

    let audio_tx_final = &fulfilled_state["transactions"][0];
    assert_eq!(audio_tx_final["phase"], "fulfill");
    assert_eq!(audio_tx_final["status"], "complete");
    assert_eq!(
        fulfilled_state["drafts"][0]["validation"]["payment_auth"],
        "authorized"
    );

    let c05_final = fulfilled_state["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tx_id"] == "audioshop" && e["event_id"] == "C05")
        .unwrap();
    assert_eq!(c05_final["epistemic_kind"], "observed");
    assert_eq!(c05_final["status_code"], 200);
    assert_eq!(c05_final["status_label"], "200");

    // Verify snapshot confirms verified Ed25519 receipt, redemption row, and entitled agent-7f2 session.
    let final_snap: Value = client
        .get(format!("{commerce_base}/snapshot"))
        .bearer_auth(&token)
        .send()
        .await?
        .json()
        .await?;
    let receipts = final_snap["capability_receipts"].as_array().unwrap();
    assert!(
        receipts.iter().any(|r| {
            r["receipt_id"] == receipt_id
                && r["subject"] == "agent-7f2"
                && r["bundle_id"] == "conduit_session_evidence"
                && r["signature_verified"] == true
                && r["revoked"] == 0
        }),
        "Snapshot must contain cryptographically verified Ed25519 receipt for agent-7f2"
    );
    let redemptions = final_snap["receipt_redemptions"].as_array().unwrap();
    assert!(
        redemptions.iter().any(|r| {
            r["receipt_id"] == receipt_id
                && r["session_id"] == "agent-7f2"
                && r["tool_name"] == "complete_checkout_session"
        }),
        "Expected receipt redemption record for complete_checkout_session"
    );

    let _ = stop.send(());
    Ok(())
}

#[tokio::test]
async fn commerce_interceptor_v7_forward_original_and_schema_policy_validators() -> Result<()> {
    // Direct structural & policy validator unit assertions
    let (bad_schema, _) = validate_mcp_offers_schema(&json!({"jsonrpc": "2.0", "offers": []}));
    assert_eq!(bad_schema, "invalid");

    let (dup_schema, _) = validate_mcp_offers_schema(&json!({
        "jsonrpc": "2.0",
        "method": "return_offers",
        "offers": [
            {"offer_id": "O01", "sku_title": "X", "currency": "USD", "price_cents": 20_000},
            {"offer_id": "O01", "sku_title": "X", "currency": "USD", "price_cents": 21_000}
        ]
    }));
    assert_eq!(dup_schema, "invalid");

    let (good_schema, detail) = validate_mcp_offers_schema(&json!({
        "jsonrpc": "2.0",
        "method": "return_offers",
        "offers": [
            {"offer_id": "O01", "sku_title": "Studio Wireless X", "currency": "USD", "price_cents": 21_900}
        ]
    }));
    assert_eq!(good_schema, "valid");
    assert_eq!(detail, "Conforms to MCP 2026-07-28 return_offers schema");

    assert_eq!(validate_seller_policy(19_899, 19_900, 22_900).0, "rejected");
    assert_eq!(validate_seller_policy(19_900, 19_900, 22_900).0, "valid");
    assert_eq!(validate_seller_policy(23_000, 19_900, 22_900).0, "rejected");

    // Verify `mode: "original"` forwards Seller's unmodified offers so Buyer selects O01 ($219.00).
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("forward-orig.db"))?;
    let engine = ClefEngine::load(ClefConfig {
        model: None,
        backend: "cpu".into(),
        threads: 1,
        cache_dir: dir.path().join("clef-cache"),
        workers: 1,
    })
    .await?;
    let (commerce, _token) = Commerce::new(db, engine, dir.path(), false)?;

    let initial = commerce
        .interception
        .run_scenario(&commerce, &json!({"preset": "audioshop"}), "test:unit")
        .await?;
    assert_eq!(initial["held_count"], 1);

    let forwarded = commerce
        .interception
        .release_intercept(
            &commerce,
            &json!({"tx_id": "audioshop", "target_event_id": "R02", "mode": "original"}),
            "test:unit",
        )
        .await?;
    assert_eq!(forwarded["held_count"], 0);
    assert_eq!(forwarded["drafts"][0]["enabled"], false);
    assert_eq!(forwarded["drafts"][0]["delivery_state"], "discarded");

    let r02 = forwarded["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["event_id"] == "R02")
        .unwrap();
    assert_eq!(r02["hold_state"], "forwarded");
    assert_eq!(r02["status_code"], 200);

    let c03 = forwarded["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["event_id"] == "C03")
        .unwrap();
    assert!(
        c03["observation"].as_str().unwrap().contains("O01")
            && c03["observation"].as_str().unwrap().contains("$219.00"),
        "Forward original must result in Buyer selecting O01 ($219.00), got: {}",
        c03["observation"]
    );

    Ok(())
}
