import type { MarketSnapshotMetric, ReferenceBundle, ReferenceItem } from "./references/reference-types";

export type InvestmentStudyTopicMode = "market_issue" | "search_question";
export type InvestmentStudyEditorialAngle = "upcoming_question" | "result_or_practical" | "issue_explainer";

export type InvestmentStudyTopicSelection = {
  mode: InvestmentStudyTopicMode;
  title: string;
  topic: string;
  score: number;
  reasons: string[];
  keywords: string[];
};

export const INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD = 3;

const SEARCH_QUESTION_TOPICS = [
  { title: "PER이 낮은 주식은 정말 싼 걸까", topic: "PER 계산법과 업종별 비교, 일회성 이익을 함께 확인해 낮은 PER을 잘못 해석하지 않는 방법" },
  { title: "영업이익이 늘었는데 현금흐름은 왜 나빠질까", topic: "영업이익과 영업현금흐름의 차이를 매출채권·재고자산 사례로 이해하는 방법" },
  { title: "배당기준일 전에 사면 배당을 받을 수 있을까", topic: "배당기준일·배당락일·결제일을 구분하고 실제 매수 시점을 확인하는 방법" },
  { title: "금리가 내리는데 성장주가 안 오르는 이유는 뭘까", topic: "금리 방향뿐 아니라 실적 전망·위험 프리미엄·밸류에이션이 성장주 주가에 함께 반영되는 과정" },
  { title: "외국인이 코스피를 사는데 내 종목은 왜 안 오를까", topic: "외국인 순매수의 대형주 집중도와 업종 확산, 현물·선물 수급을 구분해 보는 방법" },
  { title: "실적이 잘 나왔는데 주가는 왜 떨어질까", topic: "발표 실적·시장 예상치·다음 분기 가이던스가 주가에 반영되는 순서" },
  { title: "자사주 매입 공시가 나와도 주가가 안 오르는 이유", topic: "자사주 취득·처분·소각의 차이와 실제 매입 규모·기간이 주당 가치와 수급에 미치는 영향" },
  { title: "원달러 환율이 오르면 수출주는 모두 유리할까", topic: "수출 비중·원재료 수입·환헤지 구조에 따라 기업별 환율 영향이 달라지는 이유" },
  { title: "미국장 휴장일에는 국내 미국 ETF 가격이 어떻게 될까", topic: "미국 현물시장 휴장 때 국내 상장 미국 ETF의 기준가격·괴리율·환율이 움직이는 방식" },
  { title: "ETF 괴리율이 커지면 바로 손해일까", topic: "ETF 기준가격·시장가격·추적오차·괴리율의 차이와 매매 전에 확인할 숫자" },
] as const;

