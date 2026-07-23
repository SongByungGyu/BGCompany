import assert from "node:assert/strict";
import test from "node:test";
import { isPortfolioMonitoringEnabled } from "./portfolio-feature-flags.ts";

test("기능 플래그는 기본 OFF이며 명시적인 true에서만 켜진다", () => {
  assert.equal(isPortfolioMonitoringEnabled({}), false);
  assert.equal(isPortfolioMonitoringEnabled({ PORTFOLIO_MONITORING_ENABLED: "false" }), false);
  assert.equal(isPortfolioMonitoringEnabled({ PORTFOLIO_MONITORING_ENABLED: "TRUE" }), false);
  assert.equal(isPortfolioMonitoringEnabled({ PORTFOLIO_MONITORING_ENABLED: "true" }), true);
});

