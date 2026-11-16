#!/usr/bin/env node
/**
 * Records a full 1080p Playwright end-to-end walkthrough (`playwright-walkthrough.mp4`)
 * against the real installed `/Applications/Outrider.app/Contents/MacOS/outrider` binary.
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_BIN = "/Applications/Outrider.app/Contents/MacOS/outrider";
const OUT_MP4 = path.join(ROOT, "dashboard/www-public/demo/playwright-walkthrough.mp4");
const OUT_CUES_JSON = path.join(ROOT, "dashboard/src/lib/walkthrough-cues.json");
const ARTIFACT_COPY_MP4 =
  "/Users/mac/.gemini/antigravity/brain/caeccb67-9a79-43a1-a9bf-51444c01fd54/outrider-playwright-walkthrough.mp4";

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForGatewayReady(baseUrl) {
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${baseUrl}/__proxyfor__/commerce/status`);
      if (res.status === 200) return;
    } catch {
      // Wait for listener.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for Outrider gateway at ${baseUrl}`);
}

function sendProxiedHttpRequest(proxyPort, targetUrl, options = {}) {
  const parsed = new URL(targetUrl);
  const method = options.method ?? "GET";
  const bodyBuf = options.body !== undefined ? Buffer.from(options.body, "utf8") : undefined;

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
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function encodeMaskedWsTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function encodeUnmaskedWsTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function decodeSingleWsTextFrame(buf) {
  if (buf.length < 2) return null;
  const second = buf[1];
  const isMasked = (second & 0x80) !== 0;
  const len = second & 0x7f;
  if (len >= 126) return null;
  const headerLen = 2 + (isMasked ? 4 : 0);
  if (buf.length < headerLen + len) return null;
  const payload = Buffer.alloc(len);
  if (isMasked) {
    const mask = buf.subarray(2, 6);
    for (let i = 0; i < len; i++) {
      payload[i] = buf[headerLen + i] ^ mask[i % 4];
    }
  } else {
    buf.copy(payload, 0, headerLen, headerLen + len);
  }
  return payload.toString("utf8");
}

function sendProxiedWebSocketEcho(proxyPort, targetWsHttpUrl, clientMessage) {
  const parsed = new URL(targetWsHttpUrl);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    let stage = "handshake";
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

    sock.on("data", (chunk) => {
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
            closeSocket: () => sock.destroy(),
          });
        }
      }
    });
  });
}

async function clickSidebarLink(page, label) {
  const nav =
    label === "Help"
      ? page.getByRole("treegrid", { name: "Support" })
      : page.getByRole("treegrid", { name: "Dashboard navigation" });
  await nav.getByRole("row", { name: label, exact: true }).click();
}

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), "outrider-walkthrough-"));
  const configDir = path.join(workDir, "config");
  const videoDir = path.join(workDir, "video");
  const dbPath = path.join(workDir, "outrider-demo.db");
  await mkdir(configDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });

  const openServerSockets = new Set();
  const upstreamServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/catalog/products") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          catalog: "silvector-edge",
          items: [
            { sku: "OR-GATEWAY-01", status: "available" },
            { sku: "OR-CLEF-GEMMA", status: "verified" },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/orders/quote") {
      let rawBody = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", () => {
        let parsed = rawBody;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          // Keep string fallback.
        }
        res.writeHead(201, {
          "Content-Type": "application/json",
          "X-Outrider-Upstream": "verified",
        });
        res.end(JSON.stringify({ quote_id: "qt_silvector_01", request: parsed, status: "ready" }));
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  upstreamServer.on("connection", (sock) => {
    openServerSockets.add(sock);
    sock.on("close", () => openServerSockets.delete(sock));
  });

  upstreamServer.on("upgrade", (req, socket) => {
    openServerSockets.add(socket);
    socket.on("close", () => openServerSockets.delete(socket));
    const wsKey = String(req.headers["sec-websocket-key"] ?? "");
    const acceptKey = createHash("sha1")
      .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
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
    socket.on("data", (chunk) => {
      wsBuf = Buffer.concat([wsBuf, chunk]);
      const msg = decodeSingleWsTextFrame(wsBuf);
      if (msg !== null) {
        wsBuf = Buffer.alloc(0);
        socket.write(
          encodeUnmaskedWsTextFrame(JSON.stringify({ ack: "live_stream_ready", echo: JSON.parse(msg) })),
        );
      }
    });
  });

  await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstreamServer.address().port;

  const port = await pickFreePort();
  const baseUrl = `http://localhost:${port}`;
  const env = { ...process.env, OUTRIDER_CLEF_NO_FETCH: "1" };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;

  const proc = spawn(
    APP_BIN,
    [
      "--web",
      "--no-open",
      "--probe-policy",
      "on-request",
      "-l",
      `127.0.0.1:${port}`,
      "--config-dir",
      configDir,
      "--db",
      dbPath,
    ],
    { cwd: workDir, env, stdio: "pipe" },
  );

  let closeWsClient = null;
  let browser = null;

  try {
    await waitForGatewayReady(`http://127.0.0.1:${port}`);
    const adminToken = (await readFile(path.join(configDir, "outrider-admin-token"), "utf8")).trim();

    // Configure bundle so checkout + receipt minting showcase full capability flow
    const bundleRes = await fetch(`${baseUrl}/__proxyfor__/commerce/bundles/put`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bundle_id: "outrider_session_evidence",
        title: "Session Evidence Bundle",
        items: ["outrider_session_evidence"],
        rules: {},
      }),
    });
    if (!bundleRes.ok) {
      throw new Error(`Failed to seed bundle: ${bundleRes.status}`);
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1920, height: 1080 },
      },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const recordStartMs = Date.now();
    const recordedCues = [];
    const markCue = (id, title, description) => {
      const startSec =
        recordedCues.length === 0
          ? 0
          : Math.max(0, Number(((Date.now() - recordStartMs) / 1000).toFixed(1)));
      recordedCues.push({ id, startSec, title, description });
    };

    // 1. Open Dashboard (/) — Space Grotesk + Inter + JetBrains Mono + seamless loopback auth
    markCue(
      "dashboard",
      "Live Dashboard",
      "Agent requests and session calls stream into the local gateway in real time.",
    );
    await page.goto(`${baseUrl}/__proxyfor__/`);
    await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor({ state: "visible" });
    await page.waitForTimeout(2200);

    // 2. Stream real HTTP GET, HTTP POST, WebSocket echo, and MCP session live!
    await sendProxiedHttpRequest(port, `http://127.0.0.1:${upstreamPort}/v1/catalog/products`, {
      method: "GET",
    });
    await page.waitForTimeout(700);

    await sendProxiedHttpRequest(port, `http://127.0.0.1:${upstreamPort}/v1/orders/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle: "outrider_session_evidence", seats: 4 }),
    });
    await page.waitForTimeout(700);

    const wsEcho = await sendProxiedWebSocketEcho(
      port,
      `http://127.0.0.1:${upstreamPort}/ws/telemetry`,
      JSON.stringify({ subscribe: "agent_wire_events" }),
    );
    closeWsClient = wsEcho.closeSocket;
    await page.waitForTimeout(700);

    const sessionSecret = randomUUID();
    const mcpHeaders = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "outrider-session-id": sessionSecret,
    };
    const mcpMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "outrider-autonomous-agent",
        version: "1.0.0",
      },
    };
    await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, "Mcp-Method": "server/discover" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: { _meta: mcpMeta },
      }),
    });
    await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...mcpHeaders,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "outrider_catalog",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { _meta: mcpMeta, name: "outrider_catalog", arguments: {} },
      }),
    });

    await page.waitForTimeout(2600);

    const dashboardTabs = page.getByRole("tablist", { name: "Dashboard tabs" });
    await dashboardTabs.getByRole("tab", { name: "MCP", exact: true }).click();
    await page.waitForTimeout(1900);
    await dashboardTabs.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.waitForTimeout(2000);

    // 3. Navigate to Inspector (/inspector) -> Connect -> outrider_catalog
    markCue(
      "inspector-catalog",
      "Testing a Tool Call",
      "Connecting to the local server and running the catalog tool from the workbench.",
    );
    await clickSidebarLink(page, "Inspector");
    await page.getByRole("heading", { level: 1, name: "Inspector" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1900);

    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).waitFor({ state: "visible" });
    await page.waitForTimeout(2100);

    const toolsPanel = page.getByRole("tabpanel", { name: "Tools" });
    await toolsPanel.getByRole("button", { name: "Run Tool", exact: true }).click();
    await page.getByRole("option", { name: /<-\s*tools\/call/ }).first().waitFor({ state: "visible" });
    await page.waitForTimeout(2300);

    // 3b. outrider_checkout_bundle -> Wire Log
    markCue(
      "inspector-checkout",
      "Bundle Handshake",
      "Requesting a gated bundle to inspect the exact access pass prompt returned to the agent.",
    );
    const toolSelectTrigger = toolsPanel.locator('[data-slot="select-trigger"]');
    await toolSelectTrigger.click();
    await page.waitForTimeout(900);
    await page.getByRole("option", { name: /outrider_checkout_bundle\b/ }).first().click();
    await page.waitForTimeout(1200);

    const bundleArgInput = toolsPanel.locator('input[name="tool-arg-bundle_id"]');
    if ((await bundleArgInput.count()) > 0) {
      await bundleArgInput.fill("outrider_session_evidence");
    } else {
      await toolsPanel.locator("#inspector-tool-json-args").fill(
        JSON.stringify({ bundle_id: "outrider_session_evidence" }, null, 2),
      );
    }
    await page.waitForTimeout(1300);
    await toolsPanel.getByRole("button", { name: "Run Tool", exact: true }).click();
    await page.waitForTimeout(2300);

    await page.getByRole("option", { name: /->\s*tools\/call/ }).last().click();
    await page.waitForTimeout(1900);
    await page.getByRole("option", { name: /<-\s*tools\/call/ }).last().click();
    await page.waitForTimeout(2300);

    // 4. Navigate to Traffic (/traffic) -> unified DataGrid -> Request / Response / WS -> Copy cURL
    markCue(
      "traffic",
      "Wire Stream Inspection",
      "Filtering live exchanges and inspecting full request and response payloads.",
    );
    await clickSidebarLink(page, "Traffic");
    await page.getByRole("heading", { level: 1, name: "Traffic" }).waitFor({ state: "visible" });
    await page.waitForTimeout(2100);

    const protocolSegment = page.locator('[aria-label="Filter by protocol"]');
    await protocolSegment.getByText("MCP", { exact: true }).click();
    await page.waitForTimeout(1900);
    await protocolSegment.getByText("All", { exact: true }).click();
    await page.waitForTimeout(1800);

    const packetGrid = page.getByRole("grid", { name: "Live packet stream" });
    const packetRows = packetGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });

    await packetRows.filter({ hasText: "/v1/orders/quote" }).first().click();
    await page.waitForTimeout(2000);

    const detailTabs = page.getByRole("tablist", { name: "Packet inspector sections" });
    await detailTabs.getByRole("tab", { name: "Response", exact: true }).click();
    await page.waitForTimeout(2100);

    await page.getByRole("button", { name: "Copy cURL", exact: true }).click();
    await page.getByText("Copied cURL command", { exact: true }).waitFor({ state: "visible" });
    await page.waitForTimeout(2100);

    await packetRows.filter({ hasText: "/ws/telemetry" }).first().click();
    await detailTabs.getByRole("tab", { name: "WebSocket", exact: true }).click();
    await page.waitForTimeout(2300);

    // 5. Navigate to Receipts (/orders) -> open Issue Receipt drawer -> mint real receipt -> Active in DataGrid
    markCue(
      "receipts",
      "Issuing an Access Pass",
      "Minting a scoped session pass with a call quota from the operator drawer.",
    );
    await clickSidebarLink(page, "Receipts");
    await page.getByRole("heading", { level: 1, name: "Receipts" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1900);

    await page.getByRole("button", { name: "Issue Receipt" }).click();
    await page.getByRole("dialog", { name: "Issue Receipt" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1700);

    await page.locator('input[name="receipt-subject"]').fill("agent:testflight-client");
    await page.locator('input[name="receipt-max-calls"]').fill("25");
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Mint Receipt", exact: true }).click();
    await page.getByRole("grid", { name: "Receipts" }).getByText("agent:testflight-client").waitFor({
      state: "visible",
    });
    await page.waitForTimeout(2500);

    // 6. Visit Analytics, Settings, Help
    markCue(
      "telemetry",
      "Activity & Configuration",
      "Reviewing host volume, gateway endpoints, and local certificate downloads.",
    );
    await clickSidebarLink(page, "Analytics");
    await page.getByRole("heading", { level: 1, name: "Analytics" }).waitFor({ state: "visible" });
    await page.waitForTimeout(2300);

    await clickSidebarLink(page, "Settings");
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor({ state: "visible" });
    await page.waitForTimeout(2100);

    await clickSidebarLink(page, "Help");
    await page.getByRole("heading", { level: 1, name: "Help" }).waitFor({ state: "visible" });
    await page
      .getByRole("button", {
        name: "How do I route HTTP and HTTPS traffic through Outrider?",
      })
      .click();
    await page.waitForTimeout(2100);

    // 7. Return to Dashboard + toggle Light & Dark surfaces from bottom sidebar switcher
    markCue(
      "theme",
      "Light & Dark Surfaces",
      "Switching seamlessly between dark and light workbench themes.",
    );
    await clickSidebarLink(page, "Dashboard");
    await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1800);

    await page.locator('[aria-label="Switch to light mode"]:visible').first().click();
    await page.waitForTimeout(2700);

    await page.locator('[aria-label="Switch to dark mode"]:visible').first().click();
    await page.waitForTimeout(2400);

    await writeFile(OUT_CUES_JSON, `${JSON.stringify(recordedCues, null, 2)}\n`, "utf8");

    await page.close();
    await context.close();
    await browser.close();
    browser = null;

    const recordedFiles = (await readdir(videoDir)).filter((f) => f.endsWith(".webm"));
    if (recordedFiles.length === 0) {
      throw new Error(`No .webm video produced in ${videoDir}`);
    }
    const rawWebmPath = path.join(videoDir, recordedFiles[0]);

    await mkdir(path.dirname(OUT_MP4), { recursive: true });
    const ff = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        rawWebmPath,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-preset",
        "fast",
        "-movflags",
        "+faststart",
        OUT_MP4,
      ],
      { stdio: "inherit" },
    );
    if (ff.status !== 0) {
      throw new Error(`ffmpeg failed with exit code ${ff.status}`);
    }

    const outStat = await stat(OUT_MP4);
    await mkdir(path.dirname(ARTIFACT_COPY_MP4), { recursive: true });
    await copyFile(OUT_MP4, ARTIFACT_COPY_MP4);
    console.log(
      `[record_walkthrough] Encoded 1080p H.264 walkthrough (${outStat.size} bytes) -> ${OUT_MP4} & ${ARTIFACT_COPY_MP4}`,
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (closeWsClient) {
      closeWsClient();
    }
    for (const sock of openServerSockets) {
      sock.destroy();
    }
    await new Promise((resolve) => upstreamServer.close(() => resolve()));
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
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
