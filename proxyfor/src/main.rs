#[macro_use]
extern crate log;

use proxyfor::{
    cert::{CertificateAuthority, init_ca},
    filter::parse_title_filters,
    server::{PrintMode, ServerBuilder, WEB_PREFIX},
    tui,
};

use anyhow::{Context, Result, anyhow};
use clap::Parser;
use simplelog::{ConfigBuilder, LevelFilter, WriteLogger, format_description};
use std::{
    fs,
    io::{self, IsTerminal},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
};
use tokio::net::TcpListener;

const CA_CERT_FILENAME: &str = "proxyfor-ca-cert.cer";
const PRIVATE_KEY_FILENAME: &str = "proxyfor-key.pem";

#[tokio::main]
async fn main() -> Result<()> {
    let raw_args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let explicit_listen = raw_args.iter().skip(1).any(|arg| {
        let s = arg.to_string_lossy();
        s == "-l" || s == "--listen" || s.starts_with("-l=") || s.starts_with("--listen=")
    });
    let cli = Cli::parse_from(&raw_args);
    let desktop_mode = should_enter_desktop_mode(raw_args.len(), &cli);
    let web_enabled = cli.web || desktop_mode;

    let config_dir = cli
        .config_dir
        .clone()
        .map(Ok)
        .unwrap_or_else(ensure_config_dir)?;
    fs::create_dir_all(&config_dir)?;
    setup_logger(&config_dir)?;
    tokio_rustls::rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");
    let fetched_model = proxyfor::clef::fetch::default_model_path(&config_dir);
    let clef_model = cli
        .clef_model
        .clone()
        .or_else(|| fetched_model.is_file().then(|| fetched_model.clone()));
    if clef_model.is_none() {
        proxyfor::clef::fetch::spawn_background_fetch(fetched_model);
    }
    let _clef = proxyfor::clef::engine::ClefEngine::load(proxyfor::clef::engine::ClefConfig {
        model: clef_model,
        backend: cli.clef_backend.clone(),
        threads: cli.clef_threads,
        cache_dir: cli
            .clef_cache_dir
            .clone()
            .unwrap_or_else(|| config_dir.join("clef-cache")),
        workers: 2,
    })
    .await?;
    eprintln!("CLEF: {}", serde_json::to_string(_clef.status())?);
    let _db = proxyfor::commerce::db::Database::open(
        cli.db
            .clone()
            .unwrap_or_else(|| config_dir.join("outrider.db")),
    )?;
    let (commerce, new_token) =
        proxyfor::commerce::Commerce::new(_db, _clef, &config_dir, cli.admin_allow_remote)?;
    commerce.register_local_tools()?;
    *commerce.probe_policy.write().unwrap() = cli.probe_policy;
    if let Some(token) = new_token {
        eprintln!("Outrider admin token (shown once): {token}");
    }
    if let Some(Command::Receipt { command }) = cli.command {
        match command {
            ReceiptCommand::Issue {
                subject,
                bundle_id,
                max_calls,
                expires_at_unix,
            } => {
                let receipt = commerce.receipts.issue(
                    &subject,
                    &bundle_id,
                    max_calls,
                    expires_at_unix,
                    "admin:cli",
                )?;
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"token":receipt.encode()?,"signed_receipt":receipt})
                    )?
                );
            }
            ReceiptCommand::Revoke { receipt_id } => {
                commerce.receipts.revoke(&receipt_id, "admin:cli")?;
                println!("Receipt revoked");
            }
        }
        return Ok(());
    }
    if let Some(path) = cli.skills_dir {
        commerce.load_skills(&path, "admin:cli")?;
    }
    let mut configured_upstreams = std::collections::BTreeMap::new();
    for row in commerce.db.rows("upstream_servers")?.as_array().unwrap() {
        configured_upstreams.insert(
            row["name"].as_str().unwrap().to_owned(),
            row["endpoint"].as_str().unwrap().to_owned(),
        );
    }
    for upstream in &cli.upstream {
        let (name, endpoint) = upstream
            .split_once('=')
            .context("--upstream expects name=command_or_url")?;
        configured_upstreams.insert(name.to_owned(), endpoint.to_owned());
    }
    for (name, endpoint) in configured_upstreams {
        if let Err(error) = commerce
            .federation
            .connect(&commerce, &name, &endpoint, "admin:startup")
            .await
        {
            eprintln!("Upstream {name} failed: {error:#}");
        }
    }
    if cli.stdio {
        use rmcp::ServiceExt;
        proxyfor::mcp_gateway::handler::CommerceGateway::new(commerce)
            .serve(rmcp::transport::stdio())
            .await?
            .waiting()
            .await?;
        return Ok(());
    }
    let ca = setup_ca(&config_dir)?;
    let (requested_ip, requested_port) =
        parse_addr(&cli.listen).ok_or_else(|| anyhow!("Invalid addr '{}'", cli.listen))?;
    let listener = bind_gateway_listener(
        requested_ip,
        requested_port,
        desktop_mode && !explicit_listen,
    )
    .await?;
    let bound_addr = listener.local_addr()?;
    let ip = bound_addr.ip();
    let port = bound_addr.port();
    let addr = bound_addr.to_string();

    let reverse_proxy_url = cli.reverse_proxy_url.map(sanitize_reverse_proxy_url);
    let title_filters = parse_title_filters(&cli.filters)?;
    let mime_filters: Vec<String> = cli.mime_filters.iter().map(|v| v.to_lowercase()).collect();
    let is_tui = io::stdout().is_terminal() && (cli.tui || (!cli.dump && !web_enabled));
    let is_dump = cli.dump || (!is_tui && !web_enabled);
    let print_mode = if is_tui {
        PrintMode::Nothing
    } else if is_dump {
        PrintMode::Markdown
    } else {
        PrintMode::Oneline
    };
    let desktop_bootstrap_nonce = if desktop_mode && !cli.no_open {
        Some(commerce.auth.mint_bootstrap_nonce())
    } else {
        None
    };

    let server = ServerBuilder::new(ca)
        .commerce(commerce.clone())
        .reverse_proxy_url(reverse_proxy_url)
        .title_filters(title_filters)
        .mime_filters(mime_filters)
        .web(web_enabled)
        .print_mode(print_mode)
        .build();
    let state = server.state();
    let stop_server = server.run(listener).await?;
    if proxyfor::first_run_demo::should_run_first_run_demo(
        cli.demo,
        cli.no_demo,
        cli.no_open,
        cli.headless,
        cli.stdio,
        cli.tui || is_tui,
        cli.dump || is_dump,
        &commerce.db,
    )? {
        proxyfor::first_run_demo::spawn_first_run_demo(bound_addr, commerce.clone());
    }
    info!("HTTP(S) proxy listening at {addr}");
    if is_tui {
        let addr = addr.clone();
        tui::run(state, &addr).await.context("Failed to run TUI")?;
    } else {
        eprintln!("HTTP(S) proxy listening at {addr}");
        let browser_host = if ip.is_loopback() || ip.is_unspecified() {
            "localhost".to_owned()
        } else if let IpAddr::V6(v6) = ip {
            format!("[{v6}]")
        } else {
            ip.to_string()
        };
        if web_enabled {
            eprintln!("Web interface accessible at http://{browser_host}:{port}{WEB_PREFIX}/");
        }
        if let Some(nonce) = desktop_bootstrap_nonce {
            let entry_route = format!("{WEB_PREFIX}/");
            let launch_url = format!("http://{browser_host}:{port}{entry_route}#bootstrap={nonce}");
            if let Err(err) = open_browser_url(&launch_url) {
                warn!("Failed to launch default browser ({launch_url}): {err:#}");
            } else {
                info!("Opened default desktop browser to {entry_route}");
            }
        }
        shutdown_signal().await;
    }
    let _ = stop_server.send(());
    Ok(())
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[arg(long)]
    skills_dir: Option<PathBuf>,
    #[arg(long)]
    upstream: Vec<String>,
    #[arg(long)]
    stdio: bool,
    #[command(subcommand)]
    command: Option<Command>,
    #[arg(long)]
    config_dir: Option<PathBuf>,
    #[arg(long)]
    admin_allow_remote: bool,
    #[arg(long, value_enum, default_value = "auto")]
    probe_policy: proxyfor::fingerprint::active::ProbePolicy,
    /// Real CLEF model (.litertlm). If omitted, uses <config>/models/clef-flash.litertlm when present,
    /// otherwise fetches it in the background (best-effort) and CLEF stays Unconfigured this run
    #[arg(long, env = "OUTRIDER_CLEF_MODEL")]
    clef_model: Option<PathBuf>,
    #[arg(long, default_value="cpu", value_parser=["cpu","gpu"])]
    clef_backend: String,
    #[arg(long, default_value_t = 4)]
    clef_threads: usize,
    #[arg(long)]
    clef_cache_dir: Option<PathBuf>,
    #[arg(long)]
    db: Option<PathBuf>,
    /// Listening ip and port address
    #[clap(
        short = 'l',
        long,
        value_name = "ADDR",
        default_value = "127.0.0.1:8080"
    )]
    listen: String,
    /// Only inspect http(s) traffic whose `{method} {uri}` matches the regex
    #[clap(short = 'f', long, value_name = "REGEX")]
    filters: Vec<String>,
    /// Only inspect http(s) traffic whose content-type matches the value
    #[clap(short = 'm', long, value_name = "VALUE")]
    mime_filters: Vec<String>,
    /// Enable user-friendly web interface
    #[clap(short = 'W', long)]
    web: bool,
    /// Force server/headless mode (never auto-open browser or auto-fallback ports)
    #[clap(long, alias = "server")]
    headless: bool,
    /// Force desktop interactive mode (auto-enable web UI, port fallback, and browser launch)
    #[clap(long)]
    desktop: bool,
    /// Suppress launching the default OS browser in desktop mode
    #[clap(long)]
    no_open: bool,
    /// Run a live loopback first-run demo sequence once the gateway listener binds
    #[clap(long)]
    demo: bool,
    /// Disable automatic first-run loopback demo on initial launch
    #[clap(long)]
    no_demo: bool,
    /// Eenter TUI
    #[clap(short = 'T', long)]
    tui: bool,
    /// Dump all traffics
    #[clap(short = 'D', long)]
    dump: bool,
    /// Reverse proxy url
    #[clap(value_name = "URL")]
    reverse_proxy_url: Option<String>,
}

