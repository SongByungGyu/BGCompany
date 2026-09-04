import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeStockBlogBody,
  inspectStockBlogQaStructuralAudit,
  inspectStockBlogSourceContract,
  inspectStockBlogTailContract,
  STOCK_BLOG_CANONICAL_SOURCE_COUNT,
} from "./canonical-stock-blog-body.ts";
import { KIS_SECTOR_DEGRADED_DISCLOSURE } from "./references/kis-sector-degraded-policy.ts";
import {
  FRED_DEGRADED_DISCLOSURE,
  FRED_DEGRADED_LEGACY_DISCLOSURES,
} from "./references/fred-degraded-policy.ts";
import type {
  MarketSnapshot,
  ReferenceItem,
  StockReferenceBriefingTemplate,
} from "./references/reference-types.ts";
import { STOCK_BLOG_INVESTMENT_DISCLAIMER } from "./stock-blog-editorial-policy.ts";

const references: ReferenceItem[] = Array.from({ length: 5 }, (_, index) => ({
  id: `reference-${index + 1}`,
  sourceType: index < 3 ? "news" : "market_data",
  provider: "naver-search",
  publisher: `발행처 ${index + 1}`,
  title: `검증된 기사 제목 ${index + 1}`,
  url: `https://news.example.com/article-${index + 1}`,
  publishedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
  summary: `검증된 기사 요약 ${index + 1}`,
  reliability: index < 3 ? "major_media" : "official",
}));

const kisSectorDegradedSnapshot: MarketSnapshot = {
  provider: "kis-fred",
  status: "ready",
  marketDate: "2026-09-04",
  collectedAt: "2026-09-04T00:00:00.000Z",
  dataQuality: "partial",
  fallbackUsed: false,
  degradedMode: "kis_sector_unavailable",
  degradedProviders: ["kis-sector"],
  disclosures: [KIS_SECTOR_DEGRADED_DISCLOSURE],
  freshness: {
    status: "fresh",
    checkedAt: "2026-09-04T00:00:00.000Z",
    staleItems: [],
  },
  missingItems: [],
};

const legacyFredDegradedSnapshot: MarketSnapshot = {
  provider: "kis-fred",
  status: "ready",
  marketDate: "2026-09-04",
  collectedAt: "2026-09-04T00:00:00.000Z",
  dataQuality: "partial",
  fallbackUsed: false,
  degradedMode: "fred_unavailable",
  degradedProviders: ["fred"],
  disclosures: [FRED_DEGRADED_LEGACY_DISCLOSURES[0]],
  freshness: {
    status: "fresh",
    checkedAt: "2026-09-04T00:00:00.000Z",
    staleItems: [],
  },
  missingItems: [],
};

const contentTypes: StockReferenceBriefingTemplate[] = [
  "KOREA_DAILY_PREVIEW",
  "KOREA_MARKET_CLOSE_US_PREVIEW",
  "WEEKLY_MARKET_REVIEW",
  "NEXT_WEEK_MARKET_PREVIEW",
  "INVESTMENT_STUDY",
  "LARGE_CAP_DISCLOSURE_EARNINGS",
];

test("모든 콘텐츠 타입에 같은 출처 3건 계약을 적용할 수 있다", () => {
  for (const contentType of contentTypes) {
    const body = canonicalizeStockBlogBody({
      body: `1. 30초 요약\n\n${contentType}\n\n마무리\n\n정리 문장`,
      referenceItems: references,
    });
    const contract = inspectStockBlogSourceContract(body, references);
    assert.equal(contract.ok, true, `${contentType}: ${JSON.stringify(contract)}`);
    assert.equal(contract.entryCount, STOCK_BLOG_CANONICAL_SOURCE_COUNT);
    assert.equal(contract.urlCount, STOCK_BLOG_CANONICAL_SOURCE_COUNT);
    assert.deepEqual(contract.missingTitles, []);
    assert.deepEqual(contract.missingUrls, []);
  }
});

