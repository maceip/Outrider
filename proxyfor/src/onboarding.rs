//! Idiot-proof desktop onboarding:
//! 1. Scans local Claude Desktop, Claude Code, and OpenAI Codex installations/configs,
//!    backs up existing configs, injects Outrider as an MCP server, and optionally
//!    restarts running agent processes ONLY when `restart_confirmed == true`.
//! 2. Generates 1-click `cursor://` and `vscode:` MCP install deep-links.
//! 3. Executes a real in-process loopback TLS `rmcp` agent sortie (`run_sortie`) so
//!    users on any browser (including Safari/Firefox without Chromium WebMCP) or
//!    machines without Claude/Codex immediately record real TLS `ClientHello` JA4,
//!    HTTP header order, MCP `2026-07-28` frames, MRTR quotes, Ed25519 receipts,
//!    and proxied HTTP traffic in SQLite.
#![allow(deprecated)]

use crate::{
    clef::{engine::EngineStatus, schema::Question},
    commerce::{
        Commerce,
        bundler::{self, Bundle},
        db::now,
    },
    mcp_gateway::handler::public_session_id,
};
use anyhow::{Context, Result, anyhow, bail, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use rmcp::{
    ClientHandler, ClientLifecycleMode, ClientServiceExt,
    model::*,
    service::{RequestContext, RoleClient},
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};

pub const DEFAULT_SORTIE_BUNDLE_ID: &str = "observatory-evidence";

#[derive(Clone, Debug)]
struct LocalAgentSpec {
    id: &'static str,
    name: &'static str,
    transport: &'static str,
    config_path: PathBuf,
    app_installed: bool,
}

fn find_in_path(bin_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        for ext in ["exe", "cmd", "bat"] {
            let with_ext = dir.join(format!("{bin_name}.{ext}"));
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }
    }
    None
}

fn resolve_agent_specs() -> Result<Vec<LocalAgentSpec>> {
    if let Some(scan_root) = env::var_os("OUTRIDER_AGENT_SCAN_ROOT").map(PathBuf::from) {
        let claude_desktop_cfg = scan_root
            .join("claude_desktop")
            .join("claude_desktop_config.json");
        let claude_desktop_app = scan_root.join("apps").join("Claude.app").exists()
            || scan_root.join("bin").join("claude-desktop").is_file()
            || claude_desktop_cfg
                .parent()
                .is_some_and(|parent| parent.is_dir());

        let claude_code_cfg = scan_root.join("home").join(".claude.json");
        let claude_code_app =
            scan_root.join("bin").join("claude").is_file() || claude_code_cfg.is_file();

        let codex_cfg = scan_root.join("home").join(".codex").join("config.toml");
        let codex_app = scan_root.join("bin").join("codex").is_file()
            || codex_cfg.parent().is_some_and(|parent| parent.is_dir());

        return Ok(vec![
            LocalAgentSpec {
                id: "claude-desktop",
                name: "Claude Desktop",
                transport: "stdio",
                config_path: claude_desktop_cfg,
                app_installed: claude_desktop_app,
            },
            LocalAgentSpec {
                id: "claude-code",
                name: "Claude Code CLI",
                transport: "http",
                config_path: claude_code_cfg,
                app_installed: claude_code_app,
            },
            LocalAgentSpec {
                id: "codex",
                name: "OpenAI Codex",
                transport: "http",
                config_path: codex_cfg,
                app_installed: codex_app,
            },
        ]);
    }

    let home = dirs::home_dir().context("Unable to determine user home directory")?;

    let (claude_desktop_cfg, claude_desktop_installed) = if cfg!(target_os = "macos") {
        let cfg = home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json");
        let installed = Path::new("/Applications/Claude.app").exists()
            || home.join("Applications/Claude.app").exists()
            || cfg.parent().is_some_and(|p| p.is_dir());
        (cfg, installed)
    } else if cfg!(target_os = "windows") {
        let appdata = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        let local_appdata = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Local"));
        let cfg = appdata.join("Claude").join("claude_desktop_config.json");
        let installed = local_appdata
            .join("AnthropicClaude")
            .join("Claude.exe")
            .is_file()
            || local_appdata
                .join("Programs")
                .join("claude")
                .join("Claude.exe")
                .is_file()
            || cfg.parent().is_some_and(|p| p.is_dir());
        (cfg, installed)
    } else {
        let cfg = home
            .join(".config")
            .join("Claude")
            .join("claude_desktop_config.json");
        let installed = cfg.parent().is_some_and(|p| p.is_dir());
        (cfg, installed)
    };

    let claude_code_cfg = home.join(".claude.json");
    let claude_code_installed = claude_code_cfg.is_file()
        || home.join(".claude").is_dir()
        || home.join(".local/bin/claude").is_file()
        || find_in_path("claude").is_some();

    let codex_cfg = home.join(".codex").join("config.toml");
    let codex_installed = codex_cfg.is_file()
        || codex_cfg.parent().is_some_and(|p| p.is_dir())
        || Path::new("/Applications/Codex.app").exists()
        || find_in_path("codex").is_some();

    Ok(vec![
        LocalAgentSpec {
            id: "claude-desktop",
            name: "Claude Desktop",
            transport: "stdio",
            config_path: claude_desktop_cfg,
            app_installed: claude_desktop_installed,
        },
        LocalAgentSpec {
            id: "claude-code",
            name: "Claude Code CLI",
            transport: "http",
            config_path: claude_code_cfg,
            app_installed: claude_code_installed,
        },
        LocalAgentSpec {
            id: "codex",
            name: "OpenAI Codex",
            transport: "http",
            config_path: codex_cfg,
            app_installed: codex_installed,
        },
    ])
}

