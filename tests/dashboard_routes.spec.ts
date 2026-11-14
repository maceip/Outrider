import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const binary = path.join(root, "target/debug/proxyfor");
const upstreamBinary = path.join(root, "target/debug/outrider");
const model = process.env.OUTRIDER_CLEF_MODEL;

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
  throw new Error("Timed out waiting for runtime: " + String(last));
}

async function port() {
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

async function sendProxiedRequest(proxyPort: number, targetUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: targetUrl,
        headers: { Host: new URL(targetUrl).host },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function start(withModel = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "outrider-routes-"));
  const p = await port();
  const url = `http://127.0.0.1:${p}`;
  const env = { ...process.env };
  delete env.OUTRIDER_CLEF_MODEL;
  delete env.OUTRIDER_DASHBOARD_DIR;

  const echoServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, source: "local-echo" }));
  });
  await new Promise<void>((r) => echoServer.listen(0, "127.0.0.1", r));
  const echoPort = (echoServer.address() as net.AddressInfo).port;

  const args = [
    "--web",
    "--listen",
    `127.0.0.1:${p}`,
    "--config-dir",
    dir,
    "--db",
    path.join(dir, "db.sqlite"),
    "--probe-policy",
    "on-request",
  ];
  if (withModel) args.push("--clef-model", model!);

  const server = spawn(binary, args, { cwd: root, env, stdio: "ignore" });
  await poll(
    () => fetch(url + "/__proxyfor__/commerce/status").then((r) => r.status),
    (s) => s === 200,
  );
  const token = (
    await readFile(path.join(dir, "outrider-admin-token"), "utf8")
  ).trim();

  const ready = path.join(dir, "client-ready");
  const clientEnv = { ...env, OUTRIDER_CLIENT_READY: ready };
  const client = spawn(
    path.join(root, "target/debug/examples/commerce_live_client"),
    [url + "/mcp"],
    { cwd: root, env: clientEnv, stdio: "ignore" },
  );
  await poll(
    () => readFile(ready, "utf8"),
    (s) => s.length > 0,
  );

  // Record one real forward-proxy HTTP exchange into SQLite proxy_traffic.
  await sendProxiedRequest(
    p,
    `http://127.0.0.1:${echoPort}/proxy-evidence-check`,
  );

  return {
    dir,
    port: p,
    echoPort,
    url,
    token,
    db: path.join(dir, "db.sqlite"),
    async close() {
      await new Promise<void>((r) => echoServer.close(() => r()));
      for (const child of [client, server]) {
        child.kill("SIGINT");
        await Promise.race([
          new Promise((r) => child.once("exit", r)),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
        child.kill("SIGKILL");
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function attachPageGuards(page: Page) {
  const errors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    if (!err.includes("ERR_ABORTED") && !err.includes("NS_BINDING_ABORTED")) {
      errors.push(r.url() + ": " + err);
    }
  });
  page.on("response", (r) => {
    if (r.status() >= 400) {
      unexpectedResponses.push(r.url() + " " + r.status());
    }
  });
  return { errors, unexpectedResponses };
}

function kpiValue(page: Page, title: string) {
  return page
    .locator('[data-slot="kpi"]')
    .filter({
      has: page.locator('[data-slot="kpi-title"]', {
        hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      }),
    })
    .locator('[data-slot="kpi-value"]');
}

async function navigateSidebar(page: Page, label: string) {
  const item = page
    .locator('[data-slot="sidebar"] [data-slot="sidebar-menu-item"]')
    .filter({ hasText: label });
  await item.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
  await expect(item).toHaveAttribute("aria-current", "page");
}

test("HeroUI Pro routes exercise real commerce, evidence, audit, settings, and certificate substrates", async ({
  page,
  request,
}) => {
  const app = await start(false);
  const { errors, unexpectedResponses } = attachPageGuards(page);

  try {
    // 1. Sidebar Navigation, Shell, Lock Session -> Re-unlock
    await page.goto(app.url + "/__proxyfor__/");
    await expect(page.locator(".brand")).toHaveText("OUTRIDER");
    await expect(page.locator("#live")).toHaveText("Locked");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Overview",
    );

    await page.getByLabel("Admin token", { exact: true }).fill(app.token);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator("#live")).toHaveText("Live");

    for (const label of [
      "Commerce & Receipts",
      "Sessions & Evidence",
      "CLEF & Telemetry",
      "Gateway Settings",
      "Certificates & Protocol",
      "Overview",
    ]) {
      await navigateSidebar(page, label);
    }

    const lockItem = page
      .locator('[data-slot="sidebar"] [data-slot="sidebar-menu-item"]')
      .filter({ hasText: "Lock Session" });
    await expect(lockItem).toBeVisible();
    await lockItem.click();

    await expect(page.locator("#live")).toHaveText("Locked");
    await expect(lockItem).toHaveCount(0);
    await expect(page.getByLabel("Admin token", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Put Bundle", exact: true }).first(),
    ).toBeDisabled();

    await page.getByLabel("Admin token", { exact: true }).fill(app.token);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator("#live")).toHaveText("Live");
    await expect(lockItem).toBeVisible();

    // 2. Commerce & Receipts (/orders)
    await navigateSidebar(page, "Commerce & Receipts");
    await expect(kpiValue(page, "Bundles")).toHaveText("0");
    await expect(kpiValue(page, "Capability Receipts")).toHaveText("0");

    await page
      .locator("main")
      .getByRole("button", { name: "Put Bundle", exact: true })
      .first()
      .click();
    const dialog = page.locator("#action-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Bundle ID", { exact: true }).fill("ops-suite");
    await dialog
      .getByLabel("Bundle title", { exact: true })
      .fill("Operator Diagnostic Bundle");
    await dialog
      .getByLabel("Catalog items", { exact: true })
      .fill("outrider_session_evidence");
    await dialog.getByLabel("Rules JSON", { exact: true }).fill("{}");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    const bundleRows = query(
      app.db,
      "SELECT bundle_id, title FROM bundles WHERE bundle_id='ops-suite'",
    );
    expect(bundleRows).toHaveLength(1);
    expect(bundleRows[0].title).toBe("Operator Diagnostic Bundle");
    await expect(kpiValue(page, "Bundles")).toHaveText("1");

    await page
      .locator("main")
      .getByRole("button", { name: "Issue Receipt", exact: true })
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel("Subject", { exact: true }),
    ).not.toHaveValue("");
    await dialog.getByLabel("Maximum calls", { exact: true }).fill("4");
    await dialog
      .getByLabel("Expiry (Unix seconds)", { exact: true })
      .fill(String(Math.floor(Date.now() / 1000) + 900));
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    const receiptRows = query(
      app.db,
      "SELECT receipt_id, bundle_id, remaining_calls, revoked FROM capability_receipts",
    );
    expect(receiptRows).toHaveLength(1);
    const receiptId = String(receiptRows[0].receipt_id);
    expect(receiptRows[0].bundle_id).toBe("ops-suite");
    expect(receiptRows[0].remaining_calls).toBe(4);
    expect(receiptRows[0].revoked).toBe(0);

    await expect(kpiValue(page, "Capability Receipts")).toHaveText("1");
    const receiptsGrid = page.getByRole("grid", {
      name: "Capability receipts",
    });
    await expect(receiptsGrid).toContainText("ops-suite");
    await expect(receiptsGrid).toContainText("Ed25519 verified");

    const commerceInspector = page.locator(
      '[aria-label="Selected commerce payload"]',
    );
    await expect(commerceInspector).toContainText("Ed25519 verified");
    await expect(commerceInspector.locator("pre")).toContainText(receiptId);

    // SearchField + Status Dropdown filtering on Receipts
    const commerceSearch = page.getByLabel("Search commerce records");
    await commerceSearch.fill("nonexistent-bundle-id");
    await expect(receiptsGrid).toContainText(
      "No capability receipts match the active search or status filter.",
    );
    await commerceSearch.fill("");
    await expect(receiptsGrid).toContainText("ops-suite");

    await page.getByRole("button", { name: "Filter commerce status" }).click();
    await page.getByRole("menuitem", { name: "Revoked", exact: true }).click();
    await expect(receiptsGrid).toContainText(
      "No capability receipts match the active search or status filter.",
    );

    await page.getByRole("button", { name: "Filter commerce status" }).click();
    await page
      .getByRole("menuitem", { name: "Ed25519 verified", exact: true })
      .click();
    await expect(receiptsGrid).toContainText("ops-suite");

    await page.getByRole("button", { name: "Filter commerce status" }).click();
    await page.getByRole("menuitem", { name: "All", exact: true }).click();
    await expect(receiptsGrid).toContainText("ops-suite");

    // Segment switching across Bundles & Catalog, Offers & Quotes, Redemptions, Receipts
    const commerceSegment = page.locator(
      '[aria-label="Commerce record segment"]',
    );
    await commerceSegment
      .locator('[data-slot="segment-item"]', { hasText: "Bundles & Catalog" })
      .click();
    const bundlesGrid = page.getByRole("grid", {
      name: "Bundles and catalog items",
    });
    await expect(bundlesGrid).toContainText("ops-suite");
    await expect(bundlesGrid).toContainText("outrider_session_evidence");
    await page
      .getByRole("button", { name: "Inspect payload ops-suite" })
      .click();
    await expect(commerceInspector.locator("pre")).toContainText(
      "Operator Diagnostic Bundle",
    );

    await commerceSegment
      .locator('[data-slot="segment-item"]', { hasText: "Offers & Quotes" })
      .click();
    await expect(
      page.getByRole("grid", { name: "Session offers and MRTR quotes" }),
    ).toBeVisible();

    await commerceSegment
      .locator('[data-slot="segment-item"]', { hasText: "Redemptions" })
      .click();
    await expect(
      page.getByRole("grid", { name: "Receipt redemptions" }),
    ).toBeVisible();

    await commerceSegment
      .locator('[data-slot="segment-item"]', { hasText: "Receipts" })
      .click();
    await expect(receiptsGrid).toContainText("Ed25519 verified");

    // Revoke Receipt row action -> SQLite revoked = 1
    const revokeBtn = page.getByRole("button", {
      name: `Revoke receipt ${receiptId.slice(0, 10)}`,
      exact: true,
    });
    await revokeBtn.click();
    await expect
      .poll(
        () =>
          query(
            app.db,
            "SELECT revoked FROM capability_receipts WHERE receipt_id = '" +
              receiptId +
              "'",
          )[0]?.revoked,
      )
      .toBe(1);
    await expect(receiptsGrid).toContainText("Revoked");
    await expect(kpiValue(page, "Capability Receipts")).toHaveText("0");
    await expect(revokeBtn).toBeDisabled();

    // 3. Sessions & Evidence (/tracker)
    await navigateSidebar(page, "Sessions & Evidence");
    const dbSessionCount = Number(
      query(app.db, "SELECT COUNT(*) AS n FROM agent_sessions")[0].n,
    );
    expect(dbSessionCount).toBe(1);
    await expect(kpiValue(page, "Unprobed")).toHaveText("1");
    await expect(kpiValue(page, "Probed")).toHaveText("0");
    await expect(kpiValue(page, "CLEF Evaluated")).toHaveText("0");
    await expect(kpiValue(page, "Entitled")).toHaveText("0");

    const trackerInspector = page.locator(
      '[aria-label="Session action and JSON inspector"]',
    );
    const sessionsGrid = page.getByRole("grid", {
      name: "Recorded agent sessions",
    });
    await expect(sessionsGrid).toContainText("Outrider live validation client");
    await sessionsGrid
      .getByRole("button", { name: /^Inspect session / })
      .first()
      .click();
    await expect(trackerInspector.locator("pre")).toContainText(
      "Outrider live validation client",
    );

    // Synthesize Offer -> SQLite session_offers row
    await trackerInspector
      .getByRole("button", { name: "Synthesize Offer", exact: true })
      .click();
    await expect
      .poll(
        () =>
          Number(query(app.db, "SELECT COUNT(*) AS n FROM session_offers")[0].n),
      )
      .toBe(1);
    expect(query(app.db, "SELECT bundle_id FROM session_offers")[0].bundle_id).toBe(
      "ops-suite",
    );

    // Segment switching across Observations, Probe Runs, MCP Frames, Proxy HTTP / WS Traffic
    const evidenceSegment = page.locator(
      '[aria-label="Evidence substrate segment"]',
    );
    await evidenceSegment
      .locator('[data-slot="segment-item"]', {
        hasText: "Fingerprint Observations",
      })
      .click();
    const obsGrid = page.getByRole("grid", {
      name: "Fingerprint observations",
    });
    await expect(obsGrid).toContainText("mcp_request");
    await obsGrid
      .getByRole("button", { name: /^Inspect observation / })
      .first()
      .click();
    await expect(trackerInspector.locator("pre")).toContainText(
      "observation_id",
    );

    await evidenceSegment
      .locator('[data-slot="segment-item"]', { hasText: "Probe Runs" })
      .click();
    await expect(
      page.getByRole("grid", { name: "Active capability probe runs" }),
    ).toBeVisible();

    await evidenceSegment
      .locator('[data-slot="segment-item"]', { hasText: "MCP Frames" })
      .click();
    const framesGrid = page.getByRole("grid", {
      name: "Persisted MCP protocol frames",
    });
    await expect(framesGrid).toContainText("initialize");
    await framesGrid
      .getByRole("button", { name: /^Inspect frame / })
      .first()
      .click();
    await expect(trackerInspector.locator("pre")).toContainText("frame_id");

    await evidenceSegment
      .locator('[data-slot="segment-item"]', {
        hasText: "Proxy HTTP / WS Traffic",
      })
      .click();
    const trafficGrid = page.getByRole("grid", {
      name: "Proxy HTTP and WebSocket traffic",
    });
    await expect(trafficGrid).toContainText("/proxy-evidence-check");
    await trafficGrid
      .getByRole("button", { name: /^Inspect traffic / })
      .first()
      .click();
    await expect(trackerInspector.locator("pre")).toContainText(
      "/proxy-evidence-check",
    );

    // Verify synthesized offer also appears on /orders Offers & Quotes segment
    await navigateSidebar(page, "Commerce & Receipts");
    await expect(kpiValue(page, "Session Offers")).toHaveText("1");
    await page
      .locator('[aria-label="Commerce record segment"]')
      .locator('[data-slot="segment-item"]', { hasText: "Offers & Quotes" })
      .click();
    await expect(
      page.getByRole("grid", { name: "Session offers and MRTR quotes" }),
    ).toContainText("ops-suite");

    // 4. CLEF & Telemetry (/analytics)
    await navigateSidebar(page, "CLEF & Telemetry");
    const expectedAuditCount = Number(
      query(app.db, "SELECT COUNT(*) AS n FROM admin_audit_log")[0].n,
    );
    expect(expectedAuditCount).toBeGreaterThanOrEqual(4);
    await expect(kpiValue(page, "Admin Audit Events")).toHaveText(
      String(expectedAuditCount),
    );
    await expect(kpiValue(page, "Verified CLEF Evals")).toHaveText("0");

    const telemetrySegment = page.locator('[aria-label="Telemetry scope"]');
    await telemetrySegment
      .locator('[data-slot="segment-item"]', { hasText: /^CLEF$/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "CLEF Evaluation Inspector" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Admin Audit Log" }),
    ).toHaveCount(0);

    await telemetrySegment
      .locator('[data-slot="segment-item"]', { hasText: /^Audit$/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admin Audit Log" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "CLEF Evaluation Inspector" }),
    ).toHaveCount(0);

    await telemetrySegment
      .locator('[data-slot="segment-item"]', { hasText: /^All$/ })
      .click();
    const auditGrid = page.getByRole("grid", { name: "Admin audit log" });
    await expect(auditGrid).toBeVisible();

    // Action dropdown filter + SearchField on admin_audit_log DataGrid
    await page.getByRole("button", { name: /All actions/ }).click();
    await page
      .getByRole("menuitem", { name: "receipt.revoke", exact: true })
      .click();
    await expect(auditGrid).toContainText("receipt.revoke");
    await expect(auditGrid).not.toContainText("bundle.put");

    await page.getByRole("button", { name: /receipt\.revoke/ }).click();
    await page
      .getByRole("menuitem", { name: "All actions", exact: true })
      .click();

    const auditSearch = page.getByLabel("Search admin audit log");
    await auditSearch.fill("ops-suite");
    await expect(auditGrid).toContainText("bundle.put");
    await auditGrid
      .getByRole("button", { name: "Inspect audit details for bundle.put" })
      .first()
      .click();
    await expect(page.locator("section pre")).toContainText("ops-suite");
    await auditSearch.fill("");

    // 5. Gateway Settings (/settings)
    await navigateSidebar(page, "Gateway Settings");
    await expect(page.locator("main")).toContainText(
      "Persisted gateway policy: on-request",
    );

    // Probe policy transitions: on-request -> off -> auto
    for (const nextPolicy of ["off", "auto"] as const) {
      await page.getByRole("button", { name: /Probe policy/ }).click();
      await page
        .locator('[role="option"]')
        .filter({
          has: page.locator("span.font-mono", {
            hasText: new RegExp(`^${nextPolicy}$`),
          }),
        })
        .click();
      await page
        .getByRole("button", { name: "Save Policy", exact: true })
        .click();

      await expect
        .poll(async () => {
          const res = await request.get(
            app.url + "/__proxyfor__/commerce/status",
          );
          const body = (await res.json()) as { probe_policy: string };
          return body.probe_policy;
        })
        .toBe(nextPolicy);

      await expect(page.locator("main")).toContainText(
        `Persisted gateway policy: ${nextPolicy}`,
      );
    }

    const policyAudits = query(
      app.db,
      "SELECT details FROM admin_audit_log WHERE action='probe_policy.set' ORDER BY rowid ASC",
    );
    expect(policyAudits).toHaveLength(2);
    expect(String(policyAudits[0].details)).toContain('"off"');
    expect(String(policyAudits[1].details)).toContain('"auto"');

    // Skill Catalog Directory: load temp SKILL.md -> SQLite catalog_items kind='skill'
    const skillsDir = path.join(app.dir, "skills-catalog");
    await mkdir(path.join(skillsDir, "incident-triage"), { recursive: true });
    await writeFile(
      path.join(skillsDir, "incident-triage", "SKILL.md"),
      "---\nname: incident-triage\ndescription: Inspect session evidence and capability receipts\n---\n\n# Incident Triage\n",
      "utf8",
    );

    const loadSkillsBtn = page.getByRole("button", {
      name: "Load Skills",
      exact: true,
    });
    await expect(loadSkillsBtn).toBeDisabled();
    await page
      .getByLabel("Skills directory path", { exact: true })
      .fill(skillsDir);
    await expect(loadSkillsBtn).toBeEnabled();
    await loadSkillsBtn.click();

    await expect
      .poll(
        () =>
          query(
            app.db,
            "SELECT item_id FROM catalog_items WHERE kind='skill'",
          ).length,
      )
      .toBe(1);
    expect(
      query(app.db, "SELECT item_id FROM catalog_items WHERE kind='skill'")[0]
        .item_id,
    ).toBe("skill://incident-triage/SKILL.md");
    await expect(page.locator("main")).toContainText(
      "1 skill descriptor(s) currently persisted in catalog_items.",
    );

    // Connect Upstream validation + real stdio upstream connection on /settings
    await page
      .locator("main")
      .getByRole("button", { name: "Connect Upstream", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Upstream name and command or HTTP URL are required.",
    );

    await dialog
      .getByLabel("Upstream name", { exact: true })
      .fill("settings-live");
    await dialog
      .getByLabel("Command or HTTP URL", { exact: true })
      .fill(
        `${upstreamBinary} --stdio --probe-policy off --config-dir ${path.join(app.dir, "child-settings")}`,
      );
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    expect(
      query(
        app.db,
        "SELECT status FROM upstream_servers WHERE name='settings-live'",
      )[0]?.status,
    ).toBe("Connected");
    await expect(
      page.locator('[aria-label="Persisted upstream MCP servers"]'),
    ).toContainText("settings-live");

    // 6. Certificates & Protocol (/help)
    await navigateSidebar(page, "Certificates & Protocol");
    const expectedHrefs = [
      "/__proxyfor__/certificate/proxyfor-ca-cert.pem",
      "/__proxyfor__/certificate/proxyfor-ca-cert.cer",
      "/__proxyfor__/certificate/",
      "/__proxyfor__/commerce/status",
    ] as const;

    for (const href of expectedHrefs) {
      await expect(page.locator(`main a[href="${href}"]`)).toBeVisible();
    }

    const pemRes = await request.get(app.url + expectedHrefs[0]);
    expect(pemRes.status()).toBe(200);
    expect(await pemRes.text()).toContain("-----BEGIN CERTIFICATE-----");

    const cerRes = await request.get(app.url + expectedHrefs[1]);
    expect(cerRes.status()).toBe(200);
    expect(await cerRes.text()).toContain("-----BEGIN CERTIFICATE-----");

    const guideRes = await request.get(app.url + expectedHrefs[2]);
    expect(guideRes.status()).toBe(200);
    expect(guideRes.headers()["content-type"]).toContain("text/html");
    expect(await guideRes.text()).toContain("proxyfor-ca-cert");

    const statusRes = await request.get(app.url + expectedHrefs[3]);
    expect(statusRes.status()).toBe(200);
    const statusJson = (await statusRes.json()) as {
      probe_policy: string;
      admin_allow_remote: boolean;
    };
    expect(statusJson.probe_policy).toBe("auto");
    expect(statusJson.admin_allow_remote).toBe(false);

    // Expand protocol Accordion items
    await expect(page.locator("main")).toContainText("RequestStateCodec");
    await page
      .getByRole("button", {
        name: "Ed25519 Capability Receipts & RFC 8785 JCS Verification",
      })
      .click();
    await expect(page.locator("main")).toContainText(
      "RFC 8785 JSON Canonicalization Scheme (JCS)",
    );

    await page
      .getByRole("button", {
        name: "Root CA Certificate Trust Store Installation",
      })
      .click();
    await expect(page.locator("main")).toContainText(
      "certutil.exe -addstore root proxyfor-ca-cert.cer",
    );

    expect(errors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});

test("HeroUI Pro analytics route inspects real CLEF model evaluation with option_scores: null", async ({
  page,
}) => {
  test.skip(
    !model,
    "OUTRIDER_CLEF_MODEL unset; real-model browser gate is skipped",
  );
  const app = await start(true);
  const { errors, unexpectedResponses } = attachPageGuards(page);

  try {
    await page.goto(app.url + "/__proxyfor__/");
    await page.getByLabel("Admin token", { exact: true }).fill(app.token);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator("#live")).toHaveText("Live");

    await navigateSidebar(page, "CLEF & Telemetry");
    await expect(kpiValue(page, "Verified CLEF Evals")).toHaveText("0");

    await page
      .locator("main")
      .getByRole("button", { name: "Run CLEF Eval", exact: true })
      .first()
      .click();
    const dialog = page.locator("#action-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });

    const evalRow = query(
      app.db,
      "SELECT evaluation_id, status, input_tokens, output_tokens, latency_ms, option_scores FROM clef_evaluations",
    )[0];
    expect(evalRow.status).toBe("Verified");
    expect(Number(evalRow.input_tokens)).toBeGreaterThan(0);
    expect(Number(evalRow.output_tokens)).toBeGreaterThan(0);
    expect(evalRow.option_scores).toBeNull();

    await expect(kpiValue(page, "Verified CLEF Evals")).toHaveText("1");
    const totalTokens =
      Number(evalRow.input_tokens) + Number(evalRow.output_tokens);
    await expect(kpiValue(page, "Total CLEF Tokens")).toHaveText(
      new Intl.NumberFormat("en-US").format(totalTokens),
    );

    const evalList = page.locator('[aria-label="Recorded CLEF evaluations"]');
    await expect(evalList).toBeVisible();
    await evalList.locator("button").first().click();

    await expect(page.locator("main")).toContainText(
      String(evalRow.evaluation_id),
    );
    await expect(page.locator("main")).toContainText(
      "null (not exposed by litert-lm-rust 0.2.4)",
    );
    await expect(page.locator('[class*="score-bar"]')).toHaveCount(0);

    await navigateSidebar(page, "Sessions & Evidence");
    await expect(kpiValue(page, "CLEF Evaluated")).toHaveText("1");

    expect(errors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});
