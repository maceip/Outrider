import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RELEASE_BIN = path.join(ROOT, "target/release/outrider");
const WEBMCP_ORIGIN_TRIAL_TOKEN =
  "A/h8mpmc7Ym1LKQeIQMQ2NG8Tosq469/Pk04jVBhwrEMKVjNKhqeNZz1Js6I61E9vLmF8wRkQguqkCYtFatiJggAAABbeyJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjgwIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMCwiaXNUaGlyZFBhcnR5Ijp0cnVlfQ==";

const FORBIDDEN_STRINGS = [
  "ZIM",
  "Observatory",
  "Sortie",
  "Ed25519",
  "SQLite",
  "RFC 8785",
  "MRTR",
  "SLSA",
  "SPDX",
  "sha256:",
  "playwright-walkthrough.mp4",
  "Kate Moore",
  "Alice Johnson",
  "Failed to fetch",
] as const;

async function pickFreePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const assigned = (srv.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return assigned;
}

async function waitForGatewayReady(baseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${baseUrl}/__proxyfor__/commerce/status`);
      if (res.status === 200) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Timed out waiting for gateway at ${baseUrl}: ${String(lastError)}`,
  );
}

interface RunningGateway {
  port: number;
  baseUrl: string;
  configDir: string;
  adminToken: string;
  proc: ChildProcess;
  close: () => Promise<void>;
}

