import test from "node:test";
import assert from "node:assert/strict";
import {
  largeCapEventsToReferenceItems,
  scanLargeCapDisclosureEvents,
} from "./large-cap-disclosure-monitor.ts";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("DART 키가 없어도 SEC 감지는 계속 동작한다", async () => {
  const result = await scanLargeCapDisclosureEvents({
    now: new Date("2026-08-08T12:00:00Z"),
    dartApiKey: "",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) return jsonResponse({});
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(result.providers.openDart, "missing_key");
  assert.equal(result.providers.secEdgar, "ready");
  assert.deepEqual(result.events, []);
});

test("OpenDART 대형주 중요 공시는 공식 이벤트로 변환한다", async () => {
  const result = await scanLargeCapDisclosureEvents({
    now: new Date("2026-08-08T12:00:00Z"),
    dartApiKey: "test-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("opendart.fss.or.kr")) {
        return jsonResponse({
          status: "000",
          list: [
            { corp_name: "삼성전자", report_nm: "연결재무제표기준영업(잠정)실적", rcept_no: "20260808000123", rcept_dt: "20260808" },
            { corp_name: "소형테스트", report_nm: "영업(잠정)실적", rcept_no: "20260808000456", rcept_dt: "20260808" },
          ],
        });
      }
      if (url.includes("company_tickers.json")) return jsonResponse({});
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.company, "삼성전자");
  assert.equal(result.events[0]?.eventType, "earnings");
  assert.match(result.events[0]?.sourceUrl ?? "", /dart\.fss\.or\.kr/);
});

test("SEC 대형주 10-Q와 중요한 8-K만 감지한다", async () => {
  const tickerPayload = {
    0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  };
  const result = await scanLargeCapDisclosureEvents({
    now: new Date("2026-08-08T12:00:00Z"),
    dartApiKey: "",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) return jsonResponse(tickerPayload);
      if (url.includes("submissions/CIK0000320193.json")) {
        return jsonResponse({
          name: "Apple Inc.",
          filings: {
            recent: {
              accessionNumber: ["0000320193-26-000001", "0000320193-26-000002", "0000320193-26-000003"],
              filingDate: ["2026-08-08", "2026-08-08", "2026-08-08"],
              form: ["10-Q", "8-K", "8-K"],
              primaryDocument: ["aapl-20260808.htm", "aapl-8k.htm", "aapl-other.htm"],
              items: ["", "2.02,9.01", "5.02"],
            },
          },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every((event) => event.sourceName === "SEC EDGAR"));
  assert.ok(result.events.some((event) => event.title.includes("10-Q")));
  assert.ok(result.events.some((event) => event.title.includes("8-K")));
  const references = largeCapEventsToReferenceItems(result.events);
  assert.ok(references.every((item) => item.reliability === "official" && item.sourceType === "disclosure"));
});
