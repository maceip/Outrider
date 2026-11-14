//! Best-effort background download of the CLEF `.litertlm` model from the public bucket.
//! Any failure is logged at debug level and otherwise ignored: CLEF stays `Unconfigured`
//! and the user can still supply a model with `--clef-model` / `OUTRIDER_CLEF_MODEL`.
//! A completed download is picked up on the next launch.

use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub const DEFAULT_MODEL_URL: &str =
    "https://outrider-public-models.s3.eu-central-1.amazonaws.com/clef/clef-flash.litertlm";

pub fn default_model_path(config_dir: &Path) -> PathBuf {
    config_dir.join("models").join("clef-flash.litertlm")
}

fn model_url() -> String {
    std::env::var("OUTRIDER_CLEF_MODEL_URL").unwrap_or_else(|_| DEFAULT_MODEL_URL.to_string())
}

/// Spawns the download if `dest` is missing. Never returns an error to the caller.
pub fn spawn_background_fetch(dest: PathBuf) {
    if dest.is_file() || std::env::var_os("OUTRIDER_CLEF_NO_FETCH").is_some() {
        return;
    }
    tokio::spawn(async move {
        match fetch(&model_url(), &dest).await {
            Ok(()) => log::info!("CLEF model downloaded to {}; active on next launch", dest.display()),
            Err(e) => log::debug!("CLEF background fetch skipped: {e:#}"),
        }
    });
}

pub async fn fetch(url: &str, dest: &Path) -> Result<()> {
    let client = reqwest::Client::new();
    let expected = client
        .get(format!("{url}.sha256"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let expected = expected
        .split_whitespace()
        .next()
        .context("empty sha256 sidecar")?
        .to_ascii_lowercase();
    ensure!(expected.len() == 64, "malformed sha256 sidecar");

    tokio::fs::create_dir_all(dest.parent().context("no parent dir")?).await?;
    let part = dest.with_extension("litertlm.part");
    let have = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await?.error_for_status()?;
    let resumed = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&part)
        .await?;
    let mut body = resp.bytes_stream();
    while let Some(chunk) = body.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    drop(file);

    let part_for_hash = part.clone();
    let actual = tokio::task::spawn_blocking(move || -> Result<String> {
        let mut f = std::fs::File::open(part_for_hash)?;
        let mut h = Sha256::new();
        std::io::copy(&mut f, &mut h)?;
        Ok(format!("{:x}", h.finalize()))
    })
    .await??;
    if actual != expected {
        let _ = tokio::fs::remove_file(&part).await;
        anyhow::bail!("sha256 mismatch");
    }
    tokio::fs::rename(&part, dest).await?;
    Ok(())
}
