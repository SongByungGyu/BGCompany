import type { ReferenceBundle } from "./references/reference-types";
import type { StockBlogContentImage } from "./stock-blog-image-types";
import { inspectNaturalStockBlogLayout } from "./stock-blog-natural-style";

// These are reading questions, never invented prices, schedules or causal claims.
const TOPICS = [
  { key: "market-holiday", match: /휴장|개장일|거래시간/, title: "다음 개장 전에 확인할 것", steps: ["공식 거래 일정", "주문 접수 방식", "실제 체결 시점", "개장 전 새 공시"] },
  { key: "earnings", match: /실적|매출|이익|가이던스|공시/, title: "실적 발표를 읽는 순서", steps: ["공식 발표 원문", "실적과 예상 구분", "다음 분기 전망", "발표 뒤 주가 반응"] },
  { key: "yen", match: /엔화|원[·/]엔|달러[·/]엔|JPY/i, title: "엔화 환전 전에 확인할 것", steps: ["환율 표시 단위", "기준 환율 시점", "실제 환전 가격", "수수료와 우대 조건"] },
  { key: "policy-savings", match: /적금|지원금|연금|신청|자격/, title: "신청 전에 확인할 것", steps: ["공식 안내 원문", "대상과 자격 조건", "신청 기간과 방법", "중복 신청 제한"] },
  { key: "investor-flow", match: /수급|외국인|기관|순매수|순매도/, title: "수급을 읽는 순서", steps: ["기준 거래일", "현물과 선물 구분", "투자자별 매매 방향", "업종별 매수 확산"] },
  { key: "rates-fx", match: /환율|금리|국채|달러|유가|물가|CPI|FOMC/i, title: "금리와 환율에서 확인할 것", steps: ["자료의 기준 시각", "비교 기간과 단위", "지수와 종목 반응", "판단이 달라질 조건"] },
  { key: "market-breadth", match: /지수|코스피|코스닥|나스닥|종목|업종|ETF/i, title: "지수와 내 종목을 나눠 보는 법", steps: ["지수의 기준 거래일", "상승과 하락 종목", "업종별 거래대금", "보유 종목의 움직임"] },
] as const;

export type ExplanatoryImageContext = { body?: string; referenceBundle?: ReferenceBundle };
export type ExplanatoryImagePlan = {
  id: string; title: string; heading: string; topicKey: string;
  steps: readonly string[]; sourceIds: string[]; sourceUrl: string; sourceName: string;
};

function publicUrl(value?: string) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

export function planExplanatoryImages(context: ExplanatoryImageContext): ExplanatoryImagePlan[] {
  const bundle = context.referenceBundle;
  if (!context.body || bundle?.mode !== "real" || bundle.status !== "ready" || bundle.provider === "mock") return [];
  const sources = bundle.items.filter(item => publicUrl(item.url)
    && ["official", "major_media"].includes(item.reliability ?? "")
    && item.sourceType !== "mock" && item.sourceType !== "blog");
  const prose = context.body.split(/^(?:#{1,6}\s*)?(?:함께 확인한 기사|참고한 기사와 자료|함께 읽으면 좋은 글|마무리)\s*$/m)[0];
  const headings = inspectNaturalStockBlogLayout(prose).headings;
  const plans: ExplanatoryImagePlan[] = [];
  const used = new Set<string>();
  for (const heading of headings) {
    if (/기사|출처|참고자료|마무리|함께 읽|면책/.test(heading)) continue;
    const start = prose.indexOf(heading);
    const following = headings.map(h => prose.indexOf(h, start + heading.length)).filter(at => at >= 0);
    const section = prose.slice(start, following.length ? Math.min(...following) : undefined);
    // A topic must occur in this section, not only in another paragraph or a link list.
    const eligible = TOPICS.filter(topic => topic.match.test(section));
    const topic = eligible.find(t => !used.has(t.key) && t.match.test(heading))
      ?? eligible.find(t => !used.has(t.key));
    if (!topic) continue;
    const source = sources.find(item => topic.match.test(`${item.title}\n${item.summary ?? ""}\n${(item.keywords ?? []).join(" ")}`));
    if (!source?.url) continue;
    used.add(topic.key);
    plans.push({ id: `explain-${topic.key}`, title: topic.title, heading, topicKey: topic.key,
      steps: topic.steps, sourceIds: [source.id], sourceUrl: source.url,
      sourceName: source.sourceName ?? source.publisher ?? source.provider });
  }
  return plans;
}

export function isVerifiedExplanatoryImage(image: StockBlogContentImage, context: ExplanatoryImageContext) {
  const evidence = image.explanation;
  if (!evidence || evidence.version !== 1 || !["chart-data-unavailable", "topic-without-chart"].includes(evidence.reason)
    || image.type !== "related-image" || image.licenseType !== "generated"
    || image.dataKeys.length || image.dataPoints.length) return false;
  const plan = planExplanatoryImages(context).find(p => p.id === image.id);
  return Boolean(plan && image.title === plan.title && image.placementAfterHeading === plan.heading
    && image.sourceUrl === plan.sourceUrl && image.relevanceTags?.includes(plan.topicKey)
    && evidence.topicKey === plan.topicKey && JSON.stringify(evidence.sourceIds) === JSON.stringify(plan.sourceIds)
    && image.caption.includes("시세 차트가 아닌") && image.sourceLabel.includes("개념·확인 순서"));
}