fn env_truthy(name: &str) -> bool {
    std::env::var(name).is_ok_and(|val| {
        let trimmed = val.trim();
        !trimmed.is_empty() && trimmed != "0" && !trimmed.eq_ignore_ascii_case("false")
    })
}

fn should_enter_desktop_mode(raw_args_len: usize, cli: &Cli) -> bool {
    if cli.headless || cli.stdio || cli.dump || cli.tui || cli.command.is_some() {
        return false;
    }
    if cli.desktop {
        return true;
    }
    if raw_args_len > 1 {
        return false;
    }
    if env_truthy("CI")
        || env_truthy("OUTRIDER_HEADLESS")
        || std::env::var_os("SSH_CONNECTION").is_some()
        || std::env::var_os("SSH_TTY").is_some()
    {
        return false;
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return false;
    }
    #[cfg(target_os = "windows")]
    if std::env::var("SESSIONNAME").is_ok_and(|s| s.eq_ignore_ascii_case("Services")) {
        return false;
    }
    true
}

async fn bind_gateway_listener(
    ip: IpAddr,
    preferred_port: u16,
    allow_fallback: bool,
) -> Result<TcpListener> {
    match TcpListener::bind(SocketAddr::new(ip, preferred_port)).await {
        Ok(listener) => Ok(listener),
        Err(primary_err) if allow_fallback && preferred_port != 0 => {
            for candidate in (preferred_port.saturating_add(1))..=preferred_port.saturating_add(19)
            {
                if let Ok(listener) = TcpListener::bind(SocketAddr::new(ip, candidate)).await {
                    eprintln!(
                        "Port {preferred_port} in use ({primary_err}); bound desktop listener to {ip}:{candidate}"
                    );
                    return Ok(listener);
                }
            }
            let listener = TcpListener::bind(SocketAddr::new(ip, 0)).await?;
            let actual = listener.local_addr()?.port();
            eprintln!(
                "Port {preferred_port} in use ({primary_err}); bound desktop listener to {ip}:{actual}"
            );
            Ok(listener)
        }
        Err(err) => Err(err.into()),
    }
}

