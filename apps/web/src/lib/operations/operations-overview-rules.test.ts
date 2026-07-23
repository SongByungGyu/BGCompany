import assert from "node:assert/strict";
import test from "node:test";
import { getKstDayWindow, getServiceOverallStatus } from "./operations-overview-rules";
import type { OperationsService } from "./operations-overview-types";

test("KST day window crosses the UTC date boundary correctly", () => {
  const window = getKstDayWindow(new Date("2026-07-22T23:45:00.000Z"));
  assert.equal(window.date, "2026-07-23");
  assert.equal(window.start.toISOString(), "2026-07-22T15:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-07-23T15:00:00.000Z");
});

test("service status prioritizes critical, then warning", () => {
  const make = (status: OperationsService["status"]): OperationsService => ({ id: status, name: status, status, label: status, detail: status, checkedAt: "2026-07-23T00:00:00.000Z" });
  assert.equal(getServiceOverallStatus([make("healthy"), make("warning")]), "warning");
  assert.equal(getServiceOverallStatus([make("healthy"), make("critical")]), "critical");
  assert.equal(getServiceOverallStatus([make("idle")]), "idle");
});
