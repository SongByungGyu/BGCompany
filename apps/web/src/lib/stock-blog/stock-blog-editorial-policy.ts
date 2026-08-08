import type { StockReferenceBriefingTemplate } from "@/lib/stock-blog/references/reference-types";

export const BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION = 5;

export const STOCK_BLOG_INVESTMENT_DISCLAIMER = "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.";

export const STOCK_BLOG_HARD_PROHIBITED_PHRASES = [
  "급등 확정",
  "무조건 상승",
  "매수 추천",
  "수익 보장",
  "상한가 확정",
  "폭등",
  "몰빵",
  "결론부터 말씀드리면",
  "쉽게 말하면",
  "살펴보겠습니다",
  "알아보겠습니다",
  "도움이 되셨다면",
  "공감 부탁",
  "댓글 부탁",
  "이웃 추가",
  "서로이웃",
  "투표해주세요",
] as const;

const FORBIDDEN_ENGAGEMENT_PATTERNS = [
  /댓글(?:로|에)?[^.\n]{0,20}(?:남겨|알려|부탁)/i,
  /공감(?:과|을|도)?\s*(?:눌러|부탁)/i,
  /(?:서로)?이웃\s*(?:추가|신청)/i,
  /투표(?:해|를\s*부탁)/i,
  /여러분은\s*어떻게\s*생각/i,
];

export type StockBlogEditorialLengthRule = {
  min: number;
  targetMin: number;
  targetMax: number;
  max: number;
};

export type StockBlogEditorialPolicy = {
  contentType: StockReferenceBriefingTemplate;
  bodyLength: StockBlogEditorialLengthRule;
  bodyStructure: string[];
  minimumHeadingCount: number;
  minimumParagraphCount: number;
  checklistItemCount: number;
  coreNumberMin: number;
  coreNumberMax: number;
  bodyImageMin: number;
  bodyImageMax: number;
  totalImageMin: number;
  totalImageMax: number;
};

const DAILY_LENGTH: StockBlogEditorialLengthRule = {
  min: 1_800,
  targetMin: 2_100,
  targetMax: 2_600,
  max: 2_800,
};

const WEEKLY_LENGTH: StockBlogEditorialLengthRule = {
  min: 2_000,
  targetMin: 2_300,
  targetMax: 2_900,
  max: 3_200,
};

const BODY_STRUCTURES: Record<StockReferenceBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: [
    "1. 30초 요약",
    "2. 전일 한국장 코멘트와 간밤 미국장 핵심 숫자",
    "3. 오늘 한국장 핵심 변수 2가지",
    "4. 한국장 상승·하락 조건",
    "5. 오늘의 초보자 설명",
    "6. 오늘 한국장 볼 것 3가지",
    "7. BG Market Note 판단",
    "함께 확인한 기사",
  ],
  KOREA_MARKET_CLOSE_US_PREVIEW: [
    "1. 30초 요약",
    "2. 전일 미국장 핵심 숫자와 오늘 연결 신호",
    "3. 오늘 밤 미국장 핵심 변수 2가지",
    "4. 미국장 상승·하락 조건",
    "5. 오늘의 초보자 설명",
    "6. 오늘 밤 미국장 볼 것 3가지",
    "7. BG Market Note 판단",
    "함께 확인한 기사",
  ],
  WEEKLY_MARKET_REVIEW: [
    "1. 30초 요약",
    "2. 이번 주 한국·미국 시장 핵심 숫자",
    "3. 이번 주 핵심 변수 2가지",
    "4. 이번 주 상승·하락을 가른 조건",
    "5. 이번 주 수급·주도 업종",
    "6. 이번 주 초보자 설명",
    "7. 다음 주에 다시 볼 것 3가지",
    "8. BG Market Note 판단",
    "함께 확인한 기사",
  ],
  NEXT_WEEK_MARKET_PREVIEW: [
    "1. 30초 요약",
    "2. 다음 주 주요 이슈와 핵심 숫자",
    "3. 다음 주 핵심 변수 2가지",
    "4. 다음 주 핵심 일정",
    "5. 다음 주 상승·하락 조건",
    "6. 다음 주 초보자 설명",
    "7. 다음 주 볼 것 3가지",
    "8. BG Market Note 판단",
    "함께 확인한 기사",
  ],
  INVESTMENT_STUDY: [
    "1. 30초 요약",
    "2. 개념을 이해할 핵심 숫자",
    "3. 적용할 때 핵심 변수 2가지",
    "4. 유리·불리해지는 상승·하락 조건",
    "5. 실제 시장·기업 사례",
    "6. 오늘의 초보자 설명",
    "7. 투자공부에서 볼 것 3가지",
    "8. BG Market Note 판단",
    "함께 확인한 기사",
  ],
  LARGE_CAP_DISCLOSURE_EARNINGS: [
    "1. 30초 요약",
    "2. 공시·실적 핵심 숫자",
    "3. 발표에서 볼 핵심 변수 2가지",
    "4. 주가 상승·하락 조건",
    "5. 공식 발표와 시장 반응",
    "6. 오늘의 초보자 설명",
    "7. 다음 분기 볼 것 3가지",
    "8. BG Market Note 판단",
    "함께 확인한 기사",
  ],
};