fn open_browser_url(url: &str) -> Result<()> {
    if let Some(custom_opener) = std::env::var_os("OUTRIDER_BROWSER_OPENER") {
        std::process::Command::new(custom_opener)
            .arg(url)
            .spawn()
            .context("Failed to execute OUTRIDER_BROWSER_OPENER")?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .context("Failed to spawn macOS `open`")?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .context("Failed to launch default Windows browser via rundll32")?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .context("Failed to spawn `xdg-open`")?;
        Ok(())
    }
}

fn setup_ca(config_dir: &Path) -> Result<CertificateAuthority> {
    let ca_cert_file = config_dir.join(CA_CERT_FILENAME);
    let private_key_file = config_dir.join(PRIVATE_KEY_FILENAME);
    let ca = init_ca(&ca_cert_file, &private_key_file)?;
    Ok(ca)
}

fn setup_logger(config_dir: &Path) -> Result<()> {
    let log_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    let crate_name = env!("CARGO_CRATE_NAME");
    let config = ConfigBuilder::new()
        .add_filter_allow(crate_name.to_string())
        .set_time_format_custom(format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .set_thread_level(LevelFilter::Off)
        .build();
    let log_path = config_dir.join(format!("{crate_name}.log"));
    let log_file = fs::File::create(log_path)?;
    WriteLogger::init(log_level, config, log_file)?;
    Ok(())
}

fn ensure_config_dir() -> Result<PathBuf> {
    let mut config_dir = dirs::home_dir().ok_or_else(|| anyhow!("No home dir"))?;
    config_dir.push(".proxyfor");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|err| {
            anyhow!(
                "Failed to create config dir '{}', {err}",
                config_dir.display()
            )
        })?;
    }
    Ok(config_dir)
}

