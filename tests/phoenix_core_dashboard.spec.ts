import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
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
const SCRATCH_DIR =
  process.env.CONDUIT_SCRATCH_DIR ??
  path.join(tmpdir(), "conduit-e2e-screenshots");
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
  "Outrider",
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
  const configDir = await mkdtemp(path.join(tmpdir(), "conduit-v7-e2e-"));
  const port = await pickFreePort();
  const baseUrl = `http://localhost:${port}`;

  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;
  delete env.CI;
  delete env.OUTRIDER_HEADLESS;
  env.OUTRIDER_CLEF_NO_FETCH = "1";
  const nativeMacos = path.join(ROOT, "native/macos");
  const nativeLinux = path.join(ROOT, "native/linux");
  env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
    ? `${nativeMacos}:${env.DYLD_LIBRARY_PATH}`
    : nativeMacos;
  env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
    ? `${nativeLinux}:${env.LD_LIBRARY_PATH}`
    : nativeLinux;

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

async function selectInvestigationView(
  page: Page,
  label: "Overview" | "Graph" | "Wire" | "Passes",
) {
  await page
    .locator('[aria-label="Investigation view"]')
    .getByText(label, { exact: true })
    .click();
}

async function assertCleanCopyAndHeroUiHygiene(
  page: Page,
  routeName: string,
  options: { excludeCodeBlocks?: boolean } = {},
) {
  const audit = await page.evaluate((excludePre) => {
    const codeEls = excludePre
      ? Array.from(
          document.querySelectorAll<HTMLElement>(
            "pre, [data-slot='code-block']",
          ),
        )
      : [];
    const savedDisplays = codeEls.map((el) => el.style.display);
    let text = "";
    try {
      for (const el of codeEls) {
        el.style.display = "none";
      }
      text = document.body.innerText;
    } finally {
      codeEls.forEach((el, idx) => {
        el.style.display = savedDisplays[idx] ?? "";
      });
    }

    const unbackedControls = Array.from(
      document.querySelectorAll("button, input, textarea, select"),
    )
      .filter((el) => {
        const hasOwnSlot = el.hasAttribute("data-slot");
        const isHeroClass =
          el.classList.contains("button") ||
          el.classList.contains("segment__item") ||
          el.classList.contains("input") ||
          el.classList.contains("search-field__input") ||
          el.classList.contains("accordion__trigger") ||
          el.classList.contains("select__trigger") ||
          el.classList.contains("tabs__tab") ||
          el.classList.contains("close-button") ||
          el.closest(
            ".segment, .switch, .search-field, .text-field, .select, .accordion, .tabs, [data-slot='code-block'], [data-slot='table'], [data-slot='data-grid']",
          ) !== null;
        return !hasOwnSlot && !isHeroClass;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);

    return {
      text,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      footerCount: document.querySelectorAll("footer").length,
      rawCodeCount: document.querySelectorAll("code:not(pre code)").length,
      verticalStripeCount: document.querySelectorAll(
        "[class*='border-l-2'], [class*='border-l-4']",
      ).length,
      unbackedControls,
    };
  }, Boolean(options.excludeCodeBlocks));

  for (const forbidden of FORBIDDEN_STRINGS) {
    expect(
      audit.text.toLowerCase(),
      `Route "${routeName}" must not contain forbidden string "${forbidden}"`,
    ).not.toContain(forbidden.toLowerCase());
  }
  expect(audit.text, `Route "${routeName}" must never render NaN`).not.toContain(
    "NaN",
  );
  expect(
    audit.noHorizontalOverflow,
    `Zero horizontal overflow expected on "${routeName}"`,
  ).toBe(true);
  expect(
    audit.footerCount,
    `Zero <footer> tags expected on "${routeName}"`,
  ).toBe(0);
  expect(
    audit.rawCodeCount,
    `Zero inline <code> tags expected on "${routeName}"`,
  ).toBe(0);
  expect(
    audit.verticalStripeCount,
    `Zero vertical accent stripes expected on "${routeName}"`,
  ).toBe(0);
  expect(
    audit.unbackedControls,
    `Zero non-HeroUI controls expected on "${routeName}"`,
  ).toEqual([]);
}

test("Conduit single-header shell clean boot, Live Commerce Interceptor v7 (AudioShop hold/validate/release/Ed25519 fulfill), and unified Capture/Orders/Overview/Settings/Help persistence", async ({
  page,
}) => {
  await mkdir(SCRATCH_DIR, { recursive: true });
  const gateway = await startReleaseGateway();
  let upstreamServer: http.Server | null = null;
  let closeWsClient: (() => void) | null = null;
  const openServerSockets = new Set<net.Socket>();

  await page.route(
    "https://api.github.com/repos/maceip/Outrider/releases/latest",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tag_name: "v0.5.18",
          assets: [
            {
              name: "outrider-v0.5.18-aarch64-apple-darwin.dmg",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-aarch64-apple-darwin.dmg",
            },
            {
              name: "outrider-v0.5.18-x86_64-pc-windows-msvc.msi",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-x86_64-pc-windows-msvc.msi",
            },
            {
              name: "outrider-v0.5.18-x86_64-unknown-linux-gnu.tar.gz",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-x86_64-unknown-linux-gnu.tar.gz",
            },
          ],
        }),
      }),
  );

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
    // (a) Clean Cold Boot, Unified Sell-Side Shell & Removed Redundant Tabs
    // =========================================================================
    const directRoutes: ReadonlyArray<{ path: string; marker: string }> = [
      { path: "/", marker: "Waiting for Agent Traffic" },
      { path: "/settings/", marker: "Gateway Endpoints" },
      { path: "/help/", marker: "Root Certificate (.pem)" },
    ];

    for (const route of directRoutes) {
      const response = await page.goto(
        `${gateway.baseUrl}/__proxyfor__${route.path}`,
      );
      expect(response?.status(), `200 OK for ${route.path}`).toBe(200);
      await expect(page).toHaveTitle("Conduit");
      await expect(page.getByText(route.marker, { exact: true })).toBeVisible();
      await expect(
        page.locator('[aria-label="Workspace navigation"]'),
      ).toHaveCount(0);
      await assertCleanCopyAndHeroUiHygiene(page, route.path);
    }

    // Verify redundant split Wireshark/Analytics/Orders/Inspector routes are removed (404)
    for (const removedRoute of [
      "/traffic/",
      "/inspector/",
      "/orders/",
      "/analytics/",
    ]) {
      const removedRes = await fetch(
        `${gateway.baseUrl}/__proxyfor__${removedRoute}`,
      );
      expect(
        removedRes.status,
        `404 expected for removed route ${removedRoute}`,
      ).toBe(404);
    }

    await page.goto(`${gateway.baseUrl}/__proxyfor__/`);
    const originTrialContent = await page
      .locator('meta[http-equiv="origin-trial"]')
      .getAttribute("content");
    expect(originTrialContent).toBe(WEBMCP_ORIGIN_TRIAL_TOKEN);

    // Verify Conduit single-header brand tokens + bottom Light/Dark <Segment>
    const conduitTokens = await page.evaluate(() => {
      const rootTheme = document.documentElement.dataset.theme ?? "";
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const btn = document.querySelector(".button");
      const btnFont = btn ? getComputedStyle(btn).fontFamily : "";
      const logo = document.querySelector(
        'img[alt="Conduit"]',
      ) as HTMLImageElement | null;
      const sidebarCount = document.querySelectorAll(
        '[aria-label="Dashboard navigation"]',
      ).length;
      return {
        rootTheme,
        bodyFont,
        btnFont,
        logoLoaded: Boolean(logo && logo.complete && logo.naturalWidth > 0),
        logoSrc: logo?.getAttribute("src") ?? "",
        sidebarCount,
      };
    });
    expect(conduitTokens.rootTheme).toBe("brutalism-dark");
    expect(conduitTokens.bodyFont).toMatch(/inter/i);
    expect(conduitTokens.btnFont).toMatch(/space grotesk/i);
    expect(conduitTokens.logoLoaded).toBe(true);
    expect(conduitTokens.logoSrc).toContain("/brand/dark/conduit-icon-64.png");
    expect(conduitTokens.sidebarCount).toBe(0);

    const themeSegment = page.locator('[aria-label="Color theme"]');
    await themeSegment.getByText("Light", { exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("brutalism-light");
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe("brutalism-light");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const logo = document.querySelector(
            'img[alt="Conduit"]',
          ) as HTMLImageElement | null;
          return Boolean(
            logo &&
              logo.complete &&
              logo.naturalWidth > 0 &&
              (logo.getAttribute("src") ?? "").includes("/brand/light/"),
          );
        }),
      )
      .toBe(true);
    await page
      .locator('[aria-label="Color theme"]')
      .getByText("Dark", { exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("brutalism-dark");

    // Verify cold boot stream bar displays real 0 metrics (zero fake heuristics)
    await expect(
      page.locator('[aria-label="Live packet stream bar"]'),
    ).toContainText("0 events · 0 held · 0 ms avg");

    // Verify backend has ZERO self-pollution after visiting all routes
    const emptyTrafficsRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/traffics`,
    );
    expect(emptyTrafficsRes.status).toBe(200);
    expect(((await emptyTrafficsRes.json()) as unknown[]).length).toBe(0);

    const emptySnapRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      { headers: { Authorization: `Bearer ${gateway.adminToken}` } },
    );
    expect(emptySnapRes.status).toBe(200);
    const emptySnap = (await emptySnapRes.json()) as {
      fingerprint_observations: unknown[];
    };
    expect(emptySnap.fingerprint_observations.length).toBe(0);

    // =========================================================================
    // (b) Unified Sell-Side Commerce Investigation Platform (`/`) End-to-End
    // =========================================================================
    await page
      .getByRole("button", { name: "Start Live Scenario", exact: true })
      .click();
    await expect(
      page.getByText("AudioShop live interception active", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "AudioShop — Headphone Purchase",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Merchant: audioshop.com ← Buyer: agent-7f2 · MCP", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Merchant (audioshop.com)", { exact: true }),
    ).toBeVisible();

    // Verify Left Rail Sessions list (4 real SQLite transactions) & session switching
    const sessionsListbox = page.getByRole("listbox", {
      name: "Commerce sessions",
    });
    await expect(sessionsListbox).toContainText("AudioShop");
    await expect(sessionsListbox).toContainText("Negotiate (held)");
    await expect(sessionsListbox).toContainText("Skyport");
    await expect(sessionsListbox).toContainText("DisplayCo");
    await expect(sessionsListbox).toContainText("Cloudstore");

    await sessionsListbox.getByRole("option", { name: "Cloudstore" }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Cloudstore — Compute Credits",
      }),
    ).toBeVisible();
    await sessionsListbox.getByRole("option", { name: "AudioShop" }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "AudioShop — Headphone Purchase",
      }),
    ).toBeVisible();

    // Verify 5-Step Linear Phase Timeline (`Negotiate` HELD)
    const phaseTimeline = page.locator(
      '[aria-label="Transaction phase timeline"]',
    );
    await expect(phaseTimeline).toContainText("Discover");
    await expect(phaseTimeline).toContainText("Negotiate");
    await expect(phaseTimeline).toContainText("HELD — Awaiting operator");
    await expect(phaseTimeline).toContainText("Cart");
    await expect(phaseTimeline).toContainText("Payment");
    await expect(phaseTimeline).toContainText("Fulfill");

    // Verify CausalCradledGraph nodes (`C01`, `C02`, `R02`, `O01 $219`, `O02 $229`, dotted draft `O03 $209`, pending `C03`–`C05`)
    const graphRegion = page.locator('[data-slot="causal-cradled-graph"]');
    await expect(graphRegion).toBeVisible();
    await expect(
      graphRegion.getByRole("button", { name: "C01 discover_products (200)" }),
    ).toBeVisible();
    await expect(
      graphRegion.getByRole("button", { name: "C02 get_offers (200)" }),
    ).toBeVisible();
    const r02Node = graphRegion.getByRole("button", {
      name: "R02 return_offers (HELD)",
    });
    await expect(r02Node).toBeVisible();
    await expect(r02Node).toHaveAttribute("aria-pressed", "true");
    await expect(
      graphRegion.getByRole("button", { name: "C03 select_product (PENDING)" }),
    ).toBeVisible();
    await expect(
      graphRegion.getByRole("button", {
        name: "C04 create_checkout_session (PENDING)",
      }),
    ).toBeVisible();
    await expect(
      graphRegion.getByRole("button", {
        name: "C05 complete_checkout_session (PENDING)",
      }),
    ).toBeVisible();
    await expect(graphRegion).toContainText("Seller offers");
    await expect(graphRegion).toContainText("O01");
    await expect(graphRegion).toContainText("$219");
    await expect(graphRegion).toContainText("O02");
    await expect(graphRegion).toContainText("$229");
    await expect(graphRegion).toContainText("Proxy Lane");
    await expect(graphRegion).toContainText("O03 Offer C (draft)");
    await expect(graphRegion).toContainText("$209");

    // Capture crisp screenshot of Live Native Gateway Commerce Interceptor v7 in HELD state
    await page.screenshot({
      path: path.join(SCRATCH_DIR, "conduit_v7_interceptor.png"),
      fullPage: false,
    });

    // Verify Cross-Panel Selection Sync (C01 -> R02 across Graph, Trace DataGrid, and Seller Selected Event)
    await graphRegion
      .getByRole("button", { name: "C01 discover_products (200)" })
      .click();
    await expect(
      page.getByText("C01 · discover_products", { exact: true }),
    ).toBeVisible();
    const traceGrid = page.getByRole("grid", { name: "Execution trace" });
    await expect(
      traceGrid
        .getByRole("row")
        .filter({ hasText: "C01" })
        .first(),
    ).toHaveAttribute("data-selected", "true");

    // Click R02 in Seller MCP Responses ListBox -> syncs back to Graph & Trace
    const sellerResponses = page.getByRole("listbox", {
      name: "Seller MCP responses",
    });
    await sellerResponses
      .getByRole("option", { name: /R02 · return_offers/ })
      .click();
    await expect(r02Node).toHaveAttribute("aria-pressed", "true");
    await expect(
      traceGrid
        .getByRole("row")
        .filter({ hasText: "R02" })
        .first(),
    ).toHaveAttribute("data-selected", "true");

    // Exercise Inspect Payload Drawer (Original vs Proposed JSON CodeBlocks)
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    const inspectDialog = page.getByRole("dialog", { name: "Inspect Payload" });
    await expect(inspectDialog).toBeVisible();
    await expect(inspectDialog).toContainText("Original Wire Payload");
    await expect(inspectDialog).toContainText("Proposed Replacement Payload");
    await expect(inspectDialog).toContainText("conduit_proxy");
    await inspectDialog
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
    await expect(inspectDialog).toBeHidden();

    // Verify Multidirectional <Segment> (`Buyer → Seller` / `Seller → Buyer`) swaps Source & Recipient live
    const directionSegment = page.locator(
      '[aria-label="Interception direction"]',
    );
    await directionSegment.getByText("Buyer → Seller", { exact: true }).click();
    await expect(
      page
        .locator("div")
        .filter({ hasText: /^Sourceagent-7f2$/ })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator("div")
        .filter({ hasText: /^Recipientaudioshop\.com$/ })
        .first(),
    ).toBeVisible();

    await directionSegment.getByText("Seller → Buyer", { exact: true }).click();
    await expect(
      page
        .locator("div")
        .filter({ hasText: /^Sourceaudioshop\.com$/ })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator("div")
        .filter({ hasText: /^Recipientagent-7f2$/ })
        .first(),
    ).toBeVisible();

    // Real `/interception/validate`: flips Seller policy from `Pending validation` -> `Valid`
    const verificationGates = page.locator('[aria-label="Verification gates"]');
    await expect(verificationGates).toContainText("Pending validation");
    await verificationGates
      .getByRole("button", { name: "Validate Policy", exact: true })
      .click();
    await expect(
      page.getByText("Seller policy verified", { exact: true }),
    ).toBeVisible();
    await expect(verificationGates).not.toContainText("Pending validation");
    await expect(verificationGates).toContainText("Valid");

    // Real `Review & Send Response` (`/interception/release`): unblocks suspended Rust buyer task!
    await page
      .getByRole("button", { name: "Review & Send Response", exact: true })
      .click();
    await expect(
      page.getByText("Replacement response released to buyer", { exact: true }),
    ).toBeVisible();

    await expect(
      graphRegion.getByRole("button", { name: "R02 return_offers (200)" }),
    ).toBeVisible();
    await expect(graphRegion).toContainText("Proxy Lane · Committed");
    await expect(
      graphRegion.getByRole("button", { name: "C03 select_product (200)" }),
    ).toBeVisible();
    await expect(
      graphRegion.getByRole("button", {
        name: "C04 create_checkout_session (200)",
      }),
    ).toBeVisible();
    await expect(traceGrid).toContainText("O03");
    await expect(verificationGates).toContainText("Approved");
    await expect(phaseTimeline).toContainText("Awaiting payment pass");

    // Real `Authorize Payment` (`/interception/authorize-payment`): mints verified Ed25519 pass & completes C05 (`Fulfill`)
    await expect(verificationGates).toContainText("Unverified");
    await verificationGates
      .getByRole("button", { name: "Authorize Payment", exact: true })
      .click();
    await expect(
      page.getByText("Session payment pass authorized", { exact: true }),
    ).toBeVisible();
    await expect(verificationGates).toContainText("Authorized");
    await expect(
      graphRegion.getByRole("button", {
        name: "C05 complete_checkout_session (200)",
      }),
    ).toBeVisible();
    await expect(sessionsListbox).toContainText("Fulfill (complete)");

    // Expand & collapse Dual-Speed Live Stream Bar
    await page
      .getByRole("button", { name: "Expand Stream", exact: true })
      .click();
    await expect(
      page.getByRole("listbox", { name: "Live packet tail" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Collapse Stream", exact: true })
      .click();

    await assertCleanCopyAndHeroUiHygiene(page, "Transactions (fulfilled)", {
      excludeCodeBlocks: true,
    });

    // =========================================================================
    // (c) Unified Capture (`/traffic`), Orders (`/orders`), Overview (`/analytics`), Settings & Help
    // =========================================================================
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
            // Keep raw string
          }
          res.writeHead(201, {
            "Content-Type": "application/json",
            "X-Conduit-Echo": "verified",
          });
          res.end(JSON.stringify({ echoed: parsedBody, ok: true }));
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

    const postRes = await sendProxiedHttpRequest(gateway.port, httpPostUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "ord_conduit_77", amount: 209 }),
    });
    expect(postRes.statusCode).toBe(201);

    const notFoundRes = await sendProxiedHttpGet(gateway.port, http404Url);
    expect(notFoundRes.statusCode).toBe(404);

    const wsSession = await sendProxiedWebSocketEcho(
      gateway.port,
      wsEchoUrl,
      JSON.stringify({ ws_client_hello: "conduit_packet" }),
    );
    closeWsClient = wsSession.closeSocket;
    expect(JSON.parse(wsSession.echoed)).toEqual({
      ws_server_echo: { ws_client_hello: "conduit_packet" },
    });

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
          clientInfo: { name: "conduit-e2e-mcp-client", version: "1.0.0" },
        },
      }),
    });
    expect(mcpInitRes.status).toBe(200);
    await mcpInitRes.text();

    // 1. Unified Wire lens inside `/` via Investigation view <Segment>
    await selectInvestigationView(page, "Wire");
    await expect(page).toHaveURL(/\/__proxyfor__\/?$/);

    const packetGrid = page.getByRole("grid", { name: "Live packet stream" });
    const packetDataRows = packetGrid
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") });

    await expect(packetGrid).toContainText("/mcp");
    await expect(packetGrid).toContainText(httpPostUrl);
    await expect(packetGrid).toContainText(wsEchoUrl);

    const protocolSegment = page.locator('[aria-label="Filter by protocol"]');
    await protocolSegment.getByText("WebSocket", { exact: true }).click();
    await expect(packetDataRows).toHaveCount(1);
    await expect(packetGrid).toContainText(wsEchoUrl);

    await protocolSegment.getByText("All", { exact: true }).click();
    await packetDataRows.filter({ hasText: "e2e-json-echo" }).first().click();

    const detailTabs = page.getByRole("tablist", {
      name: "Packet inspector sections",
    });
    const reqPanel = page.getByRole("tabpanel", { name: "Request" });
    await expect(reqPanel).toContainText("ord_conduit_77");

    await detailTabs
      .getByRole("tab", { name: "Response", exact: true })
      .click();
    const resPanel = page.getByRole("tabpanel", { name: "Response" });
    await expect(resPanel).toContainText("x-conduit-echo");

    await page.getByRole("button", { name: "Copy cURL", exact: true }).click();
    await expect(
      page.getByText("Copied cURL command", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "e2e-json-echo",
    );

    const exportHarPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export HAR", exact: true })
      .click();
    const harDownload = await exportHarPromise;
    expect(harDownload.suggestedFilename()).toMatch(/^conduit-.*\.har$/);

    await packetDataRows.filter({ hasText: "ws-echo" }).first().click();
    await detailTabs
      .getByRole("tab", { name: "WebSocket", exact: true })
      .click();
    const wsPanel = page.getByRole("tabpanel", { name: "WebSocket" });
    await expect(wsPanel).toContainText("conduit_packet");
    await expect(wsPanel).toContainText("ws_server_echo");
    await assertCleanCopyAndHeroUiHygiene(page, "Wire (populated)", {
      excludeCodeBlocks: true,
    });

    // 2. Unified Passes & Bundles lens inside `/` via Investigation view <Segment>
    await selectInvestigationView(page, "Passes");
    await expect(page).toHaveURL(/\/__proxyfor__\/?$/);

    const passesGrid = page.getByRole("grid", { name: "Session passes" });
    await expect(passesGrid).toContainText("agent-7f2");
    await expect(passesGrid).toContainText("conduit_session_evidence");
    await expect(passesGrid).toContainText("Active");

    // Switch Orders workspace segment to Bundles and verify persisted bundle
    const ordersWorkspaceSeg = page.locator('[aria-label="Orders workspace"]');
    await ordersWorkspaceSeg.getByText("Bundles", { exact: true }).click();
    const bundlesGrid = page.getByRole("grid", { name: "Bundles" });
    await expect(bundlesGrid).toContainText("conduit_session_evidence");
    await ordersWorkspaceSeg
      .getByText("Session Passes", { exact: true })
      .click();

    // Issue a new Session Pass via Drawer (`Issue Pass` -> `Mint Pass`)
    await page
      .getByRole("button", { name: "Issue Pass", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Issue Pass" }),
    ).toBeVisible();
    await page
      .locator('input[name="receipt-subject"]')
      .fill("agent:conduit-e2e");
    await page.locator('input[name="receipt-max-calls"]').fill("15");
    await page.getByRole("button", { name: "Mint Pass", exact: true }).click();
    await expect(
      page.getByText("Session pass issued", { exact: true }),
    ).toBeVisible();
    await expect(passesGrid).toContainText("agent:conduit-e2e");
    await expect(passesGrid).toContainText("15 / 15");

    // Verify minted pass in SQLite snapshot and revoke it via row actions
    const snapBeforeRevokeRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/snapshot`,
      { headers: { Authorization: `Bearer ${gateway.adminToken}` } },
    );
    const snapBeforeRevoke = (await snapBeforeRevokeRes.json()) as {
      capability_receipts: Array<{
        receipt_id: string;
        subject: string;
        signature_verified: boolean;
        revoked: number;
      }>;
    };
    const conduitPass = snapBeforeRevoke.capability_receipts.find(
      (r) => r.subject === "agent:conduit-e2e",
    );
    expect(conduitPass).toBeDefined();
    expect(conduitPass?.signature_verified).toBe(true);

    const passActionBtn = page
      .locator(`[data-receipt-id="${conduitPass!.receipt_id}"]`)
      .getByRole("button", { name: "Receipt actions" });
    await passActionBtn.click();
    await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
    await expect(
      page.getByText("Receipt revoked", { exact: true }),
    ).toBeVisible();
    await expect(passesGrid).toContainText("Revoked");
    await assertCleanCopyAndHeroUiHygiene(page, "Passes (populated)", {
      excludeCodeBlocks: true,
    });

    // Return to Overview lens
    await selectInvestigationView(page, "Overview");
    await expect(
      page.locator('[data-slot="causal-cradled-graph"]'),
    ).toBeVisible();

    // 3. Settings (/settings) via top navbar button
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/__proxyfor__\/settings\/?$/);
    await expect(
      page.getByRole("button", { name: "Control Plane", exact: true }),
    ).toBeVisible();
    await expect(page.locator('input[name="proxy-address"]')).toHaveValue(
      `127.0.0.1:${gateway.port}`,
    );
    await page.getByRole("button", { name: "Copy" }).first().click();
    await expect(
      page.getByText("Copied proxy address", { exact: true }),
    ).toBeVisible();

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

    const statusAfterSaveRes = await fetch(
      `${gateway.baseUrl}/__proxyfor__/commerce/status`,
    );
    const statusAfterSave = (await statusAfterSaveRes.json()) as {
      probe_policy: string;
    };
    expect(statusAfterSave.probe_policy).toBe("on-request");
    await assertCleanCopyAndHeroUiHygiene(page, "Settings");

    // 4. Help (/help) via top navbar button + return to Control Plane
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await expect(page).toHaveURL(/\/__proxyfor__\/help\/?$/);
    await page
      .getByRole("button", {
        name: "How do I route HTTP and HTTPS traffic through Conduit?",
      })
      .click();
    await expect(
      page.getByText(/HTTP_PROXY and HTTPS_PROXY environment variables/),
    ).toBeVisible();

    for (const expectedHref of [
      "/__proxyfor__/certificate/proxyfor-ca-cert.pem",
      "/__proxyfor__/certificate/proxyfor-ca-cert.cer",
      "/__proxyfor__/traffics?har",
    ]) {
      await expect(page.locator(`a[href="${expectedHref}"]`)).toBeVisible();
      const res = await fetch(`${gateway.baseUrl}${expectedHref}`);
      expect(res.status).toBe(200);
    }
    await assertCleanCopyAndHeroUiHygiene(page, "Help");

    await page
      .getByRole("button", { name: "Control Plane", exact: true })
      .click();
    await expect(page).toHaveURL(/\/__proxyfor__\/?$/);

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

