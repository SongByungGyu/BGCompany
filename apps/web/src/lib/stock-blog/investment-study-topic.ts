import type { MarketSnapshotMetric, ReferenceBundle, ReferenceItem } from "./references/reference-types";

export type InvestmentStudyTopicMode = "market_issue" | "evergreen";

export type InvestmentStudyTopicSelection = {
  mode: InvestmentStudyTopicMode;
  title: string;
  topic: string;
  score: number;
  reasons: string[];
  keywords: string[];
};

export const INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD = 3;

const EVERGREEN_TOPICS = [
  { title: "PER이 낮다고 항상 싼 주식은 아닌 이유", topic: "PER 계산법과 업종별 비교, 이익의 질을 함께 보는 방법" },
  { title: "영업이익보다 현금흐름을 같이 봐야 하는 이유", topic: "영업이익과 영업현금흐름 차이, 현금이익의 질을 실제 사례로 이해하기" },
  { title: "배당기준일과 배당락일을 제대로 이해하는 법", topic: "배당기준일·배당락일·배당수익률 계산과 주가 조정 원리" },
  { title: "금리가 오르면 성장주가 흔들리는 이유", topic: "할인율과 미래 현금흐름으로 이해하는 금리와 성장주 가치 관계" },
  { title: "재고자산이 늘 때 실적에서 확인할 것", topic: "재고자산 회전율과 매출 성장, 현금흐름으로 재고 증가의 질 판단하기" },
  { title: "ROE가 높아도 꼭 좋은 기업은 아닌 이유", topic: "ROE를 순이익률·자산회전율·재무레버리지로 나눠 기업의 질 판단하기" },
  { title: "부채비율보다 먼저 확인할 숫자", topic: "부채비율·순차입금·이자보상배율을 함께 보는 재무 안전성 공부" },
  { title: "매출이 조금 늘어도 이익이 크게 움직이는 이유", topic: "고정비와 영업레버리지로 이해하는 매출 성장과 영업이익 변화" },
  { title: "자사주 매입과 소각은 무엇이 다른가", topic: "자사주 취득·처분·소각이 주당 가치와 주주환원에 미치는 영향" },
  { title: "실적 발표에서 가이던스를 먼저 보는 법", topic: "과거 실적과 다음 분기 가이던스를 구분하고 예상치 변화 판단하기" },
  { title: "원달러 환율이 기업 실적에 미치는 영향", topic: "수출·수입 기업의 매출과 비용 구조로 환율 수혜와 부담 구분하기" },
  { title: "ETF 추적오차와 괴리율은 왜 생기나", topic: "ETF 기준가격·시장가격·추적오차·괴리율을 숫자와 사례로 이해하기" },
] as const;

type MarketMove = {
  label: string;
  market: "KR" | "US";
  metric?: MarketSnapshotMetric;
};

type IssueCategory = {
  id: string;
  pattern: RegExp;
  title: string;
  topic: string;
  keywords: string[];
};