async function startReleaseGateway(
  extraArgs: string[] = ["--web", "--no-open"],
  extraEnv: Record<string, string> = {},
): Promise<RunningGateway> {
  const configDir = await mkdtemp(path.join(tmpdir(), "outrider-phoenix-e2e-"));
  const port = await pickFreePort();
  const baseUrl = `http://localhost:${port}`;

  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;
  delete env.CI;
  delete env.OUTRIDER_HEADLESS;
  env.OUTRIDER_CLEF_NO_FETCH = "1";
  const nativeMacos = path.join(ROOT, "native/macos");
  env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
    ? `${nativeMacos}:${env.DYLD_LIBRARY_PATH}`
    : nativeMacos;

  const proc = spawn(
    RELEASE_BIN,
    [...extraArgs, "-l", `127.0.0.1:${port}`, "--config-dir", configDir],
    { cwd: ROOT, env, stdio: "pipe" },
  );

  await waitForGatewayReady(`http://127.0.0.1:${port}`);
  const adminToken = (
    await readFile(path.join(configDir, "outrider-admin-token"), "utf8")
  ).trim();

  return {
    port,
    baseUrl,
    configDir,
    adminToken,
    proc,
    async close() {
      if (proc.exitCode === null) {
        proc.kill("SIGINT");
        await Promise.race([
          new Promise((resolve) => proc.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
        if (proc.exitCode === null) {
          proc.kill("SIGKILL");
        }
      }
      await rm(configDir, { recursive: true, force: true });
    },
  };
}

function sendProxiedHttpRequest(
  proxyPort: number,
  targetUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ statusCode: number; body: string }> {
  const parsed = new URL(targetUrl);
  const method = options.method ?? "GET";
  const bodyBuf =
    options.body !== undefined ? Buffer.from(options.body, "utf8") : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method,
        path: targetUrl,
        headers: {
          Host: parsed.host,
          Connection: "close",
          ...(bodyBuf ? { "Content-Length": String(bodyBuf.length) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on("error", reject);
    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

function sendProxiedHttpGet(
  proxyPort: number,
  targetUrl: string,
): Promise<{ statusCode: number; body: string }> {
  return sendProxiedHttpRequest(proxyPort, targetUrl, { method: "GET" });
}

function encodeMaskedWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length >= 126) {
    throw new Error("Test helper expects short WS frame (< 126 bytes)");
  }
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i]! ^ mask[i % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}

function encodeUnmaskedWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length >= 126) {
    throw new Error("Test helper expects short WS frame (< 126 bytes)");
  }
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function decodeSingleWsTextFrame(buf: Buffer): string | null {
  if (buf.length < 2) return null;
  const second = buf[1]!;
  const isMasked = (second & 0x80) !== 0;
  const len = second & 0x7f;
  if (len >= 126) return null;
  const headerLen = 2 + (isMasked ? 4 : 0);
  if (buf.length < headerLen + len) return null;
  const payload = Buffer.alloc(len);
  if (isMasked) {
    const mask = buf.subarray(2, 6);
    for (let i = 0; i < len; i++) {
      payload[i] = buf[headerLen + i]! ^ mask[i % 4]!;
    }
  } else {
    buf.copy(payload, 0, headerLen, headerLen + len);
  }
  return payload.toString("utf8");
}

function sendProxiedWebSocketEcho(
  proxyPort: number,
  targetWsHttpUrl: string,
  clientMessage: string,
): Promise<{ echoed: string; closeSocket: () => void }> {
  const parsed = new URL(targetWsHttpUrl);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    let stage: "handshake" | "frame" | "done" = "handshake";
    let buffer = Buffer.alloc(0);

    sock.on("error", (err) => {
      if (stage !== "done") reject(err);
    });

    sock.once("connect", () => {
      const handshakeReq = [
        `GET ${targetWsHttpUrl} HTTP/1.1`,
        `Host: ${parsed.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n");
      sock.write(handshakeReq);
    });

    sock.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "handshake") {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headerStr = buffer.subarray(0, headerEnd).toString("utf8");
        if (!headerStr.startsWith("HTTP/1.1 101")) {
          reject(new Error(`Unexpected WS upgrade response: ${headerStr}`));
          sock.destroy();
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
        stage = "frame";
        sock.write(encodeMaskedWsTextFrame(clientMessage));
      }
      if (stage === "frame") {
        const decoded = decodeSingleWsTextFrame(buffer);
        if (decoded !== null) {
          stage = "done";
          resolve({
            echoed: decoded,
            closeSocket: () => {
              sock.destroy();
            },
          });
        }
      }
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function kpiCard(page: Page, title: string) {
  return page
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) })
    .locator("../..");
}

async function clickSidebarLink(page: Page, label: string) {
  const nav =
    label === "Help"
      ? page.getByRole("treegrid", { name: "Support" })
      : page.getByRole("treegrid", { name: "Dashboard navigation" });
  await nav.getByRole("row", { name: label, exact: true }).click();
}

async function assertCleanCopyAndZeroJargon(
  page: Page,
  routeName: string,
  options: { excludeCodeBlocks?: boolean } = {},
) {
  const text = await page.evaluate((excludePre) => {
    if (!excludePre) {
      return document.body.innerText;
    }
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll("pre, [data-slot='code-block']")) {
      el.remove();
    }
    return clone.innerText;
  }, Boolean(options.excludeCodeBlocks));
  for (const forbidden of FORBIDDEN_STRINGS) {
    expect(
      text.toLowerCase(),
      `Route "${routeName}" must not contain forbidden string "${forbidden}"`,
    ).not.toContain(forbidden.toLowerCase());
  }
  expect(text, `Route "${routeName}" must never render NaN`).not.toContain(
    "NaN",
  );
}

test("Phoenix HeroUI Pro dashboard clean boot, zero self-pollution, unified live stream, and interactive persistence", async ({
  page,
}) => {
  const gateway = await startReleaseGateway();
  let upstreamServer: http.Server | null = null;

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      badResponses.push(
        `${res.status()} ${res.request().method()} ${res.url()}`,
      );
    }
  });

  try {
    // =========================================================================
    // (a) Clean Boot & WebMCP Origin Trial
    // =========================================================================
    await page.goto(`${gateway.baseUrl}/__proxyfor__/`);
    await expect(page).toHaveTitle("Outrider");

    const originTrialContent = await page
      .locator('meta[http-equiv="origin-trial"]')
      .getAttribute("content");
    expect(originTrialContent).toBe(WEBMCP_ORIGIN_TRIAL_TOKEN);

    await expect(
      page.locator('[data-sidebar="label"]:visible').first(),
    ).toHaveText("Outrider");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);

    // =========================================================================
    // (b) Zero Self-Pollution & Zero Fake Data / Jargon across all 7 routes
    // =========================================================================
    // 1. Dashboard (/)
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    for (const label of ["Requests", "MCP Calls", "Sessions", "Errors"]) {
      await expect(kpiCard(page, label)).toContainText("0");
    }
    await expect(
      page.getByText("No traffic recorded", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Dashboard");

    // 2. Traffic (/traffic/)
    await clickSidebarLink(page, "Traffic");
    await expect(page).toHaveURL(/\/__proxyfor__\/traffic\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Traffic" }),
    ).toBeVisible();
    await expect(
      page.getByText("No Packets Captured", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No Request Selected", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Traffic");

    // 3. Inspector (/inspector/)
    await clickSidebarLink(page, "Inspector");
    await expect(page).toHaveURL(/\/__proxyfor__\/inspector\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Inspector" }),
    ).toBeVisible();
    await expect(page.locator('input[name="inspector-target"]')).toHaveValue(
      new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${gateway.port}/mcp$`),
    );
    await expect(
      page.getByText("No Live Connection", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No Wire Messages", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Inspector");

    // 4. Analytics (/analytics/)
    await clickSidebarLink(page, "Analytics");
    await expect(page).toHaveURL(/\/__proxyfor__\/analytics\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Analytics" }),
    ).toBeVisible();
    await expect(kpiCard(page, "Events")).toContainText("0");
    await expect(kpiCard(page, "Unique Hosts")).toContainText("0");
    await expect(kpiCard(page, "Error Rate")).toContainText("0%");
    await expect(kpiCard(page, "Avg. Latency")).toContainText("0 ms");
    await expect(
      page.getByText("No live events", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Analytics");

    // 5. Receipts (/orders/)
    await clickSidebarLink(page, "Receipts");
    await expect(page).toHaveURL(/\/__proxyfor__\/orders\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Receipts" }),
    ).toBeVisible();
    await expect(
      page.getByText("No receipts found", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Receipts");

    // 4. Settings (/settings/)
    await clickSidebarLink(page, "Settings");
    await expect(page).toHaveURL(/\/__proxyfor__\/settings\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    await expect(page.locator('input[name="proxy-address"]')).toHaveValue(
      `127.0.0.1:${gateway.port}`,
    );
    await expect(page.locator('input[name="mcp-endpoint"]')).toHaveValue(
      `http://127.0.0.1:${gateway.port}/mcp`,
    );
    await assertCleanCopyAndZeroJargon(page, "Settings");

    // 5. Help (/help/)
    await clickSidebarLink(page, "Help");
    await expect(page).toHaveURL(/\/__proxyfor__\/help\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Help" }),
    ).toBeVisible();
    await expect(
      page.getByText("Root Certificate (.pem)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Root Certificate (.cer)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Export Traffic (.har)", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Help");

    // Verify backend has ZERO self-pollution after browsing all 5 UI routes
    const emptyTrafficsRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/traffics`,
    );
    expect(emptyTrafficsRes.status).toBe(200);
    const emptyTraffics = (await emptyTrafficsRes.json()) as unknown[];
    expect(emptyTraffics.length).toBe(0);

    const emptySnapRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      {
        headers: { Authorization: `Bearer ${gateway.adminToken}` },
      },
    );
    expect(emptySnapRes.status).toBe(200);
    const emptySnap = (await emptySnapRes.json()) as {
      fingerprint_observations: unknown[];
    };
    expect(emptySnap.fingerprint_observations.length).toBe(0);

    // =========================================================================
    // (c) Unified Live Stream (HTTP Proxy + /mcp -> Live UI Update Without Reload)
    // =========================================================================
    await page.goto(`${gateway.baseUrl}/__proxyfor__/`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    await expect(kpiCard(page, "Requests")).toContainText("0");

    // Start ephemeral upstream HTTP test server
    upstreamServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      upstreamServer!.listen(0, "127.0.0.1", resolve),
    );
    const upstreamPort = (upstreamServer.address() as net.AddressInfo).port;
    const upstreamTargetUrl = `http://127.0.0.1:${upstreamPort}/e2e-upstream-ping`;

    // 1. Send 1 proxied HTTP request through 127.0.0.1:<port>
    const proxiedRes = await sendProxiedHttpGet(
      gateway.port,
      upstreamTargetUrl,
    );
    expect(proxiedRes.statusCode).toBe(200);
    expect(JSON.parse(proxiedRes.body)).toEqual({ ok: true });

    // 2. Send 1 direct POST http://localhost:<port>/mcp JSON-RPC initialize request
    const mcpInitRes = await fetch(`${gateway.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "phoenix-e2e-mcp-client", version: "1.0.0" },
        },
      }),
    });
    expect(mcpInitRes.status).toBe(200);
    await mcpInitRes.text();

    // Without reloading the browser page, assert Dashboard live-updates via /subscribe/traffics
    await expect(kpiCard(page, "Requests")).toContainText("2");
    await expect(kpiCard(page, "MCP Calls")).toContainText("1");

    const recentGrid = page.getByRole("grid", { name: "Recent traffic" });
    const recentDataRows = recentGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });
    await expect(recentDataRows).toHaveCount(2);
    await expect(recentGrid).toContainText(upstreamTargetUrl);
    await expect(recentGrid).toContainText(`${gateway.baseUrl}/mcp`);

    // Switch Dashboard tabs: Traffic -> 1 row, MCP -> 1 row, Overview -> 2 rows
    const dashboardTabs = page.getByRole("tablist", { name: "Dashboard tabs" });

    await dashboardTabs
      .getByRole("tab", { name: "Traffic", exact: true })
      .click();
    await expect(recentDataRows).toHaveCount(1);
    await expect(recentGrid).toContainText(upstreamTargetUrl);
    await expect(recentGrid).not.toContainText(`${gateway.baseUrl}/mcp`);
    await expect(kpiCard(page, "Requests")).toContainText("1");

    await dashboardTabs.getByRole("tab", { name: "MCP", exact: true }).click();
    await expect(recentDataRows).toHaveCount(1);
    await expect(recentGrid).toContainText(`${gateway.baseUrl}/mcp`);
    await expect(recentGrid).not.toContainText(upstreamTargetUrl);
    await expect(kpiCard(page, "Requests")).toContainText("1");
    await expect(kpiCard(page, "MCP Calls")).toContainText("1");

    await dashboardTabs
      .getByRole("tab", { name: "Overview", exact: true })
      .click();
    await expect(recentDataRows).toHaveCount(2);
    await expect(kpiCard(page, "Requests")).toContainText("2");

    // Exercise Dashboard period selector, Recent Traffic search & status filter, Copy cURL, and Export HAR
    await page.getByRole("button", { name: "Change period" }).click();
    await page
      .getByRole("menuitemradio", { name: "Daily", exact: true })
      .click();
    await expect(kpiCard(page, "Requests")).toContainText("2");

    const trafficSearch = page.getByRole("searchbox", {
      name: "Search traffic",
    });
    await trafficSearch.fill("e2e-upstream-ping");
    await expect(recentDataRows).toHaveCount(1);
    await trafficSearch.fill("");
    await expect(recentDataRows).toHaveCount(2);

    await recentGrid.getByRole("button", { name: "Copy cURL" }).first().click();
    await expect(
      page.getByText("Copied cURL command", { exact: true }),
    ).toBeVisible();
    const clipboardCurl = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardCurl).toContain("curl");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export HAR" }).first().click();
    const harDownload = await downloadPromise;
    expect(harDownload.suggestedFilename()).toMatch(/^outrider-.*\.har$/);

    // Navigate to Analytics (/analytics/) and assert KPIs, protocol breakdown, Live events, and Segment
    await clickSidebarLink(page, "Analytics");
    await expect(page).toHaveURL(/\/__proxyfor__\/analytics\/?$/);
    await expect(kpiCard(page, "Events")).toContainText("2");

    const protocolCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Traffic by Protocol", { exact: true }) })
      .first();
    const httpRow = protocolCard
      .locator("div")
      .filter({ has: page.getByText("HTTP", { exact: true }) })
      .first();
    const mcpRow = protocolCard
      .locator("div")
      .filter({ has: page.getByText("MCP", { exact: true }) })
      .first();
    await expect(httpRow).toContainText("1");
    await expect(mcpRow).toContainText("1");

    const liveEventsGrid = page.getByRole("grid", { name: "Live events" });
    const liveEventRows = liveEventsGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });
    await expect(liveEventRows).toHaveCount(2);
    await expect(liveEventsGrid).toContainText(upstreamTargetUrl);
    await expect(liveEventsGrid).toContainText(`${gateway.baseUrl}/mcp`);

    const timeRangeSegment = page.locator('[aria-label="Time range"]');
    for (const range of ["5M", "1H", "24H", "ALL"] as const) {
      await timeRangeSegment.getByText(range, { exact: true }).click();
      await expect(kpiCard(page, "Events")).toContainText("2");
      await expect(liveEventRows).toHaveCount(2);
    }

    // =========================================================================
    // (d) Interactive Persistence on Orders, Settings, and Help
    // =========================================================================
    // Authenticate via local desktop bootstrap endpoint to obtain session token
    const localBootstrapRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/bootstrap/local`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-outrider-client": "dashboard",
        },
        body: "{}",
      },
    );
    expect(localBootstrapRes.status).toBe(200);
    const { token: sessionToken } = (await localBootstrapRes.json()) as {
      token: string;
    };
    expect(sessionToken).toBe(gateway.adminToken);

    const bundlePutRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/bundles/put`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bundle_id: "gateway-core",
          title: "Gateway Core Tools",
          items: ["outrider_session_evidence"],
          rules: {},
        }),
      },
    );
    expect(bundlePutRes.status).toBe(200);

    const issueRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/receipts/issue`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: "agent:phoenix-client",
          bundle_id: "gateway-core",
          max_calls: 5,
          expires_at_unix: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
    );
    expect(issueRes.status).toBe(200);
    const issuedPayload = (await issueRes.json()) as {
      signed_receipt: { receipt: { receipt_id: string } };
    };
    const receiptId = issuedPayload.signed_receipt.receipt.receipt_id;
    expect(receiptId.length).toBeGreaterThan(8);

    // Visit Receipts (/orders/), verify receipt row, filter via SearchField, Status & Date range, then Revoke
    await clickSidebarLink(page, "Receipts");
    await expect(page).toHaveURL(/\/__proxyfor__\/orders\/?$/);

    const receiptsGrid = page.getByRole("grid", { name: "Receipts" });
    const receiptRows = receiptsGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });
    await expect(receiptRows).toHaveCount(1);
    await expect(receiptsGrid).toContainText(receiptId);
    await expect(receiptsGrid).toContainText("agent:phoenix-client");
    await expect(receiptsGrid).toContainText("gateway-core");
    await expect(receiptsGrid).toContainText("Active");
    await expect(receiptsGrid).toContainText("5 / 5");

    // Filter via SearchField
    const searchInput = page.getByPlaceholder("Search receipts...");
    await searchInput.fill("unmatched-receipt-search");
    await expect(
      page.getByText("No receipts match the active search or filters.", {
        exact: true,
      }),
    ).toBeVisible();
    await searchInput.fill("phoenix-client");
    await expect(receiptRows).toHaveCount(1);
    await searchInput.fill("");
    await expect(receiptRows).toHaveCount(1);

    // Filter via Status dropdown
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "Revoked", exact: true })
      .click();
    await expect(
      page.getByText("No receipts match the active search or filters.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Revoked", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "Active", exact: true })
      .click();
    await expect(receiptRows).toHaveCount(1);

    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
    await expect(receiptRows).toHaveCount(1);

    // Filter via Date range dropdown
    await page.getByRole("button", { name: "Date range", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "Last 7 days", exact: true })
      .click();
    await expect(receiptRows).toHaveCount(1);
    await page
      .getByRole("button", { name: "Last 7 days", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "All time", exact: true })
      .click();
    await expect(receiptRows).toHaveCount(1);

    // Copy ID action + Revoke action -> assert status flips to Revoked and HeroUI toast appears
    const receiptActionBtn = page
      .locator(`[data-receipt-id="${receiptId}"]`)
      .getByRole("button", { name: "Receipt actions" });
    await receiptActionBtn.click();
    await page.getByRole("menuitem", { name: "Copy ID", exact: true }).click();
    await expect(
      page.getByText("Copied receipt ID", { exact: true }),
    ).toBeVisible();

    await receiptActionBtn.click();
    await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();

    await expect(receiptsGrid).toContainText("Revoked");
    await expect(
      page.getByText("Receipt revoked", { exact: true }),
    ).toBeVisible();

    // Verify backend persisted revoked = 1
    const snapAfterRevokeRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      },
    );
    const snapAfterRevoke = (await snapAfterRevokeRes.json()) as {
      capability_receipts: Array<{ receipt_id: string; revoked: number }>;
    };
    const persistedReceipt = snapAfterRevoke.capability_receipts.find(
      (r) => r.receipt_id === receiptId,
    );
    expect(persistedReceipt?.revoked).toBe(1);

    // Visit Settings (/settings/), test Copy + Reset + Capability Probe -> On request + Save changes + reload
    await clickSidebarLink(page, "Settings");
    await expect(page).toHaveURL(/\/__proxyfor__\/settings\/?$/);

    await page.getByRole("button", { name: "Copy" }).first().click();
    await expect(
      page.getByText("Copied proxy address", { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /Capability Probe|Automatic/i })
      .click();
    await page.getByRole("option", { name: "Off", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Capability Probe|Automatic/i }),
    ).toContainText("Automatic");

    await page
      .getByRole("button", { name: /Capability Probe|Automatic/i })
      .click();
    await page.getByRole("option", { name: "On request", exact: true }).click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();

    await expect(
      page.getByText("Settings saved", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator('input[name="proxy-address"]')).toHaveValue(
      `127.0.0.1:${gateway.port}`,
    );
    await expect(
      page.getByRole("button", { name: /Capability Probe|On request/i }),
    ).toContainText("On request");

    const statusAfterSaveRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/status`,
    );
    expect(statusAfterSaveRes.status).toBe(200);
    const statusAfterSave = (await statusAfterSaveRes.json()) as {
      probe_policy: string;
    };
    expect(statusAfterSave.probe_policy).toBe("on-request");

    // Visit Help (/help/) and verify FAQ accordion + all 3 HelpLinkCard hrefs return 200 OK
    await clickSidebarLink(page, "Help");
    await expect(page).toHaveURL(/\/__proxyfor__\/help\/?$/);

    await page
      .getByRole("button", {
        name: "How do I route HTTP and HTTPS traffic through Outrider?",
      })
      .click();
    await expect(
      page.getByText(/HTTP_PROXY and HTTPS_PROXY environment variables/),
    ).toBeVisible();

    const expectedHelpSuffixes = [
      "/__proxyfor__/certificate/proxyfor-ca-cert.pem",
      "/__proxyfor__/certificate/proxyfor-ca-cert.cer",
      "/__proxyfor__/traffics?har",
    ];
    for (const expectedHref of expectedHelpSuffixes) {
      const linkLocator = page.locator(`a[href="${expectedHref}"]`);
      await expect(linkLocator).toBeVisible();
      const res = await fetch(`${gateway.baseUrl}${expectedHref}`);
      expect(res.status, `Expected 200 OK for ${expectedHref}`).toBe(200);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(20);
      if (expectedHref.endsWith(".pem") || expectedHref.endsWith(".cer")) {
        expect(body).toContain("BEGIN CERTIFICATE");
      } else {
        const har = JSON.parse(body) as { log?: { entries?: unknown[] } };
        expect(Array.isArray(har.log?.entries)).toBe(true);
        expect(har.log!.entries!.length).toBe(2);
      }
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    if (upstreamServer) {
      await new Promise<void>((resolve) =>
        upstreamServer!.close(() => resolve()),
      );
    }
    await gateway.close();
  }
});

test("Desktop mode launches http://localhost:<port>/__proxyfor__/#bootstrap=<nonce> and scrubs single-use hash", async ({
  page,
}) => {
  const openerDir = await mkdtemp(path.join(tmpdir(), "outrider-opener-"));
  const launchedUrlFile = path.join(openerDir, "launched-url.txt");
  const openerScript = path.join(openerDir, "capture-opener.sh");
  await writeFile(
    openerScript,
    `#!/bin/sh\nprintf '%s' "$1" > "${launchedUrlFile}"\n`,
    "utf8",
  );
  await chmod(openerScript, 0o755);

  const gateway = await startReleaseGateway(["--desktop"], {
    OUTRIDER_BROWSER_OPENER: openerScript,
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    if (res.status() >= 400) {
      badResponses.push(
        `${res.status()} ${res.request().method()} ${res.url()}`,
      );
    }
  });

  try {
    let launchedUrl = "";
    for (let i = 0; i < 50; i++) {
      try {
        launchedUrl = (await readFile(launchedUrlFile, "utf8")).trim();
        if (launchedUrl) break;
      } catch {
        // Wait for opener script write.
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(launchedUrl).toMatch(
      new RegExp(
        `^http://localhost:${gateway.port}/__proxyfor__/#bootstrap=[0-9a-f]{64}$`,
      ),
    );

    await page.goto(launchedUrl);
    await expect(page).toHaveTitle("Outrider");
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();

    // Nonce hash must be scrubbed from window.location.hash immediately upon exchange
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");

    // Verify bootstrap_exchange audit row persisted in SQLite
    await expect
      .poll(async () => {
        const res = await fetch(
          `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
          {
            headers: { Authorization: `Bearer ${gateway.adminToken}` },
          },
        );
        const snap = (await res.json()) as {
          admin_audit_log: Array<{ action: string }>;
        };
        return snap.admin_audit_log.some(
          (row) => row.action === "auth.bootstrap_exchange",
        );
      })
      .toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    await gateway.close();
    await rm(openerDir, { recursive: true, force: true });
  }
});

test("All 7 static routes clean, MCP Inspector 2-pane surface (/inspector/), and Wireshark Traffic Monitor (/traffic/) end-to-end", async ({
  page,
}) => {
  const gateway = await startReleaseGateway();
  let upstreamServer: http.Server | null = null;
  let closeWsClient: (() => void) | null = null;
  const openServerSockets = new Set<net.Socket>();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      badResponses.push(
        `${res.status()} ${res.request().method()} ${res.url()}`,
      );
    }
  });

  try {
    // =========================================================================
    // (a) Direct Static Load of All 7 Routes Clean & Zero Self-Pollution
    // =========================================================================
    const sevenRoutes: ReadonlyArray<{ path: string; heading: string }> = [
      { path: "/", heading: "Dashboard" },
      { path: "/traffic/", heading: "Traffic" },
      { path: "/inspector/", heading: "Inspector" },
      { path: "/analytics/", heading: "Analytics" },
      { path: "/orders/", heading: "Receipts" },
      { path: "/settings/", heading: "Settings" },
      { path: "/help/", heading: "Help" },
    ];

    for (const route of sevenRoutes) {
      const response = await page.goto(
        `${gateway.baseUrl}/__proxyfor__${route.path}`,
      );
      expect(response?.status(), `200 OK for ${route.path}`).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
      await assertCleanCopyAndZeroJargon(page, route.path);

      const hasNoHorizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      expect(
        hasNoHorizontalOverflow,
        `Zero horizontal overflow expected on ${route.path}`,
      ).toBe(true);
    }

    // Verify computed Silvector Design System fidelity, sidebar brand mark, and ThemeToggle persistence
    await page.goto(`${gateway.baseUrl}/__proxyfor__/`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();

    const silvectorTokens = await page.evaluate(() => {
      const rootTheme = document.documentElement.dataset.theme ?? "";
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const h1 = document.querySelector("h1");
      const h1Style = h1 ? getComputedStyle(h1) : null;
      const btn = document.querySelector(".button");
      const btnFont = btn ? getComputedStyle(btn).fontFamily : "";
      const logo = document.querySelector(
        'img[alt="Outrider"]',
      ) as HTMLImageElement | null;
      return {
        rootTheme,
        bodyFont,
        h1Font: h1Style?.fontFamily ?? "",
        h1Weight: h1Style?.fontWeight ?? "",
        h1Transform: h1Style?.textTransform ?? "",
        btnFont,
        logoLoaded: Boolean(logo && logo.complete && logo.naturalWidth > 0),
        logoSrc: logo?.getAttribute("src") ?? "",
      };
    });
    expect(silvectorTokens.rootTheme).toBe("brutalism-dark");
    expect(silvectorTokens.bodyFont).toMatch(/inter/i);
    expect(silvectorTokens.h1Font).toMatch(/space grotesk/i);
    expect(silvectorTokens.h1Weight).toBe("600");
    expect(silvectorTokens.h1Transform).toBe("none");
    expect(silvectorTokens.btnFont).toMatch(/space grotesk/i);
    expect(silvectorTokens.logoLoaded).toBe(true);
    expect(silvectorTokens.logoSrc).toContain("/brand/dark/outrider-icon-64.png");

    await page.locator('[aria-label="Switch to light mode"]:visible').first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("brutalism-light");
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe("brutalism-light");
    expect(
      await page.evaluate(() => {
        const logo = document.querySelector(
          'img[alt="Outrider"]',
        ) as HTMLImageElement | null;
        return Boolean(
          logo &&
            logo.complete &&
            logo.naturalWidth > 0 &&
            (logo.getAttribute("src") ?? "").includes("/brand/light/"),
        );
      }),
    ).toBe(true);
    await page.locator('[aria-label="Switch to dark mode"]:visible').first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("brutalism-dark");

    const cleanTrafficsRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/traffics`,
    );
    expect(cleanTrafficsRes.status).toBe(200);
    expect(((await cleanTrafficsRes.json()) as unknown[]).length).toBe(0);

    const cleanSnapRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      { headers: { Authorization: `Bearer ${gateway.adminToken}` } },
    );
    expect(cleanSnapRes.status).toBe(200);
    const cleanSnap = (await cleanSnapRes.json()) as {
      fingerprint_observations: unknown[];
    };
    expect(cleanSnap.fingerprint_observations.length).toBe(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);

    // =========================================================================
    // (b) MCP Inspector 2-Pane Surface (/inspector/)
    // =========================================================================
    await clickSidebarLink(page, "Inspector");
    await expect(page).toHaveURL(/\/__proxyfor__\/inspector\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Inspector" }),
    ).toBeVisible();

    const targetInput = page.locator('input[name="inspector-target"]');
    await expect(targetInput).toHaveValue(
      new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${gateway.port}/mcp$`),
    );

    // Click "Connect" -> status becomes "Connected", Tools populate, Wire Log records handshake
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("form").getByText("Connected", { exact: true }),
    ).toBeVisible();

    // Assert Tools tab populates real gateway tools (outrider_catalog & outrider_checkout_bundle)
    const toolsPanel = page.getByRole("tabpanel", { name: "Tools" });
    const toolSelectBtn = toolsPanel.locator('[data-slot="select-trigger"]');
    await expect(toolSelectBtn).toContainText("outrider_catalog");

    await toolSelectBtn.click();
    await expect(
      page.getByRole("option", { name: /outrider_catalog\b/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /outrider_checkout_bundle\b/ }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: /outrider_catalog\b/ })
      .first()
      .click();

    // Assert Wire Log right pane records handshake frame & displays handshake payload in CodeBlock
    await expect(page.getByText("Wire Log", { exact: true })).toBeVisible();
    const handshakeFrameBtn = page.getByRole("option", {
      name: /<-\s*handshake/,
    });
    await expect(handshakeFrameBtn).toBeVisible();
    await handshakeFrameBtn.click();
    await expect(page.locator("pre, code").last()).toContainText(
      "protocolVersion",
    );

    // Run real tool (outrider_catalog) via "Run Tool" and verify request & response frames in Wire Log CodeBlock
    await toolsPanel
      .getByRole("button", { name: "Run Tool", exact: true })
      .click();
    const toolCallReqBtn = page.getByRole("option", {
      name: /->\s*tools\/call/,
    });
    const toolCallResBtn = page.getByRole("option", {
      name: /<-\s*tools\/call/,
    });
    await expect(toolCallReqBtn).toBeVisible();
    await expect(toolCallResBtn).toBeVisible();

    await toolCallReqBtn.click();
    await expect(page.locator("pre, code").last()).toContainText(
      "outrider_catalog",
    );

    await toolCallResBtn.click();
    await expect(page.locator("pre, code").last()).toContainText("content");

    // Switch to Raw tab and run "ping" via "Send Request"
    const explorerTabs = page.getByRole("tablist", {
      name: "MCP Inspector Explorer",
    });
    await explorerTabs.getByRole("tab", { name: "Raw", exact: true }).click();
    const rawPanel = page.getByRole("tabpanel", { name: "Raw" });
    await expect(
      rawPanel.locator('input[name="inspector-raw-method"]'),
    ).toHaveValue("ping");
    await rawPanel
      .getByRole("button", { name: "Send Request", exact: true })
      .click();

    const pingReqBtn = page.getByRole("option", { name: /->\s*ping/ });
    const pingResBtn = page.getByRole("option", { name: /<-\s*ping/ });
    await expect(pingReqBtn).toBeVisible();
    await expect(pingResBtn).toBeVisible();
    await pingReqBtn.click();
    await expect(page.locator("pre, code").last()).toContainText('"ping"');
    await pingResBtn.click();
    await expect(page.locator("pre, code").last()).toContainText("{");

    // Click "Disconnect" and verify clean "Disconnected" transition
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Connect", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("form").getByText("Disconnected", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No Live Connection", { exact: true }),
    ).toBeVisible();
    await assertCleanCopyAndZeroJargon(page, "Inspector (after session)");

    // =========================================================================
    // (c) Wireshark Traffic Monitor Top/Bottom Split (/traffic/)
    // =========================================================================
    // Spin up ephemeral local HTTP + WebSocket echo server
    upstreamServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/e2e-json-echo") {
        let rawBody = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          rawBody += chunk;
        });
        req.on("end", () => {
          let parsedBody: unknown = rawBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            // Keep raw string if non-JSON
          }
          res.writeHead(201, {
            "Content-Type": "application/json",
            "X-Outrider-Echo": "verified",
          });
          res.end(
            JSON.stringify({
              echoed: parsedBody,
              ok: true,
            }),
          );
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_item" }));
    });

    upstreamServer.on("connection", (sock) => {
      openServerSockets.add(sock);
      sock.on("close", () => openServerSockets.delete(sock));
    });

    upstreamServer.on("upgrade", (req, socket) => {
      const wsSocket = socket as net.Socket;
      openServerSockets.add(wsSocket);
      wsSocket.on("close", () => openServerSockets.delete(wsSocket));

      const wsKey = String(req.headers["sec-websocket-key"] ?? "");
      const acceptKey = createHash("sha1")
        .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      wsSocket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${acceptKey}`,
          "",
          "",
        ].join("\r\n"),
      );

      let wsBuf = Buffer.alloc(0);
      wsSocket.on("data", (chunk: Buffer) => {
        wsBuf = Buffer.concat([wsBuf, chunk]);
        const msg = decodeSingleWsTextFrame(wsBuf);
        if (msg !== null) {
          wsBuf = Buffer.alloc(0);
          wsSocket.write(
            encodeUnmaskedWsTextFrame(
              JSON.stringify({ ws_server_echo: JSON.parse(msg) }),
            ),
          );
        }
      });
    });

    await new Promise<void>((resolve) =>
      upstreamServer!.listen(0, "127.0.0.1", resolve),
    );
    const upstreamPort = (upstreamServer.address() as net.AddressInfo).port;
    const httpPostUrl = `http://127.0.0.1:${upstreamPort}/e2e-json-echo`;
    const http404Url = `http://127.0.0.1:${upstreamPort}/e2e-not-found`;
    const wsEchoUrl = `http://127.0.0.1:${upstreamPort}/ws-echo`;

    // 1. Send proxied HTTP POST with JSON body
    const postRes = await sendProxiedHttpRequest(gateway.port, httpPostUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "ord_phoenix_99", amount: 42 }),
    });
    expect(postRes.statusCode).toBe(201);
    expect(JSON.parse(postRes.body)).toEqual({
      echoed: { order_id: "ord_phoenix_99", amount: 42 },
      ok: true,
    });

    // 2. Send proxied HTTP 404 GET (for Status 4xx dropdown verification)
    const notFoundRes = await sendProxiedHttpGet(gateway.port, http404Url);
    expect(notFoundRes.statusCode).toBe(404);

    // 3. Send proxied WebSocket upgrade + JSON frame echo
    const wsSession = await sendProxiedWebSocketEcho(
      gateway.port,
      wsEchoUrl,
      JSON.stringify({ ws_client_hello: "outrider_packet" }),
    );
    closeWsClient = wsSession.closeSocket;
    expect(JSON.parse(wsSession.echoed)).toEqual({
      ws_server_echo: { ws_client_hello: "outrider_packet" },
    });

    // Navigate to /traffic/ and verify MCP (from /inspector/), HTTP POST, and WebSocket rows in DataGrid
    await clickSidebarLink(page, "Traffic");
    await expect(page).toHaveURL(/\/__proxyfor__\/traffic\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Traffic" }),
    ).toBeVisible();
    await expect(page.getByText("Unable to reach local gateway")).toHaveCount(
      0,
    );

    const packetGrid = page.getByRole("grid", { name: "Live packet stream" });
    const packetDataRows = packetGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });

    await expect(packetGrid).toContainText("/mcp");
    await expect(packetGrid).toContainText(httpPostUrl);
    await expect(packetGrid).toContainText(wsEchoUrl);

    // Test <Segment> protocol filter: MCP, HTTP, WebSocket, All
    const protocolSegment = page.locator('[aria-label="Filter by protocol"]');

    await protocolSegment.getByText("MCP", { exact: true }).click();
    await expect(packetGrid).toContainText("/mcp");
    await expect(packetGrid).not.toContainText(httpPostUrl);
    await expect(packetGrid).not.toContainText(wsEchoUrl);

    await protocolSegment.getByText("HTTP", { exact: true }).click();
    await expect(packetDataRows).toHaveCount(2);
    await expect(packetGrid).toContainText(httpPostUrl);
    await expect(packetGrid).toContainText(http404Url);
    await expect(packetGrid).not.toContainText("/mcp");
    await expect(packetGrid).not.toContainText(wsEchoUrl);

    await protocolSegment.getByText("WebSocket", { exact: true }).click();
    await expect(packetDataRows).toHaveCount(1);
    await expect(packetGrid).toContainText(wsEchoUrl);
    await expect(packetGrid).toContainText("WS");

    await protocolSegment.getByText("All", { exact: true }).click();
    await expect(packetGrid).toContainText("/mcp");
    await expect(packetGrid).toContainText(httpPostUrl);
    await expect(packetGrid).toContainText(wsEchoUrl);

    // Test <SearchField>
    const filterInput = page.getByPlaceholder(
      "Filter by host, path, method, or status...",
    );
    await filterInput.fill("e2e-json-echo");
    await expect(packetDataRows).toHaveCount(1);
    await expect(packetGrid).toContainText(httpPostUrl);
    await filterInput.fill("");
    await expect(packetGrid).toContainText("/mcp");

    // Test Status dropdown (4xx -> 2xx -> All)
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "4xx", exact: true }).click();
    await expect(packetGrid).toContainText(http404Url);
    await expect(packetGrid).not.toContainText(httpPostUrl);
    await expect(packetGrid).not.toContainText(wsEchoUrl);

    await page.getByRole("button", { name: "4xx", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "2xx", exact: true }).click();
    await expect(packetGrid).toContainText(httpPostUrl);
    await expect(packetGrid).toContainText("/mcp");
    await expect(packetGrid).not.toContainText(http404Url);

    await page.getByRole("button", { name: "2xx", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "All", exact: true }).click();

    // Click a captured 200 OK /mcp POST row in the top DataGrid -> inspect Request & Response in bottom Resizable pane
    const mcpPostRow = packetDataRows
      .filter({ hasText: "/mcp" })
      .filter({ hasText: "POST" })
      .filter({ hasText: "200" })
      .first();
    await mcpPostRow.click();

    const detailTabs = page.getByRole("tablist", {
      name: "Packet inspector sections",
    });
    const reqPanel = page.getByRole("tabpanel", { name: "Request" });
    await expect(reqPanel).toContainText("content-type");
    await expect(reqPanel).toContainText("application/json");
    await expect(reqPanel).toContainText('"jsonrpc": "2.0"');

    await detailTabs
      .getByRole("tab", { name: "Response", exact: true })
      .click();
    const resPanel = page.getByRole("tabpanel", { name: "Response" });
    await expect(resPanel).toContainText("Headers");
    await expect(resPanel).toContainText('"jsonrpc"');

    // Click the captured HTTP POST row -> inspect Request JSON body, Response JSON body, Copy cURL, & Download HAR
    await detailTabs.getByRole("tab", { name: "Request", exact: true }).click();
    await packetDataRows.filter({ hasText: "e2e-json-echo" }).first().click();
    await expect(reqPanel).toContainText("ord_phoenix_99");

    await detailTabs
      .getByRole("tab", { name: "Response", exact: true })
      .click();
    await expect(resPanel).toContainText("x-outrider-echo");
    await expect(resPanel).toContainText("ord_phoenix_99");

    await page.getByRole("button", { name: "Copy cURL", exact: true }).click();
    await expect(
      page.getByText("Copied cURL command", { exact: true }),
    ).toBeVisible();
    const detailCurl = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(detailCurl).toContain("curl");
    expect(detailCurl).toContain("e2e-json-echo");

    const singleHarPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download HAR", exact: true })
      .click();
    const singleHarDownload = await singleHarPromise;
    expect(singleHarDownload.suggestedFilename()).toMatch(/^traffic-\d+\.har$/);

    // Select captured WebSocket row -> switch to WebSocket tab & assert live bidirectional frames in CodeBlock
    await packetDataRows.filter({ hasText: "ws-echo" }).first().click();
    await detailTabs
      .getByRole("tab", { name: "WebSocket", exact: true })
      .click();
    const wsPanel = page.getByRole("tabpanel", { name: "WebSocket" });
    await expect(wsPanel).toContainText("Client -> Server");
    await expect(wsPanel).toContainText("outrider_packet");
    await expect(wsPanel).toContainText("Server -> Client");
    await expect(wsPanel).toContainText("ws_server_echo");

    await assertCleanCopyAndZeroJargon(page, "Traffic (populated)");
    await expect(page.getByText("Unable to reach local gateway")).toHaveCount(
      0,
    );

    // Exercise Receipts (/orders/) Issue Receipt Drawer end-to-end against real SQLite backend
    await clickSidebarLink(page, "Receipts");
    await expect(page).toHaveURL(/\/__proxyfor__\/orders\/?$/);
    await page.getByRole("button", { name: "Issue Receipt" }).click();
    await expect(
      page.getByRole("dialog", { name: "Issue Receipt" }),
    ).toBeVisible();
    await page
      .locator('input[name="receipt-subject"]')
      .fill("agent:drawer-e2e");
    await page.locator('input[name="receipt-max-calls"]').fill("15");
    await page
      .getByRole("button", { name: "Mint Receipt", exact: true })
      .click();
    await expect(page.getByText("Receipt issued", { exact: true })).toBeVisible();
    const drawerReceiptsGrid = page.getByRole("grid", { name: "Receipts" });
    await expect(drawerReceiptsGrid).toContainText("agent:drawer-e2e");
    await expect(drawerReceiptsGrid).toContainText("15 / 15");
    await expect(drawerReceiptsGrid).toContainText("Active");
    await assertCleanCopyAndZeroJargon(page, "Receipts (after drawer issue)");

    const drawerSnapRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      { headers: { Authorization: `Bearer ${gateway.adminToken}` } },
    );
    expect(drawerSnapRes.status).toBe(200);
    const drawerSnap = (await drawerSnapRes.json()) as {
      capability_receipts: Array<{
        subject: string;
        max_calls: number;
        signature_verified: boolean;
      }>;
    };
    const mintedViaDrawer = drawerSnap.capability_receipts.find(
      (r) => r.subject === "agent:drawer-e2e",
    );
    expect(mintedViaDrawer).toBeDefined();
    expect(mintedViaDrawer?.max_calls).toBe(15);
    expect(mintedViaDrawer?.signature_verified).toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    if (closeWsClient) {
      closeWsClient();
    }
    for (const sock of openServerSockets) {
      sock.destroy();
    }
    if (upstreamServer) {
      await new Promise<void>((resolve) =>
        upstreamServer!.close(() => resolve()),
      );
    }
    await gateway.close();
  }
});

