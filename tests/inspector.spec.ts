import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const outrider = path.join(root, "target/debug/outrider");
const elicitationServer = path.join(
  root,
  "rust-sdk-main/target/debug/examples/servers_elicitation_stdio",
);

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
let server: ChildProcess, dir: string, url: string, token: string, db: string;
test.beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "outrider-inspector-"));
  const p = await port();
  url = `http://127.0.0.1:${p}`;
  db = path.join(dir, "db.sqlite");
  const env = { ...process.env };
  delete env.OUTRIDER_CLEF_MODEL;
  server = spawn(
    outrider,
    ["--web", "--listen", `127.0.0.1:${p}`, "--config-dir", dir, "--db", db],
    { cwd: root, env, stdio: "ignore" },
  );
  for (let i = 0; i < 200; i++) {
    const ok = await fetch(url + "/__proxyfor__/commerce/status")
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  token = (
    await readFile(path.join(dir, "outrider-admin-token"), "utf8")
  ).trim();
});
test.afterEach(async () => {
  server.kill();
  await rm(dir, { recursive: true, force: true });
});

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
async function unlock(page: Page) {
  await page.goto(url + "/__proxyfor__/inspector");
  await expect(page.getByRole("button", { name: "Connect" })).toBeDisabled();
  await page.getByLabel("Admin token").fill(token);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("#live")).toHaveText("Live");
}

test("wrong token is refused and nothing connects", async ({ page }) => {
  await page.goto(url + "/__proxyfor__/inspector");
  await page.getByLabel("Admin token").fill("not-the-token");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("#status")).toContainText("401");
  await expect(page.getByRole("button", { name: "Connect" })).toBeDisabled();
});