const ISSUE_CATEGORIES: IssueCategory[] = [
  {
    id: "inflation",
    pattern: /PPI|CPI|생산자물가|소비자물가|물가지수/i,
    title: "PPI·CPI 발표 뒤 나스닥이 흔들리는 이유",
    topic: "당일 물가 지표와 미국 국채금리·나스닥 반응을 사례로 인플레이션 지표가 성장주 가치에 전달되는 과정을 공부합니다.",
    keywords: ["PPI", "CPI", "나스닥", "미국 금리"],
  },
  {
    id: "rates",
    pattern: /FOMC|연준|기준금리|국채금리|10년물|2년물|금리 인상|금리 인하/i,
    title: "미국 금리 변화에 나스닥이 민감한 이유",
    topic: "당일 미국 금리 이슈와 나스닥 반응을 사례로 할인율·채권수익률·성장주 밸류에이션의 관계를 공부합니다.",
    keywords: ["미국 금리", "10년물", "나스닥", "성장주"],
  },
  {
    id: "semiconductor",
    pattern: /삼성전자|SK하이닉스|반도체|HBM|엔비디아|필라델피아 반도체/i,
    title: "반도체 급등락 때 외국인 수급을 읽는 법",
    topic: "당일 반도체 이슈와 코스피·외국인 수급을 사례로 대형주 집중 매수와 업종 확산 여부를 공부합니다.",
    keywords: ["반도체", "삼성전자", "SK하이닉스", "외국인 수급"],
  },
  {
    id: "earnings",
    pattern: /실적|가이던스|영업이익|매출|어닝|서프라이즈|쇼크/i,
    title: "실적 발표 뒤 주가가 엇갈리는 이유: 가이던스 읽는 법",
    topic: "당일 실적 발표 사례로 발표값·시장 예상·다음 분기 가이던스가 주가에 반영되는 순서를 공부합니다.",
    keywords: ["실적", "가이던스", "영업이익", "주가"],
  },
  {
    id: "shareholder_return",
    pattern: /주주환원|자사주|배당|소각|공개매수/i,
    title: "자사주·배당 공시가 주가에 미치는 영향",
    topic: "당일 주주환원 공시 사례로 자사주 매입·소각·배당이 주당 가치와 수급에 미치는 차이를 공부합니다.",
    keywords: ["주주환원", "자사주", "배당", "공시"],
  },
  {
    id: "fx",
    pattern: /원달러|원·달러|환율|달러 강세|달러 약세/i,
    title: "원달러 환율 변화가 코스피 업종에 미치는 영향",
    topic: "당일 원달러 환율과 코스피 업종 흐름을 사례로 수출·수입 기업의 환율 수혜와 외국인 수급을 공부합니다.",
    keywords: ["원달러 환율", "코스피", "외국인 수급", "수출주"],
  },
  {
    id: "oil",
    pattern: /국제유가|원유|유가|OPEC|호르무즈/i,
    title: "국제유가 급등락이 코스피 업종에 미치는 영향",
    topic: "당일 국제유가 이슈를 사례로 정유·화학·항공·운송 업종의 비용과 이익이 달라지는 경로를 공부합니다.",
    keywords: ["국제유가", "정유", "화학", "항공"],
  },
];

const SURPRISE_PATTERN = /급등|급락|폭락|반등|신고가|신저가|예상보다|서프라이즈|쇼크|돌파|회복/i;
const HIGH_IMPACT_EVENT_PATTERN = /PPI|CPI|Producer Price|Consumer Price|FOMC|Federal Reserve|연준|고용|실업|Nonfarm|Payroll|Employment|금리|GDP|소매판매|Retail Sales/i;

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function metricMoveScore(metric?: MarketSnapshotMetric) {
  const change = typeof metric?.changePct === "number" ? Math.abs(metric.changePct) : 0;
  if (change >= 2) return 4;
  if (change >= 1.2) return 3;
  if (change >= 0.8) return 2;
  return 0;
}