export function getStockBlogEditorialPolicy(contentType: StockReferenceBriefingTemplate): StockBlogEditorialPolicy {
  const weekly = contentType === "WEEKLY_MARKET_REVIEW"
    || contentType === "NEXT_WEEK_MARKET_PREVIEW"
    || contentType === "INVESTMENT_STUDY"
    || contentType === "LARGE_CAP_DISCLOSURE_EARNINGS";
  return {
    contentType,
    bodyLength: weekly ? WEEKLY_LENGTH : DAILY_LENGTH,
    bodyStructure: [...BODY_STRUCTURES[contentType]],
    minimumHeadingCount: weekly ? 8 : 7,
    minimumParagraphCount: 10,
    checklistItemCount: 3,
    coreNumberMin: 4,
    coreNumberMax: 6,
    bodyImageMin: 2,
    bodyImageMax: 3,
    totalImageMin: 3,
    totalImageMax: 4,
  };
}

export function getStockBlogEditorialGuidelines(contentType: StockReferenceBriefingTemplate) {
  const policy = getStockBlogEditorialPolicy(contentType);
  const { bodyLength } = policy;
  const templateFocusGuidelines = contentType === "KOREA_DAILY_PREVIEW"
    ? [
      "오전 한국장 전망 글에서는 전일 한국장 마감을 2~3문장 코멘트로만 복기하고, 간밤 미국 지수·금리·환율을 오늘 한국장 전망의 근거로 사용합니다. 본문의 70% 이상은 오늘 한국장 변수·조건·확인 항목에 배정합니다.",
      "제목과 30초 요약은 오늘 코스피·한국장 전망을 중심으로 쓰며, 전일 한국장 마감 원인을 메인 제목으로 다시 소비하지 않습니다.",
    ]
    : contentType === "KOREA_MARKET_CLOSE_US_PREVIEW"
      ? [
        "17시 미국장 전망 글에서는 전일 S&P500·나스닥·다우 흐름을 검증 숫자로 먼저 짧게 복기하고, 오늘 한국장 마감은 미국장과 연결되는 신호를 2~3문장으로만 언급합니다. 본문의 70% 이상은 오늘 밤 미국장 변수·조건·확인 항목에 배정합니다.",
        "제목과 30초 요약의 1차 검색 의도는 오늘 미국장·나스닥 전망입니다. 오늘 코스피 마감 원인이나 외국인 수급을 메인 제목과 결론으로 사용하지 않습니다.",
      ]
      : contentType === "WEEKLY_MARKET_REVIEW"
        ? [
          "토요일 주간 복기 글은 본문의 70% 이상을 이번 주 한국·미국 지수, 수급, 주도 업종, 금리·환율, 실제 변동 원인에 배정합니다. 다음 주 내용은 이번 주에 확인된 신호가 이어지는지 볼 항목 3개로만 제한합니다.",
          "제목과 30초 요약의 1차 검색 의도는 이번 주 증시 정리입니다. 다음 주 일정·전망·상승 조건을 메인 제목이나 별도 일정 섹션으로 확장하지 않습니다.",
        ]
        : contentType === "NEXT_WEEK_MARKET_PREVIEW"
          ? [
            "일요일 글은 지난주 복기를 2~3문장으로 끝내고, 본문의 70% 이상을 다음 주 주요 이슈 3개·영향 섹터·경제 및 실적 일정·대응 조건에 배정합니다.",
            "제목과 30초 요약의 1차 검색 의도는 다음 주 주요 이슈와 수혜·주의 섹터입니다. 이슈마다 영향 경로와 확인할 공식 일정을 연결하고 단순 테마 나열은 금지합니다.",
          ]
          : contentType === "INVESTMENT_STUDY"
            ? [
              "토요일 투자 공부 글은 한 번에 한 개념만 다룹니다. 정의를 외우게 하지 말고 공식·숫자·실제 기업 또는 시장 사례·틀리기 쉬운 해석 순서로 설명합니다.",
              "검색 제목에는 PER·현금흐름·배당락처럼 실제로 찾는 구체 용어를 앞에 두고, 최근 지수·금리·업종 사례 하나로 현재 시장과 연결합니다.",
            ]
            : contentType === "LARGE_CAP_DISCLOSURE_EARNINGS"
              ? [
                "공시·실적 글은 DART 또는 SEC 원문이 확인된 대형주만 다룹니다. 발표값·비교 기준·증감률·가이던스를 구분하고 공식 발표에 없는 원인은 추정하지 않습니다.",
                "제목에는 기업명과 공시 또는 실적의 핵심 숫자를 앞에 두며, 본문은 발표 요약보다 숫자가 주가·업종에 전달되는 경로와 다음 확인 조건에 더 많은 비중을 둡니다.",
              ]
          : [];
  return [
    `BG MARKET NOTE 편집 정책 v${BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION}: 기존 API·데이터 계산·이미지 생성·JSON 필드·카테고리·예약 발행 구조는 바꾸지 않고 공개 글의 구성과 문체만 개선합니다.`,
    "제목은 실제 검색어와 오늘의 결론을 앞부분에 두고 핵심 변수는 1~2개만 사용합니다. 공포·확정·수익 보장 표현과 최근 제목의 중심 문구 반복을 금지합니다.",
    `최종 공개 본문은 공백 포함 ${bodyLength.min.toLocaleString("ko-KR")}~${bodyLength.max.toLocaleString("ko-KR")}자이며 ${bodyLength.targetMin.toLocaleString("ko-KR")}~${bodyLength.targetMax.toLocaleString("ko-KR")}자를 목표로 합니다. 한 문단에는 한 가지 생각만 담고 모바일 기준 2~4문장으로 씁니다.`,
    "첫 섹션 '30초 요약'에는 판단·상방 조건·하방 조건·다음 확인 지표를 각각 한 줄로 적습니다.",
    `핵심 숫자는 검증된 기준일·단위가 있는 값 ${policy.coreNumberMin}~${policy.coreNumberMax}개만 고르고, 숫자의 반복 설명 대신 각각이 시장에 갖는 의미를 한 문장으로 설명합니다.`,
    "핵심 변수 섹션은 반드시 '변수 1:'과 '변수 2:' 두 개만 사용합니다. 상승·하락 시나리오는 예측을 단정하지 말고 관찰 가능한 조건으로 구분합니다.",
    "초보자 설명은 오늘 시장과 직접 연결된 개념 하나만 3~5문장으로 설명하고, 독자를 가르치려는 말투나 같은 설명의 반복을 피합니다.",
    `체크 섹션은 실제로 확인할 시간·지표·조건 ${policy.checklistItemCount}개만 제시합니다. 댓글·공감·이웃·투표를 요구하거나 질문형 참여를 유도하지 않습니다.`,
    "'어제 전망 확인'은 이전 글의 구조화된 판단과 실제 결과가 입력으로 함께 제공된 경우에만 작성합니다. 근거가 없으면 섹션 자체를 생략하고 맞았다고 추정하지 않습니다.",
    ...templateFocusGuidelines,
    "검증된 referenceBundle과 MarketSnapshot에 있는 자료만 사실 근거로 사용합니다. 누락값은 생략하고 전망치와 실제치를 구분하며, 확인되지 않은 원인은 '영향을 줬을 가능성'처럼 범위를 제한합니다.",
    `대표 이미지 1장과 본문 이미지 ${policy.bodyImageMin}~${policy.bodyImageMax}장만 사용합니다. 이미지마다 한 메시지만 담고 캡션·기준일·단위·출처를 표시한 뒤 본문 숫자와 중복 설명하지 않습니다.`,
    "마지막에는 실제 사용 기사와 원문만 표시하고 투자 유의문구를 정확히 한 번 둡니다. 내부 링크는 실제 발행 URL이 있을 때만 1~2개 사용하며 생성·추정하지 않습니다.",
    "차분한 개인 투자자의 설명체로 쓰고 번역체, 증권사 보고서식 과장, 같은 문장 시작과 어미 반복, '결론부터 말씀드리면·쉽게 말하면·살펴보겠습니다·알아보겠습니다' 같은 AI 상투어를 사용하지 않습니다.",
    "문장 중간 강제 줄바꿈, 내용 없는 빈 문단, 연속된 세 줄 이상의 개행, 특수 공백으로 만든 여백을 금지합니다. 문단 사이는 한 번만 구분합니다.",
  ];
}