fn json_has_outrider(path: &Path) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    val.get("mcpServers")
        .and_then(Value::as_object)
        .is_some_and(|m| m.contains_key("outrider"))
}

fn toml_has_outrider(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    text.lines()
        .any(|line| line.trim() == "[mcp_servers.outrider]")
}

fn detect_running_pids(agent_id: &str) -> Vec<u32> {
    if let Ok(override_list) = env::var("OUTRIDER_AGENT_TEST_RUNNING") {
        let active = override_list
            .split(',')
            .map(str::trim)
            .any(|item| item == agent_id);
        return if active { vec![42420] } else { Vec::new() };
    }
    if env::var_os("OUTRIDER_AGENT_SCAN_ROOT").is_some() {
        return Vec::new();
    }

    #[cfg(unix)]
    {
        let pattern = match agent_id {
            "claude-desktop" => {
                if cfg!(target_os = "macos") {
                    "/Claude.app/Contents/MacOS/Claude"
                } else {
                    "claude-desktop"
                }
            }
            "claude-code" => "^claude$",
            "codex" => "^codex$|/Codex.app/Contents/MacOS/Codex",
            _ => return Vec::new(),
        };
        let flag = if pattern.starts_with('^') && !pattern.contains('/') {
            "-x"
        } else {
            "-f"
        };
        let Ok(out) = Command::new("pgrep").args([flag, pattern]).output() else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| l.trim().parse::<u32>().ok())
            .collect()
    }

    #[cfg(windows)]
    {
        let image = match agent_id {
            "claude-desktop" => "Claude.exe",
            "claude-code" => "claude.exe",
            "codex" => "codex.exe",
            _ => return Vec::new(),
        };
        let Ok(out) = Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {image}"), "/FO", "CSV", "/NH"])
            .output()
        else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let cols: Vec<&str> = line.split(',').collect();
                if cols.len() >= 2 {
                    cols[1].trim_matches('"').parse::<u32>().ok()
                } else {
                    None
                }
            })
            .collect()
    }
}

