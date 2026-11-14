import assert from "node:assert/strict";
import test from "node:test";
import { simulatedDay } from "../src/lib/simulated-day.ts";

test("2026-11-14 Chicago seed matches the published demo counts", () => {
  const day = simulatedDay("2026-11-14");
  assert.equal(day.date, "2026-11-14");
  assert.equal(day.total, 1514);
  assert.equal(day.letThrough, 1136);
  assert.equal(day.askedToVerify + day.blocked + day.letThrough, day.total);
});