function formatPct(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function recentNewsItems(bundle: ReferenceBundle, now: Date) {
  const recentCutoff = now.getTime() - 72 * 60 * 60 * 1000;
  return bundle.items.filter((item) => {
    if (item.sourceType !== "news") return false;
    const publishedAt = Date.parse(clean(item.publishedAt));
    return Number.isFinite(publishedAt) && publishedAt >= recentCutoff;
  });
}

function categoryMatches(items: ReferenceItem[]) {
  return ISSUE_CATEGORIES.map((category) => {
    const matched = items.filter((item) => category.pattern.test(`${item.title}\n${item.summary ?? ""}`));
    const surprise = matched.some((item) => SURPRISE_PATTERN.test(`${item.title}\n${item.summary ?? ""}`));
    const score = matched.length >= 3 ? 3 : matched.length >= 2 ? 2 : matched.length === 1 ? 1 : 0;
    return { category, matched, surprise, score: score + (surprise && matched.length >= 1 ? 1 : 0) };
  }).sort((left, right) => right.score - left.score || right.matched.length - left.matched.length);
}

function highImpactEvents(bundle: ReferenceBundle, now: Date) {
  const today = bundle.marketDate ?? now.toISOString().slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  return (bundle.marketSnapshot?.upcoming ?? []).filter((event) => (
    (event.date === today || event.date === tomorrowDate)
    && HIGH_IMPACT_EVENT_PATTERN.test(event.event)
  ));
}

function marketMoves(bundle: ReferenceBundle): MarketMove[] {
  const snapshot = bundle.marketSnapshot;
  return [
    { label: "코스피", market: "KR", metric: snapshot?.korea?.kospi },
    { label: "코스닥", market: "KR", metric: snapshot?.korea?.kosdaq },
    { label: "나스닥", market: "US", metric: snapshot?.us?.nasdaq },
    { label: "S&P500", market: "US", metric: snapshot?.us?.sp500 },
    { label: "다우", market: "US", metric: snapshot?.us?.dow },
  ];
}

function selectEvergreen(now: Date): InvestmentStudyTopicSelection {
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const selected = EVERGREEN_TOPICS[dayIndex % EVERGREEN_TOPICS.length];
  return {
    mode: "evergreen",
    title: selected.title,
    topic: selected.topic,
    score: 0,
    reasons: ["당일 시장 이슈 점수가 기준에 미달해 순환형 투자공부 주제를 선택했습니다."],
    keywords: [],
  };
}

export function selectInvestmentStudyTopic(input: {
  now: Date;
  referenceBundle: ReferenceBundle;
}): InvestmentStudyTopicSelection {
  const moves = marketMoves(input.referenceBundle)
    .map((move) => ({ ...move, score: metricMoveScore(move.metric) }))
    .sort((left, right) => right.score - left.score);
  const strongestMove = moves[0];
  const news = recentNewsItems(input.referenceBundle, input.now);
  const category = categoryMatches(news)[0];
  const events = highImpactEvents(input.referenceBundle, input.now);
  const eventScore = events.length > 0 ? 2 : 0;

  if (strongestMove?.score >= INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD && typeof strongestMove.metric?.changePct === "number") {
    const change = strongestMove.metric.changePct;
    const usMarket = strongestMove.market === "US";
    return {
      mode: "market_issue",
      title: usMarket
        ? `${strongestMove.label} ${formatPct(change)}, 금리와 성장주는 왜 함께 움직였을까`
        : `${strongestMove.label} ${formatPct(change)}, 외국인 수급은 어떻게 읽어야 할까`,
      topic: usMarket
        ? `${strongestMove.label} ${formatPct(change)} 변동을 실제 사례로 미국 국채금리·할인율·성장주 밸류에이션의 연결 과정을 공부합니다.`
        : `${strongestMove.label} ${formatPct(change)} 변동을 실제 사례로 외국인 현물·선물 수급과 대형주·업종 확산을 읽는 방법을 공부합니다.`,
      score: strongestMove.score,
      reasons: [`${strongestMove.label} 변동률 ${formatPct(change)}로 시장 급변 기준을 충족했습니다.`],
      keywords: usMarket
        ? [strongestMove.label, "미국 금리", "성장주", "밸류에이션"]
        : [strongestMove.label, "외국인 수급", "선물", "주도 업종"],
    };
  }

  const categoryScore = category?.score ?? 0;
  const combinedScore = Math.min(5, categoryScore + (events.length > 0 && categoryScore > 0 ? 1 : 0));
  if (category && combinedScore >= 2) {
    const reasons = [
      `최근 72시간 내 관련 기사 ${category.matched.length}건을 확인했습니다.`,
      ...(category.surprise ? ["급등락·예상 차이 등 검색 관심 신호가 제목에 포함됐습니다."] : []),
      ...(events.length > 0 ? [`오늘·내일 주요 일정 ${events.map((event) => event.event).join("·")}을 확인했습니다.`] : []),
    ];
    return {
      mode: "market_issue",
      title: category.category.title,
      topic: category.category.topic,
      score: Math.max(combinedScore, eventScore),
      reasons,
      keywords: category.category.keywords,
    };
  }

  return selectEvergreen(input.now);
}

export function qualifiesForConditionalInvestmentStudy(selection: InvestmentStudyTopicSelection) {
  return selection.mode === "market_issue" && selection.score >= INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD;
}
