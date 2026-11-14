use super::{Commerce, http::mutate};
use anyhow::{Context, Result, ensure};
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Frame, Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};
use serde_json::{Value, json};
use std::sync::Arc;

pub struct Workbench {
    pub commerce: Arc<Commerce>,
    pub snapshot: Value,
    pub session: Option<String>,
    pub receipt: Option<String>,
    pub tab: usize,
    pub status: String,
    pub input: Option<(char, String)>,
    pub authorized: bool,
}
impl Workbench {
    pub fn new(commerce: Arc<Commerce>, authorized: bool) -> Result<Self> {
        let mut ui=Self{commerce,snapshot:Value::Null,session:None,receipt:None,tab:0,status:"p probe · e CLEF · s synthesize · i issue · r revoke · u upstream · Tab view · ↑↓ session · [ ] receipt · q quit".into(),input:None,authorized};
        ui.refresh()?;
        Ok(ui)
    }
    pub fn refresh(&mut self) -> Result<()> {
        self.snapshot = self.commerce.snapshot()?;
        if self.session.is_none() {
            self.session = self
                .rows("agent_sessions")
                .first()
                .and_then(|r| r["session_id"].as_str())
                .map(str::to_owned);
        }
        if self.receipt.is_none() {
            self.receipt = self
                .rows("capability_receipts")
                .first()
                .and_then(|r| r["receipt_id"].as_str())
                .map(str::to_owned);
        }
        Ok(())
    }
    fn rows(&self, name: &str) -> &[Value] {
        self.snapshot[name]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn selected_session(&self) -> Option<&Value> {
        self.rows("agent_sessions")
            .iter()
            .find(|r| Some(r["session_id"].as_str().unwrap_or("")) == self.session.as_deref())
    }
    pub fn reason(&self, action: char) -> Option<String> {
        if !self.authorized {
            return Some("Admin token required".into());
        }
        if action == 'u' {
            return None;
        }
        if action == 'r' {
            return match self
                .rows("capability_receipts")
                .iter()
                .find(|r| r["receipt_id"].as_str() == self.receipt.as_deref())
            {
                None => Some("Select a receipt".into()),
                Some(r) if r["revoked"] == 1 => Some("Receipt already revoked".into()),
                _ => None,
            };
        }
        let Some(session) = self.selected_session() else {
            return Some("Select a session".into());
        };
        if action == 'e' && self.snapshot["clef"]["status"] != "Ready" {
            return Some(format!(
                "CLEF {}",
                self.snapshot["clef"]["status"]
                    .as_str()
                    .unwrap_or("Unconfigured")
            ));
        }
        if ['i', 's'].contains(&action) && self.rows("bundles").is_empty() {
            return Some("Configure at least one bundle".into());
        }
        if action == 'p' {
            if self.snapshot["probe_policy"] == "off" {
                return Some("Probes disabled by operator".into());
            }
            if session["client_config"]["protocolVersion"] == "2026-07-28" {
                return Some(
                    "MCP 2026: agent must call outrider_run_probe for the input-required exchange"
                        .into(),
                );
            }
            if !self.rows("active_peers").iter().any(|p| {
                p["session_id"] == session["session_id"]
                    && p["connected"] == true
                    && p["sampling"] == true
            }) {
                return Some("No connected sampling-capable client".into());
            }
        }
        None
    }
    async fn action(&mut self, action: char, text: Option<String>) -> Result<()> {
        if let Some(reason) = self.reason(action) {
            anyhow::bail!(reason)
        }
        let session = self.session.clone().unwrap_or_default();
        let (path, body) = match action {
            'p' => ("/probe", json!({"session_id":session})),
            'e' => (
                "/evaluate",
                json!({"session_id":session,"question":{"type":"noul","question":"Does the recorded session contain a completed, structurally compliant capability probe?"}}),
            ),
            's' => ("/offers/synthesize", json!({"session_id":session})),
            'r' => ("/receipts/revoke", json!({"receipt_id":self.receipt})),
            'i' => {
                let text = text.context("Enter bundle_id max_calls expires_at_unix")?;
                let v: Vec<_> = text.split_whitespace().collect();
                ensure!(v.len() == 3, "Expected bundle_id max_calls expires_at_unix");
                (
                    "/receipts/issue",
                    json!({"subject":self.selected_session().unwrap()["subject"],"bundle_id":v[0],"max_calls":v[1].parse::<i64>()?,"expires_at_unix":v[2].parse::<i64>()?}),
                )
            }
            'u' => {
                let text = text.context("Enter upstream_name command_or_url")?;
                let (name, endpoint) = text
                    .split_once(' ')
                    .context("Expected upstream_name command_or_url")?;
                (
                    "/upstreams/connect",
                    json!({"name":name,"endpoint":endpoint}),
                )
            }
            _ => anyhow::bail!("Unknown action"),
        };
        let result = mutate(&self.commerce, path, body, "admin:tui").await?;
        if action == 'i' {
            self.receipt = result["signed_receipt"]["receipt"]["receipt_id"]
                .as_str()
                .map(str::to_owned);
            self.tab = 2;
        }
        self.commerce.changed(path, self.session.as_deref());
        self.refresh()?;
        self.status = format!("Persisted backend result: {path}");
        Ok(())
    }
    pub async fn key(&mut self, key: KeyEvent) -> bool {
        if key.kind != KeyEventKind::Press {
            return true;
        }
        if let Some((action, mut input)) = self.input.take() {
            match key.code {
                KeyCode::Esc => return true,
                KeyCode::Enter => {
                    if let Err(e) = self.action(action, Some(input)).await {
                        self.status = format!("Error: {e:#}");
                    }
                    return true;
                }
                KeyCode::Backspace => {
                    input.pop();
                }
                KeyCode::Char(c) => input.push(c),
                _ => {}
            }
            self.input = Some((action, input));
            return true;
        }
        match key.code {
            KeyCode::Char('q') => return false,
            KeyCode::Tab => self.tab = (self.tab + 1) % 3,
            KeyCode::Up | KeyCode::Down => {
                let ids = self
                    .rows("agent_sessions")
                    .iter()
                    .filter_map(|r| r["session_id"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>();
                if !ids.is_empty() {
                    let i = ids
                        .iter()
                        .position(|s| Some(s) == self.session.as_ref())
                        .unwrap_or(0);
                    let next = if key.code == KeyCode::Down {
                        (i + 1) % ids.len()
                    } else {
                        (i + ids.len() - 1) % ids.len()
                    };
                    self.session = Some(ids[next].clone());
                }
            }
            KeyCode::Char('[') | KeyCode::Char(']') => {
                let ids = self
                    .rows("capability_receipts")
                    .iter()
                    .filter_map(|r| r["receipt_id"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>();
                if !ids.is_empty() {
                    let i = ids
                        .iter()
                        .position(|s| Some(s) == self.receipt.as_ref())
                        .unwrap_or(0);
                    self.receipt = Some(ids[(i + 1) % ids.len()].clone());
                }
            }
            KeyCode::Char(action) if ['p', 'e', 's', 'i', 'r', 'u'].contains(&action) => {
                if let Some(reason) = self.reason(action) {
                    self.status = format!("Unavailable: {reason}")
                } else if ['i', 'u'].contains(&action) {
                    self.input = Some((action, String::new()));
                } else if let Err(e) = self.action(action, None).await {
                    self.status = format!("Error: {e:#}");
                }
            }
            _ => {}
        }
        true
    }
    pub fn render(&self, frame: &mut Frame) {
        let vertical = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(2),
                Constraint::Min(8),
                Constraint::Length(2),
            ])
            .split(frame.area());
        frame.render_widget(
            Paragraph::new(" OUTRIDER / COMMERCE & EVIDENCE WORKBENCH")
                .style(Style::default().fg(Color::LightGreen)),
            vertical[0],
        );
        let actions = ['p', 'e', 's', 'i', 'r', 'u']
            .into_iter()
            .map(|c| {
                Span::styled(
                    format!(
                        " [{c}] {} ",
                        match c {
                            'p' => "Probe",
                            'e' => "CLEF",
                            's' => "Synthesize",
                            'i' => "Issue",
                            'r' => "Revoke",
                            _ => "Upstream",
                        }
                    ),
                    Style::default().fg(if self.reason(c).is_some() {
                        Color::DarkGray
                    } else {
                        Color::LightGreen
                    }),
                )
            })
            .collect::<Vec<_>>();
        frame.render_widget(Paragraph::new(Line::from(actions)), vertical[1]);
        let panes = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(24),
                Constraint::Percentage(49),
                Constraint::Percentage(27),
            ])
            .split(vertical[2]);
        let mut left = Vec::new();
        for s in self.rows("agent_sessions") {
            left.push(Line::from(format!(
                "{} {}",
                if s["session_id"].as_str() == self.session.as_deref() {
                    ">"
                } else {
                    " "
                },
                s["client_config"]["clientInfo"]["name"]
                    .as_str()
                    .unwrap_or("Unreported client")
            )));
            left.push(Line::from(format!(
                "  {} · {}",
                s["session_id"].as_str().unwrap_or(""),
                s["state"].as_str().unwrap_or("")
            )));
        }
        left.push(Line::from(""));
        left.push(Line::from("SESSION OFFERS"));
        for o in self
            .rows("session_offers")
            .iter()
            .filter(|o| o["session_id"].as_str() == self.session.as_deref())
        {
            left.push(Line::from(format!(
                "{} · {}",
                o["bundle_id"].as_str().unwrap_or(""),
                o["source"].as_str().unwrap_or("")
            )))
        }
        frame.render_widget(
            Paragraph::new(left)
                .block(
                    Block::default()
                        .title(" AGENT SESSIONS ")
                        .borders(Borders::ALL),
                )
                .wrap(Wrap { trim: false }),
            panes[0],
        );
        let (title, table) = match self.tab {
            0 => (" HTTP / WS PROXY TRAFFIC ", "proxy_traffic"),
            1 => (" MCP / MRTR FRAMES ", "mcp_frames"),
            _ => (" ED25519 RECEIPTS & REDEMPTIONS ", "capability_receipts"),
        };
        let lines = self
            .rows(table)
            .iter()
            .take(200)
            .map(|r| match self.tab {
                0 => format!(
                    "[T-{}] {} {} · {}",
                    r["id"], r["head"]["method"], r["head"]["uri"], r["head"]["status"]
                ),
                1 => format!("[M-{}] {} {}", r["frame_id"], r["direction"], r["method"]),
                _ => format!(
                    "{} {} · quota {} · revoked {}",
                    if r["receipt_id"].as_str() == self.receipt.as_deref() {
                        ">"
                    } else {
                        " "
                    },
                    r["receipt_id"],
                    r["remaining_calls"],
                    r["revoked"]
                ),
            })
            .collect::<Vec<_>>();
        let mut center = lines.join("\n");
        if self.tab == 2 {
            center.push_str("\n\nREDEMPTIONS\n");
            for r in self.rows("receipt_redemptions") {
                center.push_str(&format!("{} {}\n", r["receipt_id"], r["tool_name"]));
            }
        }
        if center.is_empty() {
            center = "No persisted records.".into()
        };
        frame.render_widget(
            Paragraph::new(center)
                .block(Block::default().title(title).borders(Borders::ALL))
                .wrap(Wrap { trim: false }),
            panes[1],
        );
        let evaluations = self
            .rows("clef_evaluations")
            .iter()
            .find(|e| e["session_id"].as_str() == self.session.as_deref());
        let observations = self
            .rows("fingerprint_observations")
            .iter()
            .filter(|e| e["session_id"].as_str() == self.session.as_deref())
            .collect::<Vec<_>>();
        let receipt = self
            .rows("capability_receipts")
            .iter()
            .find(|r| r["receipt_id"].as_str() == self.receipt.as_deref());
        let mut inspector = format!(
            "CLEF {}\n{}\n\nHANDSHAKE EVIDENCE\n{}\n\nRECEIPT\n{}",
            self.snapshot["clef"]["status"]
                .as_str()
                .unwrap_or("Unconfigured"),
            serde_json::to_string_pretty(&evaluations).unwrap_or_default(),
            serde_json::to_string_pretty(&observations).unwrap_or_default(),
            serde_json::to_string_pretty(&receipt).unwrap_or_default()
        );
        for action in ['p', 'e', 's', 'i', 'r', 'u'] {
            if let Some(reason) = self.reason(action) {
                inspector.push_str(&format!("\n[{action}] {reason}"));
            }
        }
        frame.render_widget(
            Paragraph::new(inspector)
                .block(
                    Block::default()
                        .title(" EVIDENCE INSPECTOR ")
                        .borders(Borders::ALL),
                )
                .wrap(Wrap { trim: false }),
            panes[2],
        );
        let status = if let Some((action, input)) = &self.input {
            format!(
                "{} > {}",
                if *action == 'i' {
                    "bundle_id max_calls expires_at_unix"
                } else {
                    "upstream_name command_or_url"
                },
                input
            )
        } else {
            self.status.clone()
        };
        frame.render_widget(
            Paragraph::new(status).wrap(Wrap { trim: false }),
            vertical[3],
        );
    }
}
pub async fn run(commerce: Arc<Commerce>) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout))?;
    let result = async {
        let mut ui = Workbench::new(commerce, true)?;
        loop {
            ui.refresh()?;
            terminal.draw(|f| ui.render(f))?;
            if event::poll(std::time::Duration::from_millis(100))? {
                if let Event::Key(key) = event::read()? {
                    if !ui.key(key).await {
                        break;
                    }
                }
            }
            tokio::task::yield_now().await;
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}