test("출처·제한 고지·투자 유의문구를 중복 없이 정해진 순서로 정규화한다", () => {
  const malformed = [
    "1. 30초 요약",
    "판단을 정리합니다.",
    "함께 확인한 기사",
    "1. 임의로 쓴 기사",
    "https://invalid.example.com/old",
    "마무리",
    "마지막 판단입니다.",
    STOCK_BLOG_INVESTMENT_DISCLAIMER,
    KIS_SECTOR_DEGRADED_DISCLOSURE,
    STOCK_BLOG_INVESTMENT_DISCLAIMER,
  ].join("\n\n");
  const once = canonicalizeStockBlogBody({
    body: malformed,
    referenceItems: references,
    marketSnapshot: kisSectorDegradedSnapshot,
  });
  const twice = canonicalizeStockBlogBody({
    body: once,
    referenceItems: references,
    marketSnapshot: kisSectorDegradedSnapshot,
  });

  assert.equal(twice, once);
  assert.equal(once.endsWith(STOCK_BLOG_INVESTMENT_DISCLAIMER), true);
  assert.ok(once.indexOf(KIS_SECTOR_DEGRADED_DISCLOSURE) < once.indexOf(STOCK_BLOG_INVESTMENT_DISCLAIMER));
  assert.equal(once.includes("임의로 쓴 기사"), false);
  assert.ok(once.indexOf("마무리") < once.indexOf("함께 확인한 기사"));
  assert.ok(once.indexOf(KIS_SECTOR_DEGRADED_DISCLOSURE) < once.indexOf("함께 확인한 기사"));
  assert.ok(once.indexOf("함께 확인한 기사") < once.indexOf(STOCK_BLOG_INVESTMENT_DISCLAIMER));
  assert.equal(inspectStockBlogTailContract(once, kisSectorDegradedSnapshot).ok, true);
  assert.equal(inspectStockBlogSourceContract(once, references).ok, true);
});

test("기존 체크포인트의 내부 FRED 문구는 공개용 문구로 바꾼다", () => {
  const body = canonicalizeStockBlogBody({
    body: `본문\n\n마무리\n\n정리\n\n${FRED_DEGRADED_LEGACY_DISCLOSURES[0]}`,
    referenceItems: references,
    marketSnapshot: legacyFredDegradedSnapshot,
  });

  assert.equal(body.includes(FRED_DEGRADED_LEGACY_DISCLOSURES[0]), false);
  assert.equal(body.split(FRED_DEGRADED_DISCLOSURE).length - 1, 1);
  assert.equal(inspectStockBlogTailContract(body, legacyFredDegradedSnapshot).ok, true);
});

test("실제 출처가 3건보다 적으면 기존 기사 내용을 지우지 않고 계약 실패로 남긴다", () => {
  const original = "본문\n\n함께 확인한 기사\n\n1. 기존 기사\nhttps://news.example.com/original\n\n마무리\n\n정리";
  const body = canonicalizeStockBlogBody({ body: original, referenceItems: references.slice(0, 2) });

  assert.match(body, /1\. 기존 기사/);
  assert.equal(inspectStockBlogSourceContract(body, references.slice(0, 2)).ok, false);
  assert.equal(inspectStockBlogTailContract(body).ok, true);
});

test("시장 데이터가 앞에 있어도 실제 뉴스 기사 3건만 출처 섹션에 사용한다", () => {
  const marketData: ReferenceItem = {
    id: "market-data-first",
    sourceType: "market_data",
    provider: "kis",
    title: "KOSPI 지수 데이터",
    url: "https://data.example.com/kospi",
    sourceName: "한국투자증권 Open API",
    summary: "검증된 시장 데이터",
    reliability: "official",
  };
  const body = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: [marketData, ...references],
  });

  assert.equal(body.includes("KOSPI 지수 데이터"), false);
  assert.equal(inspectStockBlogSourceContract(body, [marketData, ...references]).ok, true);
});