fn parse_addr(value: &str) -> Option<(IpAddr, u16)> {
    if let Ok(port) = value.parse() {
        Some(("0.0.0.0".parse().unwrap(), port))
    } else if let Ok(ip) = value.parse() {
        Some((ip, 8080))
    } else if let Some((ip, port)) = value.rsplit_once(':') {
        if let (Some(ip), Some(port)) = (ip.parse().ok(), port.parse().ok()) {
            Some((ip, port))
        } else {
            None
        }
    } else {
        None
    }
}

fn sanitize_reverse_proxy_url(url: String) -> String {
    let url = if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("http://{}", url)
    } else {
        url
    };
    if let Some(url) = url.strip_suffix('/') {
        url.to_string()
    } else {
        url
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler")
}

#[derive(clap::Subcommand, Debug)]
enum Command {
    Receipt {
        #[command(subcommand)]
        command: ReceiptCommand,
    },
}
#[derive(clap::Subcommand, Debug)]
enum ReceiptCommand {
    Issue {
        #[arg(long)]
        subject: String,
        #[arg(long)]
        bundle_id: String,
        #[arg(long)]
        max_calls: i64,
        #[arg(long)]
        expires_at_unix: i64,
    },
    Revoke {
        #[arg(long)]
        receipt_id: String,
    },
}