fn db_file_path(commerce: &Commerce) -> PathBuf {
    if let Ok(conn) = commerce.db.0.lock()
        && let Some(p) = conn.path()
        && !p.is_empty()
    {
        return PathBuf::from(p);
    }
    commerce.config_dir.join("outrider.db")
}

fn build_deep_links(mcp_http_url: &str) -> Value {
    let cursor_cfg = BASE64_STANDARD.encode(json!({"url": mcp_http_url}).to_string());
    let vscode_payload = json!({
        "name": "outrider",
        "type": "http",
        "url": mcp_http_url,
    })
    .to_string();
    let vscode_encoded: String =
        url::form_urlencoded::byte_serialize(vscode_payload.as_bytes()).collect();
    json!({
        "cursor": format!("cursor://anysphere.cursor-deeplink/mcp/install?name=outrider&config={cursor_cfg}"),
        "vscode": format!("vscode:mcp/install?{vscode_encoded}"),
    })
}

pub fn scan_agents(commerce: &Arc<Commerce>) -> Result<Value> {
    let mcp_http_url = commerce
        .mcp_http_url()
        .unwrap_or_else(|| "http://127.0.0.1:8080/mcp".to_owned());
    let exe_path = env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("outrider"))
        .display()
        .to_string();
    let db_path = db_file_path(commerce);
    let specs = resolve_agent_specs()?;

    let mut agents = Vec::with_capacity(specs.len());
    for spec in specs {
        let config_exists = spec.config_path.is_file();
        let already_configured = if spec.id == "codex" {
            toml_has_outrider(&spec.config_path)
        } else {
            json_has_outrider(&spec.config_path)
        };
        let pids = detect_running_pids(spec.id);
        agents.push(json!({
            "id": spec.id,
            "name": spec.name,
            "transport": spec.transport,
            "detected": spec.app_installed || config_exists,
            "config_path": spec.config_path.display().to_string(),
            "config_exists": config_exists,
            "already_configured": already_configured,
            "running": !pids.is_empty(),
            "running_pids": pids,
        }));
    }

    Ok(json!({
        "mcp_http_url": mcp_http_url,
        "executable_path": exe_path,
        "config_dir": commerce.config_dir.display().to_string(),
        "db_path": db_path.display().to_string(),
        "deep_links": build_deep_links(&mcp_http_url),
        "agents": agents,
    }))
}

fn atomic_write_with_backup(path: &Path, new_contents: &[u8]) -> Result<Option<PathBuf>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create directory {}", parent.display()))?;
    }
    let backup_path = if path.is_file() {
        let bak = PathBuf::from(format!("{}.bak.{}", path.display(), now()));
        fs::copy(path, &bak)
            .with_context(|| format!("Failed to create backup {}", bak.display()))?;
        Some(bak)
    } else {
        None
    };
    let tmp = PathBuf::from(format!("{}.tmp.{}", path.display(), std::process::id()));
    fs::write(&tmp, new_contents)
        .with_context(|| format!("Failed to write temporary config {}", tmp.display()))?;
    fs::rename(&tmp, path)
        .with_context(|| format!("Failed to replace config {}", path.display()))?;
    Ok(backup_path)
}

pub fn upsert_codex_toml_section(existing: &str, mcp_http_url: &str) -> String {
    let mut kept_lines: Vec<&str> = Vec::new();
    let mut skipping_outrider = false;
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if trimmed == "[mcp_servers.outrider]"
                || trimmed.starts_with("[mcp_servers.outrider.")
            {
                skipping_outrider = true;
                continue;
            } else {
                skipping_outrider = false;
            }
        }
        if !skipping_outrider {
            kept_lines.push(line);
        }
    }
    while kept_lines.last().is_some_and(|l| l.trim().is_empty()) {
        kept_lines.pop();
    }
    let mut out = kept_lines.join("\n");
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    let escaped_url = mcp_http_url.replace('\\', "\\\\").replace('"', "\\\"");
    out.push_str(&format!(
        "[mcp_servers.outrider]\nurl = \"{escaped_url}\"\n"
    ));
    out
}

