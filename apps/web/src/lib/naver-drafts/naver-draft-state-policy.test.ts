import test from "node:test";
import assert from "node:assert/strict";
import {
  getNaverPublishingStaleMs,
  isAllowedNaverAgentTransition,
  isNaverDraftTerminalStatus,
  isNaverPublishingStale,
} from "./naver-draft-state-policy.ts";

test("terminal Naver states are immutable and are not agent transition sources", () => {
  for (const status of ["published", "publish_failed", "publish_blocked", "cancelled", "failed"]) {
    assert.equal(isNaverDraftTerminalStatus(status), true);
    assert.equal(isAllowedNaverAgentTransition(status, "in_progress"), false);
  }
});

test("only the guarded publish transition may leave publishing", () => {
  assert.equal(isAllowedNaverAgentTransition("publishing", "published"), true);
  assert.equal(isAllowedNaverAgentTransition("publishing", "publish_failed"), true);
  assert.equal(isAllowedNaverAgentTransition("publishing", "failed"), false);
  assert.equal(isAllowedNaverAgentTransition("publish_ready", "publishing"), false);
});

test("pre-publish writer progress follows an explicit transition table", () => {
  assert.equal(isAllowedNaverAgentTransition("claimed", "in_progress"), true);
  assert.equal(isAllowedNaverAgentTransition("in_progress", "image_uploading"), true);
  assert.equal(isAllowedNaverAgentTransition("image_uploading", "draft_saving"), true);
  assert.equal(isAllowedNaverAgentTransition("image_uploading", "user_publish_required"), true);
  assert.equal(isAllowedNaverAgentTransition("draft_saving", "publish_ready"), true);
  assert.equal(isAllowedNaverAgentTransition("in_progress", "published"), false);
});

test("stale publishing timeout is bounded and deterministic", () => {
  const now = new Date("2026-09-04T00:10:00.000Z");
  assert.equal(getNaverPublishingStaleMs("1"), 60_000);
  assert.equal(getNaverPublishingStaleMs("99999"), 3_600_000);
  assert.equal(isNaverPublishingStale(new Date("2026-09-04T00:05:00.000Z"), now, "300"), true);
  assert.equal(isNaverPublishingStale(new Date("2026-09-04T00:05:00.001Z"), now, "300"), false);
});