const UPCOMING_EVENT_QUESTIONS = [
  {
    pattern: /PPI|Producer Price|생산자물가/i,
    title: "미국 PPI 발표시간, 예상보다 높으면 나스닥은 왜 흔들릴까",
    topic: "미국 PPI 공식 발표 일정과 예상·실제 수치를 구분하고, 생산자물가가 국채금리와 나스닥에 전달되는 과정을 설명합니다.",
    keywords: ["미국 PPI 발표시간", "생산자물가", "나스닥", "미국 금리"],
  },
  {
    pattern: /CPI|Consumer Price|소비자물가/i,
    title: "미국 CPI 발표시간, 예상보다 높으면 나스닥은 왜 흔들릴까",
    topic: "미국 CPI 공식 발표 일정과 예상·실제 수치를 구분하고, 소비자물가가 국채금리와 나스닥에 전달되는 과정을 설명합니다.",
    keywords: ["미국 CPI 발표시간", "소비자물가", "나스닥", "미국 금리"],
  },
  {
    pattern: /FOMC|Federal Reserve|연준|기준금리/i,
    title: "FOMC 발표시간, 금리 동결에도 나스닥이 움직이는 이유",
    topic: "FOMC 공식 일정과 기준금리·성명서·기자회견을 구분하고, 금리 동결 뒤에도 나스닥이 움직이는 이유를 설명합니다.",
    keywords: ["FOMC 발표시간", "연준", "기준금리", "나스닥"],
  },
  {
    pattern: /고용|실업|Nonfarm|Payroll|Employment/i,
    title: "미국 고용지표 발표시간, 나스닥과 금리는 왜 움직일까",
    topic: "미국 고용지표 공식 일정과 신규 고용·실업률·임금 지표를 구분하고, 국채금리와 나스닥에 미치는 경로를 설명합니다.",
    keywords: ["미국 고용지표 발표시간", "비농업 고용", "실업률", "나스닥"],
  },
  {
    pattern: /소매판매|Retail Sales/i,
    title: "미국 소매판매 발표, 예상보다 강하면 금리는 왜 오를까",
    topic: "미국 소매판매 공식 일정과 예상·실제 수치를 구분하고, 소비 경기와 국채금리·주식시장에 미치는 경로를 설명합니다.",
    keywords: ["미국 소매판매 발표", "소비 경기", "미국 금리", "나스닥"],
  },
  {
    pattern: /GDP|국내총생산/i,
    title: "미국 GDP 발표, 성장률이 높아도 주가가 내릴 수 있는 이유",
    topic: "미국 GDP 공식 일정과 예상·실제 성장률을 구분하고, 성장 기대와 금리 부담이 주가에 함께 반영되는 과정을 설명합니다.",
    keywords: ["미국 GDP 발표", "경제성장률", "미국 금리", "주가"],
  },
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
    title: "PPI·CPI 발표 뒤 나스닥은 왜 흔들릴까",
    topic: "당일 물가 지표와 미국 국채금리·나스닥 반응을 사례로 인플레이션 지표가 성장주 가치에 전달되는 과정을 공부합니다.",
    keywords: ["PPI", "CPI", "나스닥", "미국 금리"],
  },
  {
    id: "rates",
    pattern: /FOMC|연준|기준금리|국채금리|10년물|2년물|금리 인상|금리 인하/i,
    title: "미국 금리가 움직이면 나스닥은 왜 더 민감할까",
    topic: "당일 미국 금리 이슈와 나스닥 반응을 사례로 할인율·채권수익률·성장주 밸류에이션의 관계를 공부합니다.",
    keywords: ["미국 금리", "10년물", "나스닥", "성장주"],
  },
  {
    id: "semiconductor",
    pattern: /삼성전자|SK하이닉스|반도체|HBM|엔비디아|필라델피아 반도체/i,
    title: "외국인이 반도체를 사는데 내 종목은 왜 안 오를까",
    topic: "당일 반도체 이슈와 코스피·외국인 수급을 사례로 대형주 집중 매수와 업종 확산 여부를 공부합니다.",
    keywords: ["반도체", "삼성전자", "SK하이닉스", "외국인 수급"],
  },
  {
    id: "earnings",
    pattern: /실적|가이던스|영업이익|매출|어닝|서프라이즈|쇼크/i,
    title: "실적이 잘 나왔는데 주가는 왜 떨어질까",
    topic: "당일 실적 발표 사례로 발표값·시장 예상·다음 분기 가이던스가 주가에 반영되는 순서를 공부합니다.",
    keywords: ["실적", "가이던스", "영업이익", "주가"],
  },
  {
    id: "shareholder_return",
    pattern: /주주환원|자사주|배당|소각|공개매수/i,
    title: "자사주 매입 공시가 나와도 주가가 안 오르는 이유",
    topic: "당일 주주환원 공시 사례로 자사주 매입·소각·배당이 주당 가치와 수급에 미치는 차이를 공부합니다.",
    keywords: ["주주환원", "자사주", "배당", "공시"],
  },
  {
    id: "fx",
    pattern: /원달러|원·달러|환율|달러 강세|달러 약세/i,
    title: "원달러 환율이 오르면 수출주는 모두 유리할까",
    topic: "당일 원달러 환율과 코스피 업종 흐름을 사례로 수출·수입 기업의 환율 수혜와 외국인 수급을 공부합니다.",
    keywords: ["원달러 환율", "코스피", "외국인 수급", "수출주"],
  },
  {
    id: "oil",
    pattern: /국제유가|원유|유가|OPEC|호르무즈/i,
    title: "국제유가가 오르면 정유주와 항공주는 어떻게 달라질까",
    topic: "당일 국제유가 이슈를 사례로 정유·화학·항공·운송 업종의 비용과 이익이 달라지는 경로를 공부합니다.",
    keywords: ["국제유가", "정유", "화학", "항공"],
  },
];

const RESULT_EVENT_STUDIES = [
  {
    pattern: /NVIDIA|엔비디아|\bNVDA\b/i,
    title: "엔비디아 실적 발표, 시간외 주가는 왜 올랐을까? 삼성전자·SK하이닉스 영향",
    topic: "엔비디아 공식 실적 자료와 SEC 제출에서 매출·데이터센터 매출·EPS·다음 분기 가이던스를 확인하고, 발표 직후 시간외 주가 반응이 삼성전자·SK하이닉스·HBM 관련주에 전달되는 경로를 설명합니다. 시장 예상치는 출처와 비교 시각이 확인된 수치만 사용합니다.",
    keywords: ["엔비디아 실적 발표", "엔비디아 시간외 주가", "삼성전자", "SK하이닉스", "NVDA"],
  },
] as const;

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