const EDITORIAL_SECTION_HEADING_PATTERNS = [
  /^\d+\.\s*30초\s*요약$/,
  /^\d+\..*핵심\s*숫자/,
  /^\d+\..*핵심\s*변수\s*2가지/,
  /^\d+\..*(?:상승.*하락|하락.*상승).*(?:조건|시나리오)/,
  /^\d+\..*(?:주요|핵심)\s*일정/,
  /^\d+\..*초보자\s*설명/,
  /^\d+\..*볼\s*것\s*3가지/,
  /^\d+\.\s*BG\s*Market\s*Note\s*(?:의\s*)?판단$/i,
] as const;

function isEditorialSectionHeading(value: string) {
  return EDITORIAL_SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(value));
}

function sectionBody(body: string, headingPattern: RegExp) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start < 0) return "";
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isEditorialSectionHeading(line) || line === "함께 확인한 기사" || line === "마무리") break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function listItemCount(value: string) {
  return value.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
}

function sentenceCount(value: string) {
  return value
    .replace(/^\s*[-*•]\s+/gm, "")
    .split(/[.!?。](?:\s|$)|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8)
    .length;
}

export type StockBlogEditorialContractInspection = {
  hasThirtySecondSummary: boolean;
  summaryLabelCount: number;
  coreNumberCount: number;
  coreVariableCount: number;
  hasConditionalScenarios: boolean;
  beginnerExplanationSentenceCount: number;
  checklistItemCount: number;
  hasBgMarketNoteJudgment: boolean;
  forbiddenPhraseMatches: string[];
  hasForbiddenEngagementCta: boolean;
  excessiveBlankLineRunCount: number;
  violations: string[];
};

