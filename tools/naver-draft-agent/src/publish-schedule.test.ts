import test from "node:test";
import assert from "node:assert/strict";
import {
  getScheduledPublishWaitMs,
  nextPublishHeartbeatDelay,
  PUBLISH_HEARTBEAT_INTERVAL_MS,
} from "./publish-schedule.js";

test("예약 공개 전에는 남은 시간을 계산하고 공개 시각 이후에는 기다리지 않는다", () => {
  const publishAt = "2026-08-20T23:20:00.000Z";
  assert.equal(getScheduledPublishWaitMs(publishAt, Date.parse("2026-08-20T23:19:00Z")), 60_000);
  assert.equal(getScheduledPublishWaitMs(publishAt, Date.parse("2026-08-20T23:20:00Z")), 0);
  assert.equal(getScheduledPublishWaitMs(publishAt, Date.parse("2026-08-20T23:21:00Z")), 0);
});

test("대기 중에는 30초마다 서버에 생존 상태를 갱신한다", () => {
  assert.equal(nextPublishHeartbeatDelay(120_000), PUBLISH_HEARTBEAT_INTERVAL_MS);
  assert.equal(nextPublishHeartbeatDelay(5_000), 5_000);
});