function selectResultEventStudy(
  bundle: ReferenceBundle,
  now: Date,
  news: ReferenceItem[],
): InvestmentStudyTopicSelection | null {
  const recentCutoff = now.getTime() - 96 * 60 * 60 * 1000;
  for (const study of RESULT_EVENT_STUDIES) {
    const official = bundle.items.find((item) => {
      if (item.reliability !== "official" || item.sourceType !== "disclosure") return false;
      const publishedAt = Date.parse(clean(item.publishedAt));
      return Number.isFinite(publishedAt)
        && publishedAt >= recentCutoff
        && study.pattern.test(`${item.title}\n${item.summary ?? ""}\n${item.symbols?.join(" ") ?? ""}`);
    });
    if (!official) continue;
    const relatedNews = news.filter((item) => study.pattern.test(`${item.title}\n${item.summary ?? ""}`));
    return {
      mode: "market_issue",
      title: study.title,
      topic: study.topic,
      score: 5,
      reasons: [
        `${official.publisher ?? official.sourceName ?? "공식 공시"}에서 최근 실적 제출을 확인했습니다.`,
        ...(relatedNews.length > 0 ? [`최근 72시간 내 관련 기사 ${relatedNews.length}건으로 발표 뒤 시장 반응을 교차 확인했습니다.`] : []),
      ],
      keywords: [...study.keywords],
    };
  }
  return null;
}

function categoryMatches(items: ReferenceItem[]) {
  return ISSUE_CATEGORIES.map((category) => {
    const matched = items.filter((item) => category.pattern.test(`${item.title}\n${item.summary ?? ""}`));
    const surprise = matched.some((item) => SURPRISE_PATTERN.test(`${item.title}\n${item.summary ?? ""}`));
    const score = matched.length >= 3 ? 3 : matched.length >= 2 ? 2 : matched.length === 1 ? 1 : 0;
    return { category, matched, surprise, score: score + (surprise && matched.length >= 1 ? 1 : 0) };
  }).sort((left, right) => right.score - left.score || right.matched.length - left.matched.length);
}

function highImpactEvents(bundle: ReferenceBundle, now: Date, horizonDays = 1) {
  const today = bundle.marketDate ?? now.toISOString().slice(0, 10);
  const lastDate = new Date(`${today}T00:00:00.000Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() + horizonDays);
  const lastDateText = lastDate.toISOString().slice(0, 10);
  return (bundle.marketSnapshot?.upcoming ?? []).filter((event) => (
    event.date >= today
    && event.date <= lastDateText
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

function selectSearchQuestion(now: Date): InvestmentStudyTopicSelection {
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const selected = SEARCH_QUESTION_TOPICS[dayIndex % SEARCH_QUESTION_TOPICS.length];
  return {
    mode: "search_question",
    title: selected.title,
    topic: selected.topic,
    score: 0,
    reasons: ["당일 강한 시장 이슈가 없어 투자자가 실제로 검색하는 질문형 주제를 선택했습니다."],
    keywords: selected.title.split(/[\s,·/]+/).filter((keyword) => keyword.length >= 2).slice(0, 4),
  };
}

function selectUpcomingEventQuestion(
  events: Array<{ date: string; event: string }>,
): InvestmentStudyTopicSelection | null {
  for (const event of events) {
    const question = UPCOMING_EVENT_QUESTIONS.find((candidate) => candidate.pattern.test(event.event));
    if (!question) continue;
    return {
      mode: "search_question",
      title: question.title,
      topic: question.topic,
      score: 2,
      reasons: [`검증된 오늘·내일 일정에서 ${event.date} ${event.event} 발표를 확인했습니다.`],
      keywords: [...question.keywords],
    };
  }
  return null;
}

function selectMarketMoveLesson(strongestMove?: MarketMove & { score: number }): InvestmentStudyTopicSelection | null {
  if (!strongestMove || typeof strongestMove.metric?.changePct !== "number") return null;
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

export function selectInvestmentStudyTopic(input: {
  now: Date;
  referenceBundle: ReferenceBundle;
  angle?: InvestmentStudyEditorialAngle;
}): InvestmentStudyTopicSelection {
  const moves = marketMoves(input.referenceBundle)
    .map((move) => ({ ...move, score: metricMoveScore(move.metric) }))
    .sort((left, right) => right.score - left.score);
  const strongestMove = moves[0];
  const news = recentNewsItems(input.referenceBundle, input.now);
  const category = categoryMatches(news)[0];
  const angle = input.angle ?? "issue_explainer";
  const events = highImpactEvents(input.referenceBundle, input.now, angle === "upcoming_question" ? 4 : 1);
  const eventScore = events.length > 0 ? 2 : 0;

  if (angle === "result_or_practical") {
    const resultStudy = selectResultEventStudy(input.referenceBundle, input.now, news);
    if (resultStudy) return resultStudy;
  }

  if (strongestMove?.score >= 4) return selectMarketMoveLesson(strongestMove) ?? selectSearchQuestion(input.now);
  if (angle === "upcoming_question") {
    const scheduledQuestion = selectUpcomingEventQuestion(events);
    if (scheduledQuestion) return scheduledQuestion;
  }
  if (strongestMove?.score >= INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD) {
    return selectMarketMoveLesson(strongestMove) ?? selectSearchQuestion(input.now);
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

  return selectSearchQuestion(input.now);
}

export function qualifiesForConditionalInvestmentStudy(selection: InvestmentStudyTopicSelection) {
  return selection.mode === "market_issue" && selection.score >= INVESTMENT_STUDY_ISSUE_SCORE_THRESHOLD;
}
