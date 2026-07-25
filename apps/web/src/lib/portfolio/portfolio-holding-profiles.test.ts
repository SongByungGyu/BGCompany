import assert from "node:assert/strict";
import test from "node:test";
import {
  dividendFrequencyMultiplier,
  getPortfolioHoldingProfile,
  getPortfolioHoldingProfiles,
} from "./portfolio-holding-profiles.ts";

test("12개 운영 보유종목 프로필은 중복 없이 공식 출처를 가진다", () => {
  const profiles = getPortfolioHoldingProfiles();
  assert.equal(profiles.length, 12);
  assert.equal(new Set(profiles.map((profile) => `${profile.market}:${profile.symbol}`)).size, 12);
  for (const profile of profiles) {
    assert.match(profile.dividend.sourceUrl, /^https:\/\//);
    assert.notEqual(profile.sector, "미분류");
    assert.ok(profile.analysis.length >= 30);
  }
});

test("레버리지·인컴 상품을 ETF로 분류한다", () => {
  for (const symbol of ["ARKX", "KORU", "QLD", "QQQI", "RAM", "SOXL", "SSO", "ULTY"]) {
    assert.equal(getPortfolioHoldingProfile("US", symbol)?.assetType, "ETF");
  }
});

test("배당 주기별 연환산 배수를 제공한다", () => {
  assert.equal(dividendFrequencyMultiplier("weekly"), 52);
  assert.equal(dividendFrequencyMultiplier("monthly"), 12);
  assert.equal(dividendFrequencyMultiplier("quarterly"), 4);
  assert.equal(dividendFrequencyMultiplier("irregular"), 1);
});
