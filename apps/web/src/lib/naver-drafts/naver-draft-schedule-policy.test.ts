import test from "node:test";
import assert from "node:assert/strict";
import {
  getNaverDraftLateTtlMinutes,
  isNaverDraftClaimDue,
  isNaverDraftPublishDue,
  isNaverDraftScheduleExpired,
  resolveNaverDraftSchedule,
} from "./naver-draft-schedule-policy.ts";

test("08:20 KST 공개 작업은 15분 전부터만 로컬 에이전트가 가져간다", () => {
  const schedule = resolveNaverDraftSchedule({
    marketDate: "2026-08-21",
    scheduleSlot: "08:20",
    claimLeadMinutes: 15,
  });

  assert.equal(schedule?.publishNotBefore.toISOString(), "2026-08-20T23:20:00.000Z");
  assert.equal(schedule?.publishNotAfter.toISOString(), "2026-08-21T01:20:00.000Z");
  assert.equal(schedule?.claimAvailableAt.toISOString(), "2026-08-20T23:05:00.000Z");
  assert.equal(isNaverDraftClaimDue({ marketDate: "2026-08-21", scheduleSlot: "08:20" }, new Date("2026-08-20T23:04:59Z")), false);
  assert.equal(isNaverDraftClaimDue({ marketDate: "2026-08-21", scheduleSlot: "08:20" }, new Date("2026-08-20T23:05:00Z")), true);
  assert.equal(isNaverDraftPublishDue({ marketDate: "2026-08-21", scheduleSlot: "08:20" }, new Date("2026-08-20T23:19:59Z")), false);
  assert.equal(isNaverDraftPublishDue({ marketDate: "2026-08-21", scheduleSlot: "08:20" }, new Date("2026-08-20T23:20:00Z")), true);
});

test("예약 필드가 없는 수동 작업은 즉시 처리한다", () => {
  assert.equal(resolveNaverDraftSchedule({ marketDate: null, scheduleSlot: null }), null);
  assert.equal(isNaverDraftClaimDue({ marketDate: null, scheduleSlot: null }), true);
  assert.equal(isNaverDraftPublishDue({ marketDate: null, scheduleSlot: null }), true);
  assert.equal(isNaverDraftScheduleExpired({ marketDate: null, scheduleSlot: null }), false);
});

test("예약 글은 기본 120분이 지나면 만료되고 TTL은 안전 범위로 제한한다", () => {
  const input = { marketDate: "2026-08-21", scheduleSlot: "08:20" };
  assert.equal(isNaverDraftScheduleExpired(input, new Date("2026-08-21T01:20:00Z")), false);
  assert.equal(isNaverDraftScheduleExpired(input, new Date("2026-08-21T01:20:01Z")), true);
  assert.equal(getNaverDraftLateTtlMinutes("1"), 15);
  assert.equal(getNaverDraftLateTtlMinutes("99999"), 1440);
});
