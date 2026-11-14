use super::{
    admin_auth::private_file,
    db::{Database, id, now},
};
use anyhow::{Context, Result, anyhow, ensure};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{
    Signature, Signer, SigningKey,
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
};
use rand::{RngCore, rngs::OsRng};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityReceipt {
    pub receipt_id: String,
    pub subject: String,
    pub bundle_id: String,
    pub item_digests: Vec<String>,
    pub max_calls: i64,
    pub expires_at_unix: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedReceipt {
    pub receipt: CapabilityReceipt,
    pub signature: String,
}
impl SignedReceipt {
    pub fn encode(&self) -> Result<String> {
        Ok(URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?))
    }
    pub fn decode(token: &str) -> Result<Self> {
        ensure!(token.len() <= 65536, "Receipt too large");
        Ok(serde_json::from_slice(&URL_SAFE_NO_PAD.decode(token)?)?)
    }
}
#[derive(Clone)]
pub struct ReceiptAuthority {
    key: SigningKey,
    db: Database,
}
impl ReceiptAuthority {
    pub fn load(db: Database, path: &Path) -> Result<Self> {
        let (bytes, _) = private_file(path, || {
            let mut seed = [0; 32];
            OsRng.fill_bytes(&mut seed);
            Ok(SigningKey::from_bytes(&seed)
                .to_pkcs8_pem(Default::default())?
                .as_bytes()
                .to_vec())
        })?;
        Ok(Self {
            key: SigningKey::from_pkcs8_pem(std::str::from_utf8(&bytes)?)?,
            db,
        })
    }
    pub fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.key.verifying_key().as_bytes())
    }
    pub fn issue(
        &self,
        subject: &str,
        bundle: &str,
        max_calls: i64,
        expires: i64,
        actor: &str,
    ) -> Result<SignedReceipt> {
        ensure!(
            !subject.is_empty() && subject.len() <= 2048,
            "Invalid receipt subject"
        );
        ensure!(
            max_calls > 0 && expires > now(),
            "Receipt needs positive quota and future expiry"
        );
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let digests = super::bundler::bundle_digests(&tx, bundle)?;
        let receipt = CapabilityReceipt {
            receipt_id: id(),
            subject: subject.into(),
            bundle_id: bundle.into(),
            item_digests: digests,
            max_calls,
            expires_at_unix: expires,
        };
        let signature =
            URL_SAFE_NO_PAD.encode(self.key.sign(&serde_jcs::to_vec(&receipt)?).to_bytes());
        tx.execute("INSERT INTO capability_receipts(receipt_id,subject,bundle_id,payload,signature,max_calls,remaining_calls,expires_at_unix,created_at) VALUES (?1,?2,?3,?4,?5,?6,?6,?7,?8)",params![receipt.receipt_id,subject,bundle,serde_json::to_string(&receipt)?,signature,max_calls,expires,now()])?;
        audit(
            &tx,
            actor,
            "receipt.issue",
            &receipt.receipt_id,
            &serde_json::json!({"subject":subject,"bundle_id":bundle,"max_calls":max_calls,"expires_at_unix":expires}),
        )?;
        tx.commit()?;
        Ok(SignedReceipt { receipt, signature })
    }
    pub fn verify_signature(&self, signed: &SignedReceipt) -> Result<()> {
        let bytes = URL_SAFE_NO_PAD.decode(&signed.signature)?;
        let signature = Signature::from_slice(&bytes)?;
        self.key
            .verifying_key()
            .verify_strict(&serde_jcs::to_vec(&signed.receipt)?, &signature)
            .context("Invalid Ed25519 receipt signature")?;
        Ok(())
    }
    pub fn verify(&self, signed: &SignedReceipt, subject: &str, bundle: &str) -> Result<i64> {
        self.verify_signature(signed)?;
        let conn = self
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        validate(&conn, signed, subject, bundle)
    }
    /// Signature verification precedes one atomic quote-consume + quota-decrement transaction.
    pub fn redeem(
        &self,
        signed: &SignedReceipt,
        subject: &str,
        bundle: &str,
        session: &str,
        tool: &str,
        quote: Option<&str>,
    ) -> Result<i64> {
        self.verify_signature(signed)?;
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let remaining = validate(&tx, signed, subject, bundle)?;
        if let Some(quote) = quote {
            let changed=tx.execute("UPDATE mrtr_quotes SET consumed=1 WHERE quote_id=?1 AND session_id=?2 AND subject=?3 AND bundle_id=?4 AND expires_at_unix>?5 AND consumed=0",params![quote,session,subject,bundle,now()])?;
            ensure!(
                changed == 1,
                "Quote is expired, consumed, or belongs to another request"
            );
        }
        let changed=tx.execute("UPDATE capability_receipts SET remaining_calls=remaining_calls-1 WHERE receipt_id=?1 AND remaining_calls>0 AND revoked=0 AND expires_at_unix>?2",params![signed.receipt.receipt_id,now()])?;
        ensure!(changed == 1, "Receipt is exhausted, revoked, or expired");
        tx.execute("INSERT INTO receipt_redemptions(redemption_id,receipt_id,session_id,tool_name,quote_id,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![id(),signed.receipt.receipt_id,session,tool,quote,now()])?;
        tx.execute(
            "INSERT OR IGNORE INTO presented_receipts(session_id,receipt_id) VALUES (?1,?2)",
            params![session, signed.receipt.receipt_id],
        )?;
        tx.commit()?;
        Ok(remaining - 1)
    }
    pub fn revoke(&self, receipt_id: &str, actor: &str) -> Result<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|_| anyhow!("database lock poisoned"))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure!(
            tx.execute(
                "UPDATE capability_receipts SET revoked=1 WHERE receipt_id=?1",
                [receipt_id]
            )? == 1,
            "Unknown receipt"
        );
        audit(
            &tx,
            actor,
            "receipt.revoke",
            receipt_id,
            &serde_json::json!({}),
        )?;
        tx.commit()?;
        Ok(())
    }
}
fn validate(
    conn: &rusqlite::Connection,
    signed: &SignedReceipt,
    subject: &str,
    bundle: &str,
) -> Result<i64> {
    let r = &signed.receipt;
    ensure!(r.subject == subject, "Wrong receipt subject");
    ensure!(r.bundle_id == bundle, "Wrong receipt bundle");
    ensure!(r.expires_at_unix > now(), "Receipt expired");
    ensure!(
        r.item_digests == super::bundler::bundle_digests(conn, bundle)?,
        "Bundle digests changed"
    );
    let row:Option<(String,String,i64,bool)>=conn.query_row("SELECT payload,signature,remaining_calls,revoked FROM capability_receipts WHERE receipt_id=?1",[&r.receipt_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let (payload, signature, remaining, revoked) =
        row.context("Receipt was not issued by this authority")?;
    ensure!(
        serde_json::from_str::<CapabilityReceipt>(&payload)? == *r && signature == signed.signature,
        "Receipt differs from issued payload"
    );
    ensure!(!revoked, "Receipt revoked");
    ensure!(remaining > 0, "Receipt quota exhausted");
    Ok(remaining)
}
pub(crate) fn audit(
    tx: &rusqlite::Transaction<'_>,
    actor: &str,
    action: &str,
    target: &str,
    details: &serde_json::Value,
) -> Result<()> {
    tx.execute("INSERT INTO admin_audit_log(audit_id,actor,action,target,details,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![id(),actor,action,target,details.to_string(),now()])?;
    Ok(())
}
