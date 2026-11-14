use anyhow::{Context, Result, ensure};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::Write, net::IpAddr, path::Path};
use subtle::ConstantTimeEq;

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
#[derive(Clone)]
pub struct AdminAuth {
    token_hash: [u8; 32],
    pub allow_remote: bool,
}
impl AdminAuth {
    pub fn load(dir: &Path, allow_remote: bool) -> Result<(Self, Option<String>, Vec<u8>)> {
        let (token, created) = private_file(&dir.join("outrider-admin-token"), || {
            Ok(random_secret().into_bytes())
        })?;
        let text = String::from_utf8(token).context("Invalid admin token file")?;
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
}