fn restart_agent_if_requested(agent_id: &str) -> Result<(bool, String)> {
    if let Some(recorder) = env::var_os("OUTRIDER_AGENT_RESTART_RECORDER").map(PathBuf::from) {
        let mut content = fs::read_to_string(&recorder).unwrap_or_default();
        content.push_str(&format!(
            "{}\n",
            json!({"agent_id": agent_id, "restarted_at_unix": now()})
        ));
        fs::write(&recorder, content)?;
        return Ok((
            true,
            format!("Recorded consent-approved restart for {agent_id}."),
        ));
    }

    match agent_id {
        "claude-desktop" => {
            #[cfg(target_os = "macos")]
            {
                let quit = Command::new("osascript")
                    .args(["-e", "tell application \"Claude\" to quit"])
                    .status();
                std::thread::sleep(Duration::from_millis(600));
                let open = Command::new("open").args(["-a", "Claude"]).status();
                let ok = quit.is_ok_and(|s| s.success()) && open.is_ok_and(|s| s.success());
                Ok((
                    ok,
                    if ok {
                        "Restarted Claude Desktop with Outrider MCP enabled.".into()
                    } else {
                        "Configuration saved. Restart Claude Desktop manually to reload MCP servers.".into()
                    },
                ))
            }
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/IM", "Claude.exe", "/F"])
                    .status();
                std::thread::sleep(Duration::from_millis(500));
                let local = env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_default();
                for candidate in [
                    local.join("AnthropicClaude").join("Claude.exe"),
                    local.join("Programs").join("claude").join("Claude.exe"),
                ] {
                    if candidate.is_file() && Command::new(&candidate).spawn().is_ok() {
                        return Ok((
                            true,
                            "Restarted Claude Desktop with Outrider MCP enabled.".into(),
                        ));
                    }
                }
                Ok((
                    false,
                    "Configuration saved. Re-open Claude Desktop from the Start Menu.".into(),
                ))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                Ok((
                    false,
                    "Configuration saved. Restart Claude Desktop manually to reload MCP servers."
                        .into(),
                ))
            }
        }
        "codex" => {
            #[cfg(target_os = "macos")]
            if Path::new("/Applications/Codex.app").exists()
                && !detect_running_pids("codex").is_empty()
            {
                let quit = Command::new("osascript")
                    .args(["-e", "tell application \"Codex\" to quit"])
                    .status();
                std::thread::sleep(Duration::from_millis(600));
                let open = Command::new("open").args(["-a", "Codex"]).status();
                if quit.is_ok_and(|s| s.success()) && open.is_ok_and(|s| s.success()) {
                    return Ok((true, "Restarted Codex.app with Outrider MCP enabled.".into()));
                }
            }
            Ok((
                false,
                "Configuration saved. Start a new `codex` session to load `[mcp_servers.outrider]`."
                    .into(),
            ))
        }
        "claude-code" => Ok((
            false,
            "Configuration saved. Start a new `claude` CLI session to load `mcpServers.outrider`."
                .into(),
        )),
        _ => Ok((false, "Configuration saved.".into())),
    }
}

