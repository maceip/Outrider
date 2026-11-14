use super::db::{Database, id, now};
use crate::clef::engine::EngineStatus;
use anyhow::{Result, anyhow, ensure};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    pub bundle_id: String,
    pub title: String,
    pub items: Vec<String>,
    #[serde(default)]
    pub rules: Value,
}
pub fn digest(value: &Value) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_jcs::to_vec(value)?)))
}
pub fn bundle_digests(conn: &Connection, bundle: &str) -> Result<Vec<String>> {
    let items: String = conn.query_row(
        "SELECT items FROM bundles WHERE bundle_id=?1",
        [bundle],
        |r| r.get(0),
    )?;
    let items: Vec<String> = serde_json::from_str(&items)?;
    let mut digests = Vec::new();
    for item in items {
        digests.push(conn.query_row(
            "SELECT digest FROM catalog_items WHERE item_id=?1",
            [item],
            |r| r.get::<_, String>(0),
        )?);
    }
    digests.sort();
    Ok(digests)
}
pub fn put_bundle(db: &Database, bundle: &Bundle, actor: &str) -> Result<()> {
    ensure!(
        !bundle.bundle_id.is_empty() && !bundle.items.is_empty(),
        "Bundle id and items are required"
    );
    ensure!(
        bundle
            .items
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            == bundle.items.len(),
        "Duplicate bundle items"
    );
    let mut conn = db.0.lock().map_err(|_| anyhow!("database lock poisoned"))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for item in &bundle.items {
        ensure!(
            tx.query_row(
                "SELECT COUNT(*) FROM catalog_items WHERE item_id=?1",
                [item],
                |r| r.get::<_, i64>(0)
            )? == 1,
            "Unknown bundle item: {item}"
        );
    }
    tx.execute("INSERT INTO bundles(bundle_id,title,items,rules) VALUES (?1,?2,?3,?4) ON CONFLICT(bundle_id) DO UPDATE SET title=excluded.title,items=excluded.items,rules=excluded.rules",params![bundle.bundle_id,bundle.title,serde_json::to_string(&bundle.items)?,bundle.rules.to_string()])?;
    super::receipt::audit(
        &tx,
        actor,
        "bundle.put",
        &bundle.bundle_id,
        &serde_json::to_value(bundle)?,
    )?;
    tx.commit()?;
    Ok(())
}
pub fn bundles(db: &Database) -> Result<Vec<Bundle>> {
    let conn = db.0.lock().map_err(|_| anyhow!("database lock poisoned"))?;
    let mut stmt =
        conn.prepare("SELECT bundle_id,title,items,rules FROM bundles ORDER BY bundle_id")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    rows.map(|r| {
        let (bundle_id, title, items, rules) = r?;
        Ok(Bundle {
            bundle_id,
            title,
            items: serde_json::from_str(&items)?,
            rules: serde_json::from_str(&rules)?,
        })
    })
    .collect()
}
/// Rules may require a particular measured CLEF pick. No heuristic scoring.
pub fn synthesize(
    db: &Database,
    status: &EngineStatus,
    session: &str,
    actor: &str,
) -> Result<Value> {
    db.session_record(session)?;
    let catalog = bundles(db)?;
    let evaluations = db.evaluations(session)?;
    let latest = evaluations.iter().rev().find(|e| e["status"] == "Verified");
    let mut selected = Vec::new();
    for bundle in catalog {
        if let Some(required) = bundle.rules.get("required_pick") {
            if !matches!(status, EngineStatus::Ready { .. })
                || latest.is_none_or(|e| e["pick"] != *required)
            {
                continue;
            }
        }
        selected.push(bundle);
    }
    let source = if selected
        .iter()
        .any(|b| b.rules.get("required_pick").is_some())
    {
        "Configured rules using recorded CLEF picks"
    } else if matches!(status, EngineStatus::Ready { .. }) && latest.is_some() {
        "Static configured catalog — no CLEF rule applied"
    } else {
        "Static configured catalog — CLEF unavailable or unevaluated"
    };
    let mut conn = db.0.lock().map_err(|_| anyhow!("database lock poisoned"))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute("DELETE FROM session_offers WHERE session_id=?1", [session])?;
    for bundle in &selected {
        let used_clef = bundle.rules.get("required_pick").is_some();
        let offer_source = if used_clef {
            "CLEF"
        } else if matches!(status, EngineStatus::Ready { .. }) && latest.is_some() {
            "Static configured catalog — no CLEF rule applied"
        } else {
            "Static configured catalog — CLEF unavailable or unevaluated"
        };
        let evaluation = if used_clef {
            latest.and_then(|e| e["evaluation_id"].as_str())
        } else {
            None
        };
        tx.execute("INSERT INTO session_offers(offer_id,session_id,bundle_id,source,evaluation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![id(),session,bundle.bundle_id,offer_source,evaluation,now()])?;
    }
    super::receipt::audit(
        &tx,
        actor,
        "offer.synthesize",
        session,
        &json!({"source":source,"bundles":selected}),
    )?;
    tx.commit()?;
    Ok(json!({"source":source,"bundles":selected}))
}
