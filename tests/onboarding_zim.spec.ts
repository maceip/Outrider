import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const outriderBin = path.join(root, "target/debug/outrider");

async function poll<T>(fn: () => Promise<T>, ready: (v: T) => boolean) {
  let last: unknown;
  for (let i = 0; i < 200; i++) {
    try {
      const value = await fn();
      if (ready(value)) return value;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for condition: " + String(last));
}

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

function query(dbPath: string, sql: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

function attachPageGuards(page: Page) {
  const errors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("401")) {
      errors.push(m.text());
    }
  });
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    if (!err.includes("ERR_ABORTED") && !err.includes("NS_BINDING_ABORTED")) {
      errors.push(r.url() + ": " + err);
    }
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.status() !== 401) {
      unexpectedResponses.push(r.url() + " " + r.status());
    }
  });
  return { errors, unexpectedResponses };
}

test("Desktop #bootstrap auto-unlock, Panel 1 First-Run Card, Claude/Codex scanner with restart consent, and 1-Click TLS Sortie", async ({
  page,
  request,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "outrider-onboarding-e2e-"));
  const p = await freePort();
  const baseUrl = `http://127.0.0.1:${p}`;
  const dbPath = path.join(dir, "outrider.db");
  const openedUrlFile = path.join(dir, "opened-url.txt");
  const openerScript = path.join(dir, "record-open.sh");
  const restartRecorder = path.join(dir, "restarts.jsonl");
  const scanRoot = path.join(dir, "agent-scan");

  await writeFile(
    openerScript,
    `#!/bin/sh\nprintf '%s' "$1" > "${openedUrlFile}"\n`,
    "utf8",
  );
  await chmod(openerScript, 0o755);

  // Populate isolated Claude Desktop & Codex installations; leave Claude Code absent
  const claudeDir = path.join(scanRoot, "claude_desktop");
  const codexDir = path.join(scanRoot, "home", ".codex");
  await mkdir(claudeDir, { recursive: true });
  await mkdir(codexDir, { recursive: true });

  const claudeCfgPath = path.join(claudeDir, "claude_desktop_config.json");
  const codexCfgPath = path.join(codexDir, "config.toml");

  await writeFile(
    claudeCfgPath,
    JSON.stringify(
      {
        mcpServers: {
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(codexCfgPath, 'model = "gpt-5"\n', "utf8");

  const env = { ...process.env };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;
  env.OUTRIDER_CLEF_NO_FETCH = "1";
  env.OUTRIDER_BROWSER_OPENER = openerScript;
  env.OUTRIDER_AGENT_SCAN_ROOT = scanRoot;
  env.OUTRIDER_AGENT_TEST_RUNNING = "claude-desktop";
  env.OUTRIDER_AGENT_RESTART_RECORDER = restartRecorder;

  const server = spawn(
    outriderBin,
    [
      "--desktop",
      "--listen",
      `127.0.0.1:${p}`,
      "--config-dir",
      dir,
      "--db",
      dbPath,
    ],
    { cwd: root, env, stdio: "ignore" },
  );

  const { errors, unexpectedResponses } = attachPageGuards(page);

  try {
    await poll(
      () => fetch(`${baseUrl}/__proxyfor__/commerce/status`).then((r) => r.status),
      (s) => s === 200,
    );

    const launchedUrl = await poll(
      () => readFile(openedUrlFile, "utf8"),
      (txt) => txt.includes("/__proxyfor__/zim/#bootstrap="),
    );
    const nonceMatch = launchedUrl.match(/#bootstrap=([0-9a-f]{64})$/);
    expect(nonceMatch).not.toBeNull();
    const bootstrapNonce = nonceMatch![1];

    // 1. Navigate to desktop-launched URL -> auto-unlocks into Live and scrubs #bootstrap from URL
    await page.goto(launchedUrl);
    await expect(page.locator("#live")).toHaveText("Live");
    expect(await page.evaluate(() => window.location.hash)).toBe("");

    // Replaying the single-use nonce must fail with 401
    const replayRes = await request.post(
      `${baseUrl}/__proxyfor__/commerce/bootstrap/exchange`,
      { data: { nonce: bootstrapNonce } },
    );
    expect(replayRes.status()).toBe(401);

    // 2. Navigate to Panel 1 Overview -> First-Run Onboarding Card appears when agent_sessions == 0
    await page
      .locator('[data-slot="sidebar"] [data-slot="sidebar-menu-item"]')
      .filter({ hasText: "Overview" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");

    const onboardingCard = page.locator("#first-run-onboarding");
    await expect(onboardingCard).toBeVisible();
    await expect(onboardingCard).toContainText("No Agent Sessions Recorded Yet");

    // 3. Open Connect Local Agents modal & verify detection, deep-links, backup, and restart consent
    await onboardingCard
      .getByRole("button", { name: "Scan Claude & Codex", exact: true })
      .click();

    const dialog = page.locator("#action-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Connect Local Agents");

    const cursorLink = dialog.getByRole("link", { name: "Install in Cursor", exact: true });
    const vscodeLink = dialog.getByRole("link", { name: "Install in VS Code", exact: true });
    await expect(cursorLink).toHaveAttribute(
      "href",
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/,
    );
    await expect(vscodeLink).toHaveAttribute("href", /^vscode:mcp\/install\?/);

    await expect(dialog.locator('[data-agent-id="claude-desktop"]')).toContainText("Detected");
    await expect(dialog.locator('[data-agent-id="claude-desktop"]')).toContainText("Running");
    await expect(dialog.locator('[data-agent-id="claude-code"]')).toContainText("Not Installed");
    await expect(dialog.locator('[data-agent-id="codex"]')).toContainText("Detected");

    // Configure OpenAI Codex (not running -> writes immediately with .bak backup, no restart prompt)
    await dialog
      .getByRole("button", { name: "Add Outrider MCP for OpenAI Codex", exact: true })
      .click();
    await expect(dialog.locator('[data-agent-id="codex"]')).toContainText("Configured");

    const updatedCodex = await readFile(codexCfgPath, "utf8");
    expect(updatedCodex).toContain('model = "gpt-5"');
    expect(updatedCodex).toContain("[mcp_servers.outrider]");
    expect(updatedCodex).toContain(`url = "${baseUrl}/mcp"`);
    const codexFiles = await readdir(codexDir);
    expect(codexFiles.some((f) => f.startsWith("config.toml.bak."))).toBe(true);

    // Configure Claude Desktop (running -> MUST ask explicit restart consent first!)
    await dialog
      .getByRole("button", { name: "Add Outrider MCP for Claude Desktop", exact: true })
      .click();
    const consentBanner = dialog.locator("#restart-consent-banner");
    await expect(consentBanner).toBeVisible();
    await expect(consentBanner).toContainText("Restart Claude Desktop after saving Outrider MCP?");

    // Decline restart ("Save Without Restart") -> config + backup written, zero restarts recorded
    await consentBanner
      .getByRole("button", { name: "Save Without Restart", exact: true })
      .click();
    await expect(consentBanner).toHaveCount(0);
    await expect(dialog.locator('[data-agent-id="claude-desktop"]')).toContainText("Configured");

    const updatedClaude = JSON.parse(await readFile(claudeCfgPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(updatedClaude.mcpServers.filesystem.command).toBe("npx");
    expect(updatedClaude.mcpServers.outrider.args).toContain("--stdio");
    const claudeFiles = await readdir(claudeDir);
    expect(claudeFiles.some((f) => f.startsWith("claude_desktop_config.json.bak."))).toBe(true);
    await expect(stat(restartRecorder)).rejects.toThrow();

    // Now click Update Outrider MCP & explicitly confirm "Save & Restart Agent"
    await dialog
      .getByRole("button", { name: "Update Outrider MCP for Claude Desktop", exact: true })
      .click();
    await expect(consentBanner).toBeVisible();
    await consentBanner
      .getByRole("button", { name: "Save & Restart Agent", exact: true })
      .click();
    await expect(consentBanner).toHaveCount(0);

    const restartLog = await readFile(restartRecorder, "utf8");
    expect(restartLog).toContain('"agent_id":"claude-desktop"');

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    // 4. Launch 1-Click TLS Sortie from Panel 1 -> populates real TLS JA4 + MCP + Receipt rows and hides empty-state card
    await onboardingCard
      .getByRole("button", { name: "Launch 1-Click TLS Sortie", exact: true })
      .click();
    await expect(onboardingCard).toHaveCount(0, { timeout: 20_000 });

    const sessions = query(dbPath, "SELECT session_id, state FROM agent_sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].state).toBe("Entitled");

    const obsKinds = query(dbPath, "SELECT DISTINCT kind FROM fingerprint_observations").map((r) =>
      String(r.kind),
    );
    expect(obsKinds).toEqual(
      expect.arrayContaining([
        "client_hello",
        "negotiated_tls",
        "http_header_order",
        "mcp_request",
      ]),
    );
    expect(query(dbPath, "SELECT COUNT(*) AS n FROM mrtr_quotes")[0].n).toBe(1);
    expect(query(dbPath, "SELECT COUNT(*) AS n FROM capability_receipts")[0].n).toBe(1);
    expect(query(dbPath, "SELECT COUNT(*) AS n FROM receipt_redemptions")[0].n).toBe(1);
    expect(Number(query(dbPath, "SELECT COUNT(*) AS n FROM proxy_traffic")[0].n)).toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  } finally {
    server.kill("SIGINT");
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    server.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});

test("Invader Zim Command Center (/zim) verifies truthful WebMCP detection and 4-step Human-as-Agent MCP 2026-07-28 mission", async ({
  browser,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "outrider-zim-e2e-"));
  const p = await freePort();
  const baseUrl = `http://127.0.0.1:${p}`;
  const dbPath = path.join(dir, "outrider.db");

  const env = { ...process.env };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;
  env.OUTRIDER_CLEF_NO_FETCH = "1";

  const server = spawn(
    outriderBin,
    [
      "--headless",
      "--web",
      "--listen",
      `127.0.0.1:${p}`,
      "--config-dir",
      dir,
      "--db",
      dbPath,
    ],
    { cwd: root, env, stdio: "ignore" },
  );

  try {
    await poll(
      () => fetch(`${baseUrl}/__proxyfor__/commerce/status`).then((r) => r.status),
      (s) => s === 200,
    );
    const adminToken = (await readFile(path.join(dir, "outrider-admin-token"), "utf8")).trim();

    // Part A: Standard Chromium without WebMCP flag -> must NOT fabricate navigator.modelContext
    const plainCtx = await browser.newContext({ viewport: { width: 1500, height: 960 } });
    const plainPage = await plainCtx.newPage();
    const plainGuards = attachPageGuards(plainPage);

    await plainPage.goto(`${baseUrl}/__proxyfor__/zim/`);
    const hasNativeWebMcp = await plainPage.evaluate(() => "modelContext" in navigator);
    if (!hasNativeWebMcp) {
      await expect(plainPage.locator("#webmcp-status-badge")).toHaveText(
        "Chromium (WebMCP Flag Off)",
      );
      await expect(plainPage.locator("#webmcp-disclosure")).toContainText(
        "chrome://flags/#enable-experimental-web-platform-features",
      );
    }
    expect(plainGuards.errors).toEqual([]);
    expect(plainGuards.unexpectedResponses).toEqual([]);
    await plainCtx.close();

    // Part B: Chromium with W3C WebMCP (`navigator.modelContext`) enabled -> registers live Outrider tools + runs 4-step Agent Mission
    const webMcpCtx = await browser.newContext({ viewport: { width: 1500, height: 960 } });
    await webMcpCtx.addInitScript(() => {
      const registry = new Map<string, unknown>();
      (window as unknown as { __webMcpRegistered: string[] }).__webMcpRegistered = [];
      Object.defineProperty(navigator, "modelContext", {
        configurable: true,
        value: {
          registerTool(tool: { name: string }) {
            registry.set(tool.name, tool);
            (window as unknown as { __webMcpRegistered: string[] }).__webMcpRegistered = Array.from(
              registry.keys(),
            );
          },
          unregisterTool(name: string) {
            registry.delete(name);
            (window as unknown as { __webMcpRegistered: string[] }).__webMcpRegistered = Array.from(
              registry.keys(),
            );
          },
        },
      });
    });

    const page = await webMcpCtx.newPage();
    const { errors, unexpectedResponses } = attachPageGuards(page);

    await page.goto(`${baseUrl}/__proxyfor__/zim/`);
    await page.getByLabel("Admin token", { exact: true }).fill(adminToken);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator("#live")).toHaveText("Live");

    await expect(page.locator("#webmcp-status-badge")).toHaveText("WebMCP Active (Chromium)");
    const registeredNames = await page.evaluate(
      () => (window as unknown as { __webMcpRegistered: string[] }).__webMcpRegistered,
    );
    expect(registeredNames).toEqual([
      "outrider_zim_handshake",
      "outrider_zim_probe_agent",
      "outrider_zim_checkout_quote",
      "outrider_zim_run_tls_sortie",
    ]);

    // Step 1: Handshake over TLS 1.3 + MCP 2026-07-28 (`probe_policy` defaults to `auto`, so first call triggers capability_probe MRTR)
    await page.getByRole("button", { name: "1. Handshake as Agent", exact: true }).click();
    await expect(page.locator("#zim-wire-envelope")).toContainText(
      "INPUT REQUIRED · MULTI ROUND-TRIP",
    );
    await expect(page.locator("#zim-wire-envelope")).toContainText("capability_probe");

    // Step 2: Transmit compliant probe reply (`{"ack":"outrider"}` + typed preferences)
    await page.getByRole("button", { name: "Transmit Compliant Reply", exact: true }).click();
    await expect(page.getByTestId("zim-count-probes")).toHaveText("2");

    const completedProbes = query(
      dbPath,
      "SELECT status, structural_compliance FROM probe_runs ORDER BY rowid ASC",
    );
    expect(completedProbes).toHaveLength(2);
    expect(completedProbes[0].status).toBe("Completed");
    expect(completedProbes[0].structural_compliance).toBe(1);
    expect(completedProbes[1].status).toBe("Completed");

    // Step 3: Request Priced Bundle Quote (no receipt -> AEAD-sealed MRTR quote)
    await page.getByRole("button", { name: "3. Request Bundle Quote", exact: true }).click();
    await expect(page.locator("#zim-wire-envelope")).toContainText("capability_receipt");
    await expect(page.getByTestId("zim-count-quotes")).toHaveText("1");

    // Step 4: Mint & Redeem Ed25519 Receipt -> session becomes Entitled & executes `outrider_session_evidence`
    await page.getByRole("button", { name: "4. Mint & Redeem Receipt", exact: true }).click();
    await expect(page.getByTestId("zim-count-redemptions")).toHaveText("1");
    await expect(page.locator("#zim-mission-deck")).toContainText("Entitled");

    const sessionRow = query(dbPath, "SELECT state FROM agent_sessions")[0];
    expect(sessionRow.state).toBe("Entitled");

    // Verify draggable split-pane divider + zero horizontal overflow
    const telemetryPane = page.locator("#zim-live-telemetry");
    const beforeBox = (await telemetryPane.boundingBox())!;
    const divider = page.getByRole("separator", {
      name: "Resize command center telemetry pane",
    });
    const divBox = (await divider.boundingBox())!;
    await page.mouse.move(divBox.x + 2, divBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(divBox.x - 60, divBox.y + 80);
    await page.mouse.up();
    const afterBox = (await telemetryPane.boundingBox())!;
    expect(afterBox.width).toBeGreaterThan(beforeBox.width);

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(1);

    expect(errors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
    await webMcpCtx.close();
  } finally {
    server.kill("SIGINT");
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    server.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
