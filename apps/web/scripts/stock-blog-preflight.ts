import { evaluateStockBlogReferences } from "../src/lib/stock-blog/quality-gate";
import { collectStockBlogReferences } from "../src/lib/stock-blog/references/reference-adapter";

async function main() {
const contentType = "NEXT_WEEK_MARKET_PREVIEW" as const;
const bundle = await collectStockBlogReferences({
  topic: "다음 주 한국·미국 주식시장 주요 일정과 투자자 체크리스트",
  title: "다음 주 증시 일정과 체크포인트",
  channel: "blog",
  contentType,
  market: "GLOBAL",
  keywords: ["다음주증시", "경제일정", "한국증시", "미국증시"],
  maxResults: 10,
});
const gate = evaluateStockBlogReferences(bundle, true);
const snapshot = bundle.marketSnapshot;

console.log(JSON.stringify({
  ok: gate.ok,
  status: gate.status,
  reasons: gate.reasons,
  provider: bundle.provider,
  mode: bundle.mode,
  referenceStatus: bundle.status ?? null,
  referenceCount: bundle.items.length,
  competitorReferenceCount: bundle.competitorBlogReferences?.length ?? 0,
  competitorAnalyzedCount: bundle.competitorAnalysis?.analyzedCount ?? 0,
  competitorAnalysisFailedCount: bundle.competitorAnalysis?.failedCount ?? 0,
  missingItems: bundle.missingItems ?? [],
  marketSnapshot: snapshot ? {
    provider: snapshot.provider,
    status: snapshot.status,
    dataQuality: snapshot.dataQuality,
    fallbackUsed: snapshot.fallbackUsed ?? null,
    degradedMode: snapshot.degradedMode ?? null,
    freshness: snapshot.freshness?.status ?? null,
    missingItems: snapshot.missingItems,
    sourceCount: snapshot.sources?.length ?? 0,
    sources: (snapshot.sources ?? []).map((source) => ({
      sourceName: source.sourceName,
      asOf: source.asOf,
      freshness: source.freshness,
      ageMinutes: source.ageMinutes,
      maxAgeMinutes: source.maxAgeMinutes,
    })),
  } : null,
  diagnostics: gate.diagnostics,
}, null, 2));

if (!gate.ok) process.exitCode = 2;
}

void main();