async function rewritePagesBasePathRecursively(
  dir: string,
  basePath: string,
): Promise<void> {
  const targetExts = new Set([".html", ".js", ".css", ".txt", ".json"]);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewritePagesBasePathRecursively(full, basePath);
    } else if (
      entry.isFile() &&
      targetExts.has(path.extname(entry.name).toLowerCase())
    ) {
      const content = await readFile(full, "utf8");
      if (content.includes("/__PAGES_BASE__")) {
        await writeFile(
          full,
          content.replaceAll("/__PAGES_BASE__", basePath),
          "utf8",
        );
      }
    }
  }
}

function staticMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".har":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

test("GitHub Pages static showcase (www-dist rewritten to /Outrider) loads with zero errors, plays 1080p walkthrough, and drives interactive HAR + WebCrypto Ed25519 labs", async ({
  page,
}) => {
  const srcDist = path.join(ROOT, "www-dist");
  const pagesTmpRoot = await mkdtemp(
    path.join(tmpdir(), "outrider-pages-e2e-"),
  );
  const mountedOutriderDir = path.join(pagesTmpRoot, "Outrider");
  await cp(srcDist, mountedOutriderDir, { recursive: true });
  await rewritePagesBasePathRecursively(mountedOutriderDir, "/Outrider");

  const openSockets = new Set<net.Socket>();
  const staticServer = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url ?? "/", "http://127.0.0.1");
      const decodedPath = decodeURIComponent(urlObj.pathname);
      const safeRel = path
        .normalize(decodedPath)
        .replace(/^(\.\.(\/|\\|$))+/, "")
        .replace(/^\/+/, "");
      let candidate = path.join(pagesTmpRoot, safeRel);
      let fileStat = await stat(candidate).catch(() => null);
      if (fileStat?.isDirectory()) {
        candidate = path.join(candidate, "index.html");
        fileStat = await stat(candidate).catch(() => null);
      }
      if (!fileStat || !fileStat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      const mime = staticMimeType(candidate);
      const totalSize = fileStat.size;
      const rangeHeader = req.headers.range;

      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const [startStr, endStr] = rangeHeader
          .slice("bytes=".length)
          .split("-");
        const start = Number.parseInt(startStr ?? "0", 10);
        const end = endStr
          ? Math.min(Number.parseInt(endStr, 10), totalSize - 1)
          : totalSize - 1;
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          start <= end &&
          start < totalSize
        ) {
          const fullBuf = await readFile(candidate);
          const slice = fullBuf.subarray(start, end + 1);
          res.writeHead(206, {
            "Accept-Ranges": "bytes",
            "Content-Length": String(slice.byteLength),
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Content-Type": mime,
          });
          res.end(slice);
          return;
        }
      }

      const body = await readFile(candidate);
      res.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.byteLength),
        "Content-Type": mime,
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(err));
    }
  });

  staticServer.on("connection", (sock) => {
    openSockets.add(sock);
    sock.on("close", () => openSockets.delete(sock));
  });

  await new Promise<void>((resolve) =>
    staticServer.listen(0, "127.0.0.1", resolve),
  );
  const staticPort = (staticServer.address() as net.AddressInfo).port;
  const pagesUrl = `http://127.0.0.1:${staticPort}/Outrider/`;

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    if (res.status() >= 400) {
      badResponses.push(
        `${res.status()} ${res.request().method()} ${res.url()}`,
      );
    }
  });

  try {
    const res = await page.goto(pagesUrl);
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();

    // 0. Exact @heroui-pro/template-dashboard rails on www: all 7 routes, zero custom scroll-page slop
    await expect(
      page.locator('[data-sidebar="label"]:visible').first(),
    ).toHaveText("Outrider");

    const wwwNav = page.getByRole("treegrid", { name: "Dashboard navigation" });
    for (const navLabel of [
      "Dashboard",
      "Traffic",
      "Inspector",
      "Analytics",
      "Receipts",
      "Settings",
    ]) {
      await expect(
        wwwNav.getByRole("row", { name: navLabel, exact: true }),
      ).toBeVisible();
    }

    const wwwBrandAndLayout = await page.evaluate(() => {
      const sidebarLogo = document.querySelector(
        'img[alt="Outrider"]',
      ) as HTMLImageElement | null;
      const unbackedControls = Array.from(
        document.querySelectorAll("button, input, textarea, select"),
      )
        .filter((el) => {
          const hasSlot =
            el.hasAttribute("data-slot") || el.closest("[data-slot]") !== null;
          const isHeroButton = el.classList.contains("button");
          return !hasSlot && !isHeroButton;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);

      return {
        noHorizontalOverflow:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        sidebarLogoLoaded: Boolean(
          sidebarLogo && sidebarLogo.complete && sidebarLogo.naturalWidth > 0,
        ),
        footerCount: document.querySelectorAll("footer").length,
        rawCodeCount: document.querySelectorAll("code:not(pre code)").length,
        unbackedControls,
      };
    });
    expect(wwwBrandAndLayout.noHorizontalOverflow).toBe(true);
    expect(wwwBrandAndLayout.sidebarLogoLoaded).toBe(true);
    expect(wwwBrandAndLayout.footerCount).toBe(0);
    expect(wwwBrandAndLayout.rawCodeCount).toBe(0);
    expect(wwwBrandAndLayout.unbackedControls).toEqual([]);

    // Dashboard Recent Traffic DataGrid hydrated with 9 recorded exchanges
    const recentGrid = page.getByRole("grid", { name: "Recent traffic" });
    await expect(
      recentGrid.getByRole("row").filter({ hasNot: page.getByRole("columnheader") }),
    ).toHaveCount(9);

    await assertCleanCopyAndZeroJargon(page, "www Dashboard", {
      excludeCodeBlocks: true,
    });

    // 1. Walkthrough Modal opens from DashboardToolbar rail -> 100% dark 2x-slower video + HeroUI Popover scene jumper
    await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
    const modalDialog = page.getByRole("dialog", {
      name: "Agentic Commerce Testflight",
    });
    await expect(modalDialog).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const video = document.querySelector("video");
          return video
            ? { width: video.videoWidth, duration: video.duration }
            : { width: 0, duration: 0 };
        }),
      )
      .toEqual({
        width: expect.any(Number),
        duration: expect.any(Number),
      });
    const videoMeta = await page.evaluate(() => {
      const video = document.querySelector("video");
      return {
        width: video?.videoWidth ?? 0,
        duration: video?.duration ?? 0,
      };
    });
    expect(videoMeta.width).toBeGreaterThan(0);
    expect(videoMeta.duration).toBeGreaterThan(50);

    const scenePill = modalDialog.getByRole("button", { name: /^Scene 1 of / });
    await expect(scenePill).toBeVisible();
    await scenePill.click();
    await expect(
      page.getByRole("listbox", { name: "Walkthrough scenes" }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: /Wire Stream Inspection/ })
      .click();
    await expect(
      modalDialog.getByRole("button", { name: /Wire Stream Inspection/ }),
    ).toBeVisible();
    await modalDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(modalDialog).toBeHidden();

    // 2. /Outrider/traffic -> split-pane TrafficPage hydrated + Copy cURL works
    await clickSidebarLink(page, "Traffic");
    await expect(
      page.getByRole("heading", { level: 1, name: "Traffic" }),
    ).toBeVisible();
    const trafficGrid = page.getByRole("grid", { name: "Live packet stream" });
    await expect(
      trafficGrid.getByRole("row").filter({ hasNot: page.getByRole("columnheader") }),
    ).toHaveCount(9);
    await trafficGrid
      .getByRole("row")
      .filter({ hasText: "/v1/agent-manifest" })
      .first()
      .click();
    await page.getByRole("button", { name: "Copy cURL", exact: true }).click();
    await expect(page.getByText("Copied cURL command", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("curl");

    // 3. /Outrider/inspector -> opens Connected with tools preloaded + Run Tool appends live frames
    await clickSidebarLink(page, "Inspector");
    await expect(
      page.getByRole("heading", { level: 1, name: "Inspector" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    const toolsPanel = page.getByRole("tabpanel", { name: "Tools" });
    await toolsPanel.getByRole("button", { name: "Run Tool", exact: true }).click();
    await expect(
      page.getByRole("option", { name: /<-\s*tools\/call/ }).last(),
    ).toBeVisible();

    // 4. /Outrider/orders (Receipts) -> Issue Receipt Drawer mints real WebCrypto Ed25519 receipt
    await clickSidebarLink(page, "Receipts");
    await expect(
      page.getByRole("heading", { level: 1, name: "Receipts" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Issue Receipt" }).click();
    await expect(
      page.getByRole("dialog", { name: "Issue Receipt" }),
    ).toBeVisible();
    await page.locator('input[name="receipt-subject"]').fill("agent:hiring-demo");
    await page.getByRole("button", { name: "Mint Receipt", exact: true }).click();
    await expect(
      page.getByRole("grid", { name: "Receipts" }).getByText("agent:hiring-demo"),
    ).toBeVisible();

    // 5. /Outrider/analytics, /Outrider/settings, /Outrider/help
    await clickSidebarLink(page, "Analytics");
    await expect(
      page.getByRole("heading", { level: 1, name: "Analytics" }),
    ).toBeVisible();

    await clickSidebarLink(page, "Settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();

    await clickSidebarLink(page, "Help");
    await expect(
      page.getByRole("heading", { level: 1, name: "Help" }),
    ).toBeVisible();
    await expect(
      page.getByText("macOS Installer (.dmg)", { exact: true }),
    ).toBeVisible();

    await assertCleanCopyAndZeroJargon(page, "www (post-interaction)", {
      excludeCodeBlocks: true,
    });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    for (const sock of openSockets) {
      sock.destroy();
    }
    await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    await rm(pagesTmpRoot, { recursive: true, force: true });
  }
});