export function inspectStockBlogEditorialContract(
  body: string,
  contentType: StockReferenceBriefingTemplate,
): StockBlogEditorialContractInspection {
  const policy = getStockBlogEditorialPolicy(contentType);
  const summary = sectionBody(body, /^\d+\.\s*30초\s*요약$/);
  const coreNumbers = sectionBody(body, /^\d+\..*핵심\s*숫자/);
  const coreVariables = sectionBody(body, /^\d+\..*핵심\s*변수\s*2가지/);
  const scenarios = sectionBody(body, /^\d+\..*(?:상승.*하락|하락.*상승).*(?:조건|시나리오)/);
  const beginner = sectionBody(body, /^\d+\..*초보자\s*설명/);
  const checklist = sectionBody(body, /^\d+\..*볼\s*것\s*3가지/);
  const summaryLabelPatterns = [
    /(?:^|\n)\s*(?:[-*•]|\d+[.)])?\s*(?:(?:기본|오늘(?:의)?|시장)\s*)?판단\s*[:：]/m,
    /(?:^|\n)\s*(?:[-*•]|\d+[.)])?\s*(?:상방|상승)\s*조건\s*[:：]/m,
    /(?:^|\n)\s*(?:[-*•]|\d+[.)])?\s*(?:하방|하락)\s*조건\s*[:：]/m,
    /(?:^|\n)\s*(?:[-*•]|\d+[.)])?\s*다음\s*확인(?:\s*지표)?\s*[:：]/m,
  ];
  const summaryLabelCount = summaryLabelPatterns
    .filter((pattern) => pattern.test(summary))
    .length;
  const coreVariableMarkers = Array.from(coreVariables.matchAll(/(?:^|\n)\s*(?:[-*•]|\d+[.)])?\s*변수\s*([12])\s*(?:[:：]|은|는)\s*/g))
    .map((match) => match[1]);
  const coreVariableCount = new Set(coreVariableMarkers).size;
  const coreNumberCount = listItemCount(coreNumbers);
  const beginnerExplanationSentenceCount = sentenceCount(beginner);
  const checklistItemCount = listItemCount(checklist);
  const forbiddenPhraseMatches = STOCK_BLOG_HARD_PROHIBITED_PHRASES.filter((phrase) => body.includes(phrase));
  const hasForbiddenEngagementCta = FORBIDDEN_ENGAGEMENT_PATTERNS.some((pattern) => pattern.test(body));
  const excessiveBlankLineRunCount = (body.replace(/\r\n?/g, "\n").match(/\n{3,}|\n[ \t]+\n/g) ?? []).length;
  const hasThirtySecondSummary = Boolean(summary) && summaryLabelCount === 4;
  const hasConditionalScenarios = Boolean(scenarios)
    && /(?:상승|상방)/.test(scenarios)
    && /(?:하락|하방)/.test(scenarios);
  const hasBgMarketNoteJudgment = /(?:^|\n)\s*\d+\.\s*BG\s*Market\s*Note\s*(?:의\s*)?판단\s*$/im.test(body);
  const violations: string[] = [];

  if (!hasThirtySecondSummary) violations.push("30초 요약의 판단·상방 조건·하방 조건·다음 확인 4줄 필요");
  if (coreNumberCount < policy.coreNumberMin || coreNumberCount > policy.coreNumberMax) {
    violations.push(`핵심 숫자 ${policy.coreNumberMin}~${policy.coreNumberMax}개 필요`);
  }
  if (coreVariableCount !== 2) violations.push("핵심 변수는 변수 1·변수 2 두 개만 필요");
  if (!hasConditionalScenarios) violations.push("상승·하락 조건별 시나리오 필요");
  if (beginnerExplanationSentenceCount < 3 || beginnerExplanationSentenceCount > 5) {
    violations.push("초보자 설명은 한 개념 3~5문장 필요");
  }
  if (checklistItemCount !== policy.checklistItemCount) violations.push(`확인 항목은 정확히 ${policy.checklistItemCount}개 필요`);
  if (!hasBgMarketNoteJudgment) violations.push("번호가 붙은 BG Market Note 판단 섹션 필요");
  if (contentType === "WEEKLY_MARKET_REVIEW") {
    const requiredHeadings = policy.bodyStructure.filter((heading) => /^\d+\./.test(heading));
    let headingCursor = -1;
    const missingReviewHeadings = requiredHeadings.filter((heading) => {
      const nextIndex = body.indexOf(heading, headingCursor + 1);
      if (nextIndex < 0) return true;
      headingCursor = nextIndex;
      return false;
    });
    if (missingReviewHeadings.length > 0) {
      violations.push(`토요일 주간 복기 섹션 누락 또는 순서 오류: ${missingReviewHeadings.join(", ")}`);
    }
    if (/^\s*\d+\.\s*다음 주.*(?:핵심 변수|주요 일정|상승·하락 조건)/m.test(body)) {
      violations.push("토요일 글의 다음 주 전망·일정 섹션 금지");
    }
  }
  if (forbiddenPhraseMatches.length > 0) violations.push(`금지 표현 포함: ${forbiddenPhraseMatches.join(", ")}`);
  if (hasForbiddenEngagementCta) violations.push("댓글·공감·이웃·투표형 CTA 금지");
  if (excessiveBlankLineRunCount > 0) violations.push("연속 빈 문단 또는 공백만 있는 문단 금지");

  return {
    hasThirtySecondSummary,
    summaryLabelCount,
    coreNumberCount,
    coreVariableCount,
    hasConditionalScenarios,
    beginnerExplanationSentenceCount,
    checklistItemCount,
    hasBgMarketNoteJudgment,
    forbiddenPhraseMatches,
    hasForbiddenEngagementCta,
    excessiveBlankLineRunCount,
    violations,
  };
}