test("inspects this gateway over 2026-07-28 and resumes an MRTR probe", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await unlock(page);
  await page.getByRole("button", { name: "This gateway" }).click();
  await expect(page.getByLabel("Target")).toHaveValue(url + "/mcp");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator("#server-head")).toContainText(
    "protocol 2026-07-28",
  );
  await expect(page.locator("#server-head .badge")).toHaveCount(1);
  await expect(page.getByText("TOOLS (7)")).toBeVisible();
  expect(
    await page
      .locator("#connections .item.selected")
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toBe("none");
  const leftSplit = page.getByRole("separator", {
    name: "Resize connections pane",
  });
  const rightSplit = page.getByRole("separator", {
    name: "Resize activity pane",
  });
  const catalogSplit = page.getByRole("separator", {
    name: "Resize catalog list",
  });
  for (const sep of [leftSplit, rightSplit, catalogSplit]) {
    expect(await sep.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "ew-resize",
    );
  }
  const connBefore = (await page
    .locator('[aria-label="Connections"]')
    .boundingBox())!;
  const leftBox = (await leftSplit.boundingBox())!;
  await page.mouse.move(leftBox.x + 2, leftBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 48, leftBox.y + 100);
  await page.mouse.up();
  const connAfter = (await page
    .locator('[aria-label="Connections"]')
    .boundingBox())!;
  expect(connAfter.width).toBeGreaterThan(connBefore.width);
  await leftSplit.dblclick();
  const connReset = (await page
    .locator('[aria-label="Connections"]')
    .boundingBox())!;
  expect(Math.round(connReset.width)).toBe(Math.round(connBefore.width));
  const listBefore = (await page
    .locator(".split > div")
    .first()
    .boundingBox())!;
  const catBox = (await catalogSplit.boundingBox())!;
  await page.mouse.move(catBox.x + 2, catBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(catBox.x + 40, catBox.y + 80);
  await page.mouse.up();
  const listAfter = (await page.locator(".split > div").first().boundingBox())!;
  expect(listAfter.width).toBeGreaterThan(listBefore.width);
  const [conn] = query(db, "SELECT * FROM inspector_connections");
  expect(conn.status).toBe("Connected");
  expect(conn.header_names).toBe('["Outrider-Session-Id"]');

  // The gateway probes a sampling-capable client on its first tools/call.
  await page.locator(".item", { hasText: "outrider_fingerprint_me" }).click();
  await page.getByRole("button", { name: "Run tool" }).click();
  await expect(
    page.getByText("INPUT REQUIRED · MULTI ROUND-TRIP"),
  ).toBeVisible();
  await page.getByLabel("Sampling reply").fill('{"ack":"outrider"}');
  for (const name of ["sla_tier", "bundle_preference"]) {
    const field = page.locator(`[aria-label="${name}"]`);
    if ((await field.evaluate((e) => e.tagName)) === "SELECT")
      await field.selectOption({ index: 1 });
    else await field.fill("standard");
  }
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pane")).toContainText(
    "header_names_in_wire_order",
  );

  // The gateway recorded the inspector as an agent session with a completed probe.
  const probes = query(db, "SELECT status FROM probe_runs");
  expect(probes.some((p) => p.status === "Completed")).toBe(true);
  const sessions = query(db, "SELECT client_config FROM agent_sessions");
  expect(
    sessions.some((s) =>
      String(s.client_config).includes("Outrider MCP Inspector"),
    ),
  ).toBe(true);

  // History rows are the persisted messages, and Replay re-sends one.
  const before = query(db, "SELECT COUNT(*) AS n FROM inspector_messages")[0]
    .n as number;
  await page
    .locator("#history .msg", { hasText: "tools/list" })
    .filter({ hasText: "request" })
    .first()
    .click();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator("#status")).toContainText("tools/list → ok");
  const after = query(db, "SELECT COUNT(*) AS n FROM inspector_messages")[0]
    .n as number;
  expect(after).toBe(before + 2);

  // Raw JSON-RPC: a server error is shown as an error.
  await page.getByRole("button", { name: "RAW JSON-RPC" }).click();
  await page.getByLabel("Method").fill("prompts/get");
  await page.getByLabel("Params JSON").fill('{"name":"missing"}');
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator("#pane .banner.bad")).toBeVisible();
  const last = query(
    db,
    "SELECT kind FROM inspector_messages ORDER BY message_id DESC LIMIT 1",
  )[0];
  expect(last.kind).toBe("error");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator("#server-head")).toContainText("Not live");
  expect(query(db, "SELECT status FROM inspector_connections")[0].status).toBe(
    "Disconnected",
  );
  await expect(page.getByRole("button", { name: "Ping" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("answers a legacy server's elicitation request by hand", async ({
  page,
}) => {
  test.skip(
    !existsSync(elicitationServer),
    "Build it first: cargo build --manifest-path rust-sdk-main/Cargo.toml -p mcp-server-examples --example servers_elicitation_stdio",
  );
  const errors = watchErrors(page);
  await unlock(page);
  await page.getByLabel("Transport").selectOption("stdio");
  await page.getByLabel("Target").fill(elicitationServer);
  await page.getByLabel("Lifecycle").selectOption("initialize");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator("#server-head")).toContainText(
    "protocol 2025-11-25",
  );
  await page.locator(".item", { hasText: "greet_user" }).click();
  await page.getByRole("button", { name: "Run tool" }).click();
  await expect(page.locator("#status")).toContainText("greeting is required");
  await page.locator('#pane [aria-label="greeting"]').fill("Hello");
  await page.getByRole("button", { name: "Run tool" }).click();
  await expect(page.locator("#pending-count")).toHaveText("1 waiting");
  expect(
    query(db, "SELECT status FROM inspector_server_requests")[0].status,
  ).toBe("Pending");
  await page.locator('#server-requests [aria-label="name"]').fill("Ada");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.locator("#pane")).toContainText("Hello Ada!");
  const [req] = query(
    db,
    "SELECT status, response FROM inspector_server_requests",
  );
  expect(req.status).toBe("Answered");
  expect(JSON.parse(String(req.response))).toEqual({
    action: "accept",
    content: { name: "Ada" },
  });
  expect(errors).toEqual([]);
});