test("Desktop mode launches http://localhost:<port>/__proxyfor__/#bootstrap=<nonce> and scrubs single-use hash", async ({
  page,
}) => {
  const openerDir = await mkdtemp(path.join(tmpdir(), "conduit-opener-"));
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
    await expect(page).toHaveTitle("Conduit");
    await expect(
      page.getByText("Waiting for Agent Traffic", { exact: true }),
    ).toBeVisible();

    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");

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
    case ".webp":
      return "image/webp";
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

test("GitHub Pages Conduit landing page (/Outrider/) renders Agentic Commerce Control Plane hero, hydrates live workbench on desktop and 390x844 mobile, and verifies Walkthrough, Download, and theme switcher", async ({
  page,
}) => {
  await mkdir(SCRATCH_DIR, { recursive: true });
  const srcDist = path.join(ROOT, "www-dist");
  const pagesTmpRoot = await mkdtemp(
    path.join(tmpdir(), "conduit-pages-e2e-"),
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

  await page.route(
    "https://api.github.com/repos/maceip/Outrider/releases/latest",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tag_name: "v0.5.18",
          assets: [
            {
              name: "outrider-v0.5.18-aarch64-apple-darwin.dmg",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-aarch64-apple-darwin.dmg",
            },
            {
              name: "outrider-v0.5.18-x86_64-pc-windows-msvc.msi",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-x86_64-pc-windows-msvc.msi",
            },
            {
              name: "outrider-v0.5.18-x86_64-unknown-linux-gnu.tar.gz",
              browser_download_url:
                "https://github.com/maceip/Outrider/releases/download/v0.5.18/outrider-v0.5.18-x86_64-unknown-linux-gnu.tar.gz",
            },
          ],
        }),
      }),
  );

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    // Allow external api.github.com rate-limit responses without failing local static check
    if (res.status() >= 400 && !res.url().includes("api.github.com")) {
      badResponses.push(
        `${res.status()} ${res.request().method()} ${res.url()}`,
      );
    }
  });

  try {
    const res = await page.goto(pagesUrl);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Conduit — Agents Are Already Shopping/);

    // 1. Hero + 3 Interactive Medusa Illustrations + Bottom Light/Dark Switcher
    const landingRoot = page.getByTestId("conduit-landing-page");
    await expect(landingRoot).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Agents are already shopping\.\s*Usher them in without losing money\./,
      }),
    ).toBeVisible();
    await expect(page.locator("#hero-launch-console")).toContainText(
      "Open Control Plane",
    );
    await expect(page.locator("#hero-download-binary")).toContainText(
      "Download App",
    );

    for (const pillar of [
      { id: "#hero-pillar-browsing", title: "Buyers send agents first." },
      { id: "#hero-pillar-floor", title: "Every quote clears your floor." },
      { id: "#hero-pillar-checkout", title: "One pass. One charge." },
    ]) {
      await expect(page.locator(pillar.id)).toContainText(pillar.title);
    }

    // Verify all visible hero & preview images decoded cleanly and zero horizontal overflow
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          return (
            imgs.length >= 8 &&
            imgs.every((img) => img.complete && img.naturalWidth > 0) &&
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          );
        }),
      )
      .toBe(true);

    // Verify Light/Dark switcher lives in the footer (not top nav) and toggles cleanly
    await expect(page.locator("#nav-toggle-theme")).toHaveCount(0);
    await page.locator("footer").getByRole("radio", { name: "Light" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light");
    await page.locator("footer").getByRole("radio", { name: "Dark" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    await page.screenshot({
      path: path.join(SCRATCH_DIR, "conduit_www_landing.png"),
      fullPage: true,
    });

    // 2. Pillar 1 ("Buyers send agents first.") -> Full-Width Catalog Browsing (0px Right Column)
    await page.locator("#hero-pillar-browsing").click();
    await expect(page).toHaveURL(/view=console&scenario=discovery_95pct/);
    await expect(page.getByTestId("conduit-astryx-workbench")).toBeVisible();
    await expect(page.getByTestId("commercial-context-strip")).toContainText(
      "mcp.displayco.io",
    );
    await expect(page.getByTestId("canonical-inspector-panel")).toHaveCount(0);
    await expect(page.getByTestId("graph-node-D01")).toContainText(
      "Search Catalog",
    );

    // Return home via <- Home button
    await page.locator("#workbench-back-overview").click();
    await expect(page.getByTestId("conduit-landing-page")).toBeVisible();

    // 3. Primary Hero CTA ("Open Control Plane") -> Live Held Quote -> 1-Click Counter-Offer -> Issue Pass
    await page.locator("#hero-launch-console").click();
    await expect(page).toHaveURL(/view=console&scenario=live_hold_r02/);
    const workbench = page.getByTestId("conduit-astryx-workbench");
    await expect(workbench).toBeVisible();

    // Verify prototype clutter is gone (zero Theme picker, zero duplicate Hide quote approval button)
    await expect(workbench.getByText(/^Theme:/)).toHaveCount(0);
    await expect(
      workbench.getByRole("button", { name: /Hide quote approval/i }),
    ).toHaveCount(0);

    const inspector = page.getByTestId("canonical-inspector-panel");
    await expect(inspector).toContainText("Quote Approval");
    await expect(inspector).toContainText("Offers for agent-7f2");
    await expect(inspector).toContainText("SKU Margin Floor ($198.00)");

    // 1-click counter-offer transmission (zero 2-switch confirmation trap)
    await inspector
      .getByRole("button", { name: "Send $209 Offer (3)", exact: true })
      .click();

    // Inspector auto-advances to newly arrived C04 Checkout Pass Gate
    await expect(inspector).toContainText("Checkout Pass Gate");
    await expect(page.getByTestId("graph-node-C03")).toContainText(
      "Select Offer",
    );
    await expect(page.getByTestId("graph-node-C04")).toContainText(
      "Request Pass",
    );

    // Issue single-use pass -> settles C05 order
    await inspector
      .getByRole("button", { name: "Issue Pass ($209)", exact: true })
      .click();
    await expect(inspector).toContainText("Settled Order");
    await expect(page.getByTestId("graph-node-C05")).toContainText(
      "Confirm Order",
    );
    await expect(page.getByTestId("canonical-status-bar")).toContainText(
      "Fulfill · Order settled with single-use pass",
    );

    // Switch across Surfaces (Graph, Wire, Passes) and Peer Sessions (Skyport Air, Cloudstore)
    await workbench.getByText("Wire", { exact: true }).first().click();
    await expect(page.getByTestId("wire-surface")).toContainText(
      "Wire Evidence Capture",
    );

    await workbench.getByText("Passes", { exact: true }).first().click();
    const passesSurface = page.getByTestId("passes-surface");
    await expect(passesSurface).toContainText("pass_audioshop_signed");
    await passesSurface
      .getByRole("button", { name: "Revoke", exact: true })
      .first()
      .click();
    await expect(passesSurface).toContainText("Revoked");

    await workbench.getByText("Overview", { exact: true }).first().click();
    await workbench.getByText("Cloudstore", { exact: true }).first().click();
    await expect(page.getByTestId("canonical-inspector-panel")).toContainText(
      "Settled Order",
    );

    // Verify bottom Light/Dark mode switcher inside workbench footer
    await page
      .getByTestId("canonical-status-bar")
      .getByRole("radio", { name: "Light" })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light");
    await page
      .getByTestId("canonical-status-bar")
      .getByRole("radio", { name: "Dark" })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    // =========================================================================
    // 4. Mobile 390x844 Full-Width Landing + BottomSheet Control Plane
    // =========================================================================
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pagesUrl);
    await expect(page.getByTestId("conduit-landing-page")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, "conduit_www_mobile_hero.png"),
      fullPage: false,
    });

    await page.locator("#hero-launch-console").click();
    await expect(page.getByTestId("conduit-astryx-workbench")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, "conduit_www_mobile_overview.png"),
      fullPage: false,
    });

    // Open mobile BottomSheet -> Send $209 Counter-Offer -> Issue Pass ($209)
    await page
      .getByRole("button", { name: "Review held quote", exact: true })
      .click();
    const mobileSheet = page.getByTestId("canonical-inspector-panel");
    await expect(mobileSheet).toBeVisible();
    await page.screenshot({
      path: path.join(SCRATCH_DIR, "conduit_www_mobile_approve.png"),
      fullPage: false,
    });
    await mobileSheet
      .getByRole("button", { name: "Send $209 Offer (3)", exact: true })
      .click();
    await expect(mobileSheet).toContainText("Checkout Pass Gate");
    await mobileSheet
      .getByRole("button", { name: "Issue Pass ($209)", exact: true })
      .click();
    await expect(mobileSheet).toContainText("Settled Order");
    await mobileSheet
      .getByRole("button", { name: "Close", exact: true })
      .click();

    // Switch mobile surface tabs (Wire & Passes) with zero horizontal overflow
    await page.getByRole("radio", { name: "Wire" }).click();
    await expect(page.getByTestId("wire-surface")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.getByRole("radio", { name: "Passes" }).click();
    await expect(page.getByTestId("passes-surface")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

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