pub fn configure_agent(commerce: &Arc<Commerce>, body: &Value, actor: &str) -> Result<Value> {
    let agent_id = body["agent_id"].as_str().context("Missing agent_id")?;
    let restart_confirmed = body["restart_confirmed"].as_bool().unwrap_or(false);

    let specs = resolve_agent_specs()?;
    let spec = specs
        .into_iter()
        .find(|s| s.id == agent_id)
        .with_context(|| format!("Unsupported agent_id '{agent_id}'"))?;

    let mcp_http_url = commerce
        .mcp_http_url()
        .unwrap_or_else(|| "http://127.0.0.1:8080/mcp".to_owned());
    let exe_path = env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("outrider"))
        .display()
        .to_string();
    let db_path = db_file_path(commerce);

    let backup_path = if spec.id == "codex" {
        let existing = if spec.config_path.is_file() {
            fs::read_to_string(&spec.config_path).with_context(|| {
                format!("Failed to read existing {}", spec.config_path.display())
            })?
        } else {
            String::new()
        };
        let updated = upsert_codex_toml_section(&existing, &mcp_http_url);
        atomic_write_with_backup(&spec.config_path, updated.as_bytes())?
    } else {
        let mut root: Value = if spec.config_path.is_file() {
            let raw = fs::read_to_string(&spec.config_path).with_context(|| {
                format!("Failed to read existing {}", spec.config_path.display())
            })?;
            if raw.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str(&raw).with_context(|| {
                    format!(
                        "Refusing to overwrite malformed JSON in {}",
                        spec.config_path.display()
                    )
                })?
            }
        } else {
            json!({})
        };
        let root_obj = root
            .as_object_mut()
            .context("Agent configuration root must be a JSON object")?;
        let servers_val = root_obj
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        let servers = servers_val
            .as_object_mut()
            .context("`mcpServers` field in agent config is not a JSON object")?;

        let entry = if spec.id == "claude-desktop" {
            json!({
                "command": exe_path,
                "args": [
                    "--stdio",
                    "--config-dir",
                    commerce.config_dir.display().to_string(),
                    "--db",
                    db_path.display().to_string(),
                ]
            })
        } else {
            json!({
                "type": "http",
                "url": mcp_http_url,
            })
        };
        servers.insert("outrider".to_owned(), entry);
        let formatted = format!("{}\n", serde_json::to_string_pretty(&root)?);
        atomic_write_with_backup(&spec.config_path, formatted.as_bytes())?
    };

    let (restarted, restart_note) = if restart_confirmed {
        restart_agent_if_requested(spec.id)?
    } else {
        (
            false,
            "Configuration saved without restarting running agent processes.".to_owned(),
        )
    };

    let response = json!({
        "agent_id": spec.id,
        "name": spec.name,
        "config_path": spec.config_path.display().to_string(),
        "backup_path": backup_path.map(|p| p.display().to_string()),
        "configured": true,
        "restart_confirmed": restart_confirmed,
        "restarted": restarted,
        "note": restart_note,
    });
    commerce.db.admin_audit(
        actor,
        "onboarding.configure_agent",
        spec.id,
        &response,
    )?;
    Ok(response)
}

#[derive(Clone)]
struct SortieClient {
    commerce: Arc<Commerce>,
    client_name: String,
}

impl ClientHandler for SortieClient {
    fn get_info(&self) -> ClientConfig {
        let caps = if matches!(self.commerce.clef.status(), EngineStatus::Ready { .. }) {
            ClientCapabilities::builder()
                .enable_sampling()
                .enable_elicitation()
                .build()
        } else {
            ClientCapabilities::builder().enable_elicitation().build()
        };
        ClientConfig::new(
            caps,
            Implementation::new(&self.client_name, env!("CARGO_PKG_VERSION")),
        )
    }

    async fn create_message(
        &self,
        request: CreateMessageRequestParams,
        _: RequestContext<RoleClient>,
    ) -> std::result::Result<CreateMessageResult, ErrorData> {
        let prompt = serde_json::to_value(&request)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let eval = self
            .commerce
            .clef
            .evaluate(
                Question::Choice {
                    question:
                        "Return the requested acknowledgment value for the Outrider capability probe."
                            .into(),
                    options: vec!["outrider".into()],
                },
                json!({"sampling_request": prompt}),
            )
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        Ok(CreateMessageResult::new(
            SamplingMessage::assistant_text(json!({"ack": eval.pick}).to_string()),
            serde_json::to_string(self.commerce.clef.status()).unwrap_or_else(|_| "clef".into()),
        ))
    }
}