test("첫 기사 제목이나 원문 표기가 정확하지 않으면 출처 계약을 통과시키지 않는다", () => {
  const canonical = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: references,
  });
  const wrongTitle = canonical.replace("1. 검증된 기사 제목 1", "1. 비슷하지만 다른 기사 제목");
  const rawUrlOnly = canonical.replace("- 원문: https://news.example.com/article-1", "https://news.example.com/article-1");

  assert.deepEqual(inspectStockBlogSourceContract(wrongTitle, references).missingTitles, ["검증된 기사 제목 1"]);
  assert.equal(inspectStockBlogSourceContract(wrongTitle, references).ok, false);
  assert.equal(inspectStockBlogSourceContract(rawUrlOnly, references).urlCount, 2);
  assert.equal(inspectStockBlogSourceContract(rawUrlOnly, references).ok, false);
});

test("기사 제목과 URL의 순서 쌍이 바뀌면 출처 계약을 통과시키지 않는다", () => {
  const body = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: references,
  });
  const swapped = body
    .replace("- 원문: https://news.example.com/article-1", "- 원문: https://news.example.com/swap-placeholder")
    .replace("- 원문: https://news.example.com/article-2", "- 원문: https://news.example.com/article-1")
    .replace("- 원문: https://news.example.com/swap-placeholder", "- 원문: https://news.example.com/article-2");
  const contract = inspectStockBlogSourceContract(swapped, references);

  assert.equal(contract.orderedPairsMatch, false);
  assert.equal(contract.ok, false);
});

test("기사 섹션에 네 번째 URL이 추가되면 출처 계약을 통과시키지 않는다", () => {
  const body = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: references,
  });
  const additional = body.replace(
    "- 원문: https://news.example.com/article-3",
    "- 원문: https://news.example.com/article-3\n- 참고 링크: https://news.example.com/extra",
  );
  const contract = inspectStockBlogSourceContract(additional, references);

  assert.equal(contract.urlCount, 3);
  assert.equal(contract.allUrlCount, 4);
  assert.deepEqual(contract.unexpectedUrls, ["https://news.example.com/extra"]);
  assert.equal(contract.ok, false);
});

test("deterministic 구조 검사는 QA 판정이나 복합 지적을 변경하지 않는다", () => {
  const body = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: references,
  });
  const cases = [
    ["코스피 종가 수치 오류를 바로잡아야 합니다.", "원문 URL이 누락됐습니다."],
    ["특정 종목 매수를 권유하는 표현을 제거해야 합니다.", "기사 URL을 추가해야 합니다."],
    ["번역투 문장을 자연스러운 한국어로 수정해야 합니다.", "원문 링크를 보완해야 합니다."],
  ];

  for (const requiredRevisions of cases) {
    const result = {
      ok: true,
      qaScore: 93,
      publishReadiness: "needs_revision",
      finalRecommendation: "revise",
      requiredRevisions,
    };
    const before = structuredClone(result);
    const audit = inspectStockBlogQaStructuralAudit({ body, referenceItems: references, result });

    assert.deepEqual(result, before);
    assert.equal(audit.sourceContract.ok, true);
    assert.equal(audit.requiredRevisionCount, 2);
    assert.equal(result.qaScore, 93);
    assert.equal(result.publishReadiness, "needs_revision");
    assert.equal(result.finalRecommendation, "revise");
    assert.deepEqual(result.requiredRevisions, requiredRevisions);
  }
});

test("기사 뒤에 데이터 고지나 다른 문단이 남으면 출처 계약을 통과시키지 않는다", () => {
  const canonical = canonicalizeStockBlogBody({
    body: "본문\n\n마무리\n\n정리",
    referenceItems: references,
    marketSnapshot: kisSectorDegradedSnapshot,
  });
  const malformed = canonical.replace(
    STOCK_BLOG_INVESTMENT_DISCLAIMER,
    `${KIS_SECTOR_DEGRADED_DISCLOSURE}\n\n${STOCK_BLOG_INVESTMENT_DISCLAIMER}`,
  );
  const contract = inspectStockBlogSourceContract(malformed, references);

  assert.equal(contract.onlyDisclaimerAfterSource, false);
  assert.equal(contract.ok, false);
});
