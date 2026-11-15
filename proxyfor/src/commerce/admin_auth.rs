use anyhow::{Context, Result, ensure};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::Write,
    net::IpAddr,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

pub const BOOTSTRAP_NONCE_TTL: Duration = Duration::from_secs(30);

pub fn private_file(
    path: &Path,
    generate: impl FnOnce() -> Result<Vec<u8>>,
) -> Result<(Vec<u8>, bool)> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => {
            let bytes = generate()?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok((bytes, true))
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                ensure!(
                    std::fs::metadata(path)?.permissions().mode() & 0o077 == 0,
                    "Secret file must have mode 0600: {}",
                    path.display()
                );
            }
            Ok((std::fs::read(path)?, false))
        }
        Err(e) => Err(e.into()),
    }
}

pub fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

type BootstrapNonceList = Vec<([u8; 32], Instant)>;

#[derive(Clone)]
pub struct AdminAuth {
    token_hash: [u8; 32],
    token_secret: Arc<String>,
    bootstrap_nonces: Arc<Mutex<BootstrapNonceList>>,
    pub allow_remote: bool,
}

impl AdminAuth {
    pub fn load(dir: &Path, allow_remote: bool) -> Result<(Self, Option<String>, Vec<u8>)> {
        let (token, created) = private_file(&dir.join("outrider-admin-token"), || {
            Ok(random_secret().into_bytes())
        })?;
        let text = String::from_utf8(token)
            .context("Invalid admin token file")?
            .trim()
            .to_owned();
        ensure!(text.len() >= 32, "Admin token is too short");
        let (hmac, _) = private_file(&dir.join("outrider-request-state.key"), || {
            let mut b = vec![0; 32];
            OsRng.fill_bytes(&mut b);
            Ok(b)
        })?;
        ensure!(hmac.len() >= 32, "MRTR HMAC secret is too short");
        Ok((
            Self {
                token_hash: Sha256::digest(text.as_bytes()).into(),
                token_secret: Arc::new(text.clone()),
                bootstrap_nonces: Default::default(),
                allow_remote,
            },
            created.then_some(text),
            hmac,
        ))
    }

    pub fn authorize(&self, peer: Option<IpAddr>, authorization: Option<&str>) -> Result<(), u16> {
        let provided = authorization
            .and_then(|s| s.strip_prefix("Bearer "))
            .ok_or(401u16)?;
        let hash: [u8; 32] = Sha256::digest(provided.as_bytes()).into();
        if !bool::from(self.token_hash.ct_eq(&hash)) {
            return Err(401);
        }
        if !self.allow_remote && !peer.is_some_and(|p| p.is_loopback()) {
            return Err(403);
        }
        Ok(())
    }

    /// Mints a single-use, 30-second-TTL bootstrap nonce for local desktop browser launch.
    pub fn mint_bootstrap_nonce(&self) -> String {
        let nonce = random_secret();
        let digest: [u8; 32] = Sha256::digest(nonce.as_bytes()).into();
        let mut guard = self.bootstrap_nonces.lock().unwrap();
        guard.retain(|(_, issued_at)| issued_at.elapsed() <= BOOTSTRAP_NONCE_TTL);
        if guard.len() >= 16 {
            guard.remove(0);
        }
        guard.push((digest, Instant::now()));
        nonce
    }

    /// Exchanges a single-use bootstrap nonce for the admin bearer token.
    /// Always requires a loopback peer even when `--admin-allow-remote` is enabled.
    pub fn exchange_bootstrap_nonce(
        &self,
        peer: Option<IpAddr>,
        candidate: &str,
    ) -> Result<String, u16> {
        if !peer.is_some_and(|p| p.is_loopback()) {
            return Err(403);
        }
        let trimmed = candidate.trim();
        if trimmed.len() < 32 {
            return Err(401);
        }
        let candidate_hash: [u8; 32] = Sha256::digest(trimmed.as_bytes()).into();
        let mut guard = self.bootstrap_nonces.lock().unwrap();
        guard.retain(|(_, issued_at)| issued_at.elapsed() <= BOOTSTRAP_NONCE_TTL);
        let mut matched_idx = None;
        for (idx, (stored_hash, _)) in guard.iter().enumerate() {
            if bool::from(stored_hash.ct_eq(&candidate_hash)) {
                matched_idx = Some(idx);
            }
        }
        if let Some(idx) = matched_idx {
            guard.remove(idx);
            Ok((*self.token_secret).clone())
        } else {
            Err(401)
        }
    }

    /// Issues the admin bearer token directly to the local loopback dashboard in local-only mode.
    pub fn bootstrap_local_session(
        &self,
        peer: Option<IpAddr>,
        host_header: Option<&str>,
        client_header: Option<&str>,
        sec_fetch_site: Option<&str>,
    ) -> Result<String, u16> {
        if self.allow_remote {
            return Err(403);
        }
        if !peer.is_some_and(|ip| ip.is_loopback()) {
            return Err(403);
        }
        let Some(raw_host) = host_header.map(str::trim).filter(|s| !s.is_empty()) else {
            return Err(403);
        };
        if !is_allowed_loopback_host(raw_host) {
            return Err(403);
        }
        if client_header.map(str::trim) != Some("dashboard") {
            return Err(403);
        }
        if let Some(site) = sec_fetch_site.map(str::trim)
            && site != "same-origin"
            && site != "none"
        {
            return Err(403);
        }
        Ok((*self.token_secret).clone())
    }
}

fn is_allowed_loopback_host(raw_host: &str) -> bool {
    let host_part = if raw_host.starts_with('[') {
        if raw_host.ends_with(']') {
            raw_host
        } else if let Some((bracketed, port)) = raw_host.rsplit_once(':')
            && bracketed.ends_with(']')
            && !port.is_empty()
            && port.bytes().all(|b| b.is_ascii_digit())
            && port.parse::<u16>().is_ok()
        {
            bracketed
        } else {
            return false;
        }
    } else if let Some((h, port)) = raw_host.split_once(':') {
        if !port.is_empty()
            && port.bytes().all(|b| b.is_ascii_digit())
            && port.parse::<u16>().is_ok()
        {
            h
        } else {
            return false;
        }
    } else {
        raw_host
    };
    host_part.eq_ignore_ascii_case("localhost")
        || host_part == "127.0.0.1"
        || host_part.eq_ignore_ascii_case("[::1]")
}