pub async fn run_sortie(commerce: &Arc<Commerce>, body: &Value, actor: &str) -> Result<Value> {
    commerce.register_local_tools()?;
    let listener = commerce
        .listener_info
        .read()
        .map_err(|_| anyhow!("listener_info lock poisoned"))?
        .clone()
        .context("Gateway HTTP/TLS listener is not active")?;
    let connect_addr = commerce
        .loopback_connect_addr()
        .context("Missing loopback listener address")?;
    let port = connect_addr.port();

    // Ensure at least one executable bundle exists so MRTR checkout & receipt redemption run on real catalog state.
    let existing_bundles = bundler::bundles(&commerce.db)?;
    let requested_bundle = body
        .get("bundle_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let bundle_id = if let Some(explicit) = requested_bundle {
        ensure!(
            existing_bundles.iter().any(|b| b.bundle_id == explicit),
            "Unknown bundle_id '{explicit}'"
        );
        explicit.to_owned()
    } else if let Some(found) = existing_bundles
        .iter()
        .find(|b| b.items.iter().any(|i| i == "outrider_session_evidence"))
    {
        found.bundle_id.clone()
    } else {
        let starter = Bundle {
            bundle_id: DEFAULT_SORTIE_BUNDLE_ID.to_owned(),
            title: "Observatory Session Evidence".to_owned(),
            items: vec!["outrider_session_evidence".to_owned()],
            rules: json!({}),
        };
        bundler::put_bundle(&commerce.db, &starter, actor)?;
        starter.bundle_id
    };

    let client_name = body
        .get("client_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Outrider Loopback Sortie Agent")
        .to_owned();

    // Build a real TLS reqwest13 client trusting Outrider's local CA so `serve_socket` captures
    // raw TLS ClientHello JA4, negotiated TLS cipher suite, and wire HTTP header order.
    let ca_cert = reqwest13::Certificate::from_pem(listener.ca_cert_pem.as_bytes())
        .context("Failed to parse gateway CA certificate PEM")?;
    let tls_http_client = reqwest13::Client::builder()
        .add_root_certificate(ca_cert)
        .http1_only()
        .no_proxy()
        .resolve("localhost", connect_addr)
        .timeout(Duration::from_secs(30))
        .build()
        .context("Failed to construct TLS loopback client")?;

    let raw_session_secret = uuid::Uuid::new_v4().to_string();
    let derived_subject = public_session_id(&raw_session_secret);

    let tls_mcp_uri = format!("https://localhost:{port}/mcp");
    let mut transport_cfg = StreamableHttpClientTransportConfig::with_uri(tls_mcp_uri.clone());
    transport_cfg.custom_headers.insert(
        "outrider-session-id".parse()?,
        raw_session_secret.parse()?,
    );

    let client = SortieClient {
        commerce: commerce.clone(),
        client_name: client_name.clone(),
    }
    .serve_with_lifecycle(
        StreamableHttpClientTransport::with_client(tls_http_client, transport_cfg),
        ClientLifecycleMode::Discover {
            preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        },
    )
    .await
    .context("TLS MCP 2026-07-28 loopback handshake failed")?;

    // 1. Discover catalog & passive fingerprint over the TLS MCP session.
    let _catalog_resp = client
        .call_tool(CallToolRequestParams::new("outrider_catalog"))
        .await
        .context("outrider_catalog call failed")?;
    let fp_resp = client
        .call_tool(CallToolRequestParams::new("outrider_fingerprint_me"))
        .await
        .context("outrider_fingerprint_me call failed")?;
    let fp_text = fp_resp
        .content
        .first()
        .and_then(|c| c.as_text())
        .map(|t| t.text.clone())
        .unwrap_or_else(|| "{}".to_owned());
    let fp_json: Value = serde_json::from_str(&fp_text).unwrap_or_else(|_| json!({}));

    // 2. If CLEF model is Ready and probe_policy != Off, run a real active sampling probe.
    let probe_ran = if matches!(commerce.clef.status(), EngineStatus::Ready { .. })
        && *commerce.probe_policy.read().unwrap() != crate::fingerprint::active::ProbePolicy::Off
    {
        client
            .call_tool(CallToolRequestParams::new("outrider_run_probe"))
            .await
            .is_ok()
    } else {
        false
    };

    // 3. Call the bundled tool without a receipt to trigger a real MRTR `input_required` quote.
    let mut checkout_args = serde_json::Map::new();
    checkout_args.insert("bundle_id".into(), Value::String(bundle_id.clone()));
    checkout_args.insert("execute".into(), Value::Bool(true));
    let mut initial_call = CallToolRequestParams::new("outrider_checkout_bundle");
    initial_call.arguments = Some(checkout_args.clone());

    let request_state = match client.call_tool_once(initial_call).await? {
        CallToolResponse::InputRequired(req) => {
            req.request_state.context("MRTR quote missing requestState")?
        }
        other => bail!("Expected MRTR InputRequired quote, received {other:?}"),
    };

    // 4. Issue a real Ed25519 capability receipt bound to this session's subject and bundle.
    let signed_receipt = commerce.receipts.issue(
        &derived_subject,
        &bundle_id,
        5,
        now() + 3600,
        actor,
    )?;
    commerce.receipts.verify_signature(&signed_receipt)?;
    let receipt_token = signed_receipt.encode()?;

    // 5. Retry `outrider_checkout_bundle` presenting the signed Ed25519 receipt in `input_responses`.
    let mut redeem_call = CallToolRequestParams::new("outrider_checkout_bundle");
    redeem_call.arguments = Some(checkout_args);
    redeem_call.request_state = Some(request_state);
    redeem_call.input_responses = Some(
        [(
            "capability_receipt".to_owned(),
            serde_json::to_value(
                ElicitResult::new(ElicitationAction::Accept)
                    .with_content(json!({"receipt": receipt_token})),
            )?,
        )]
        .into(),
    );
    let redeemed = match client.call_tool_once(redeem_call).await? {
        CallToolResponse::Complete(res) => res,
        other => bail!("Expected completed tool execution after receipt presentation, got {other:?}"),
    };

    let _ = client.cancel().await;

    // 6. Send one real HTTP proxy request through Outrider's proxy port so `proxy_traffic` is also populated.
    let proxy_url = format!("http://{connect_addr}");
    let target_status_url = format!("http://{connect_addr}/__proxyfor__/commerce/status");
    let proxy_recorded = if let Ok(proxy) = reqwest::Proxy::http(&proxy_url)
        && let Ok(proxy_client) = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(5))
            .build()
    {
        proxy_client
            .get(&target_status_url)
            .header("user-agent", "Outrider-Sortie-Agent/1.0")
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    } else {
        false
    };
    if proxy_recorded {
        // Yield briefly so the async `traffic_done_rx` persistence task commits `proxy_traffic`.
        tokio::time::sleep(Duration::from_millis(40)).await;
    }

    let redeemed_text = redeemed
        .content
        .first()
        .and_then(|c| c.as_text())
        .map(|t| t.text.clone())
        .unwrap_or_default();

    let summary = json!({
        "session_id": derived_subject,
        "subject": derived_subject,
        "bundle_id": bundle_id,
        "receipt_id": signed_receipt.receipt.receipt_id,
        "tls_mcp_uri": tls_mcp_uri,
        "probe_ran": probe_ran,
        "proxy_traffic_recorded": proxy_recorded,
        "fingerprint_observations": fp_json["observations"],
        "redeemed_output": serde_json::from_str::<Value>(&redeemed_text).unwrap_or(Value::String(redeemed_text)),
    });
    commerce.db.admin_audit(
        actor,
        "onboarding.run_sortie",
        &derived_subject,
        &summary,
    )?;
    Ok(summary)
}
