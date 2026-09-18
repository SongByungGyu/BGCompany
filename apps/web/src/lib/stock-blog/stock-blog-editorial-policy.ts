import type { StockReferenceBriefingTemplate } from "@/lib/stock-blog/references/reference-types";
import { inspectNaturalStockBlogLayout, STOCK_BLOG_NATURAL_STYLE_GUIDELINES } from "./stock-blog-natural-style.ts";

export const BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION = 14;

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
  "이번 글에서는",
  "이 글에서는",
  "주목할 필요가 있습니다",
  "확인할 필요가 있습니다",
  "시사하는 바가 큽니다",
  "귀추가 주목됩니다",
  "종합적으로 판단하면",
  "결론적으로",
  "전반적으로 볼 때",
  "가능성을 배제할 수 없습니다",
  "도움이 되셨다면",
  "공감 부탁",
  "댓글 부탁",
  "이웃 추가",
  "서로이웃",
  "투표해주세요",
] as const;

const TRANSLATIONESE_PATTERNS = [
  /이는[^.\n]{0,50}(?:의미|시사)합니다/g,
  /투자자(?:는|들은)[^.\n]{0,40}(?:주목|확인|유의|주의)해야 합니다/g,
  /[^.\n]{0,50}(?:이어질|전개될|나타날) 것으로 예상됩니다/g,
  /(?:먼저|다음으로|마지막으로)[,，]?\s*(?:살펴보면|살펴보겠습니다|알아보면|알아보겠습니다)/g,
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
    minimumHeadingCount: 2,
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
      "제목과 도입은 오늘 코스피·한국장 전망을 중심으로 쓰며, 전일 한국장 마감 원인을 메인 제목으로 다시 소비하지 않습니다.",
      "투자자별 순매수 금액은 직전 거래일의 확정값으로만 설명하고 반드시 전일 수급이라고 밝힙니다. 오늘 수급 금액을 예측하지 말고, 원·달러 환율 안정과 외국인 선물 흐름 같은 관찰 조건에 따라 전일 흐름의 연속·반전 가능성을 시나리오로 씁니다.",
      "오전 한국장 전망에는 별도의 경제 일정·검증 일정 섹션을 만들지 않습니다. 일정이 핵심 변수라면 검증된 항목 하나만 관련 문단에 짧게 연결하고, 그렇지 않으면 생략합니다.",
      "오전 글의 핵심 판단은 상세 본문 한 곳과 마무리 한 곳, 최대 두 곳에서만 다룹니다. 도입에는 확인된 장면과 오늘 볼 변수만 적고 결론을 미리 반복하지 않습니다. 환율 안정·외국인 수급처럼 같은 조건을 표현만 바꿔 세 번 이상 되풀이하지 않습니다.",
      "마무리 뒤에 같은 내용을 다시 요약하는 '한 줄 평'을 덧붙이지 않습니다. '한 줄 평'을 쓰려면 별도 마무리를 만들지 말고 그 문장 자체를 마지막 판단으로 사용하며, 앞 문단과 다른 조건이나 예외를 담습니다.",
      "기사 목록에는 본문 판단의 근거로 실제 사용한 기사만 남깁니다. 오래된 기사나 직접 쓰지 않은 기사를 개수 채우기 위해 넣지 않습니다.",
      "환율 안정·외국인 매도 감소·선물 흐름을 코스피 상승의 필수조건이나 단독 원인으로 쓰지 않습니다. '~해야 오릅니다·함께 움직여야 합니다·줄어야 힘이 붙습니다'처럼 단정하지 말고, 해당 변화가 나타나면 미국장 상승이 국내 지수에 반영될 여지가 커지거나 수급 부담이 줄 수 있다는 가능성 범위로 제한합니다.",
      "전일 한국장 복기에서는 과거 지수와 확정 수급만 2~3문장으로 적고 오늘의 환율·외국인 시나리오를 미리 쓰지 않습니다. 환율과 외국인을 함께 언급하는 상세 시나리오는 전용 소제목 한 곳에만 두고, 같은 소제목 안에서도 관찰 문단을 표현만 바꿔 반복하지 않습니다.",
      "간밤 미국장·금리 문단에서는 국내장의 시초가·개장 직후·오전·장중 유지력·상승분 유지·첫 반응을 쓰지 않습니다. 미국 지수와 금리가 가격 부담에 주는 의미까지만 설명하고, 국내장 관찰 시나리오는 전용 소제목으로 넘깁니다.",
      "상세 시나리오 뒤에 '개장 직후에는·그 뒤에는·높게 출발하는 것과'로 시작하는 별도 확인 문단을 덧붙이지 않습니다. 마무리에서도 시초가·개장 초·오전 상승분·첫 반응·장중 유지력을 다시 쓰지 말고, 코스피와 코스닥처럼 다른 검증 숫자의 차이를 이용해 2문장으로 자연스럽게 끝냅니다.",
      "도입과 미국장 문단에서는 '낙관과 경계 한쪽으로 정하기 어렵다·기대와 부담이 동시에 있다' 같은 양비론 요약을 쓰지 않습니다. 확인된 수치와 그 수치의 구체적인 의미만 남기고 최종 판단은 상세 시나리오에서 한 번만 설명합니다.",
      "시장 수급 숫자를 썼다면 같은 문단에서 '한국투자증권 Open API 코스피 투자자별 매매동향 기준'처럼 자료 이름을 바로 연결합니다. 국내외 지수·환율의 출처만 적고 외국인 순매도 수치의 출처를 빠뜨리지 않습니다.",
      "'우호적인 분위기가 들어오다·장 시작 전에 놓인 재료·편이 맞습니다·편이 좋습니다·자연스럽습니다'처럼 번역투나 조언형 어미를 피하고 확인된 장면을 주어가 분명한 한국어로 직접 적습니다.",
    ]
    : contentType === "KOREA_MARKET_CLOSE_US_PREVIEW"
      ? [
        "17시 미국장 전망 글에서는 전일 S&P500·나스닥·다우 흐름을 검증 숫자로 먼저 짧게 복기하고, 오늘 한국장 마감은 미국장과 연결되는 신호를 2~3문장으로만 언급합니다. 본문의 70% 이상은 오늘 밤 미국장 변수·조건·확인 항목에 배정합니다.",
        "제목과 도입의 1차 검색 의도는 오늘 미국장·나스닥 전망입니다. 오늘 코스피 마감 원인이나 외국인 수급을 메인 제목과 결론으로 사용하지 않습니다.",
        "17시 글의 경제 일정은 marketSnapshot.marketDate와 날짜가 같은 검증 일정만 본문에 사용합니다. 다음 날 이후 일정은 본문과 metaDescription에서 모두 빼고, 당일 일정이 없으면 일정 문단도 만들지 않습니다. metaDescription은 최종 공개 본문에 실제로 남은 내용만 요약합니다.",
        "핵심 판단은 상세 본문 한 곳과 짧은 마무리 한 곳, 최대 두 곳에서만 다룹니다. 도입에서 같은 결론을 미리 반복하지 않습니다. 지수의 상대 강도를 비교할 때는 단순 동반 상승·하락이 아니라 낙폭 축소·상승 전환·다른 지수와의 낙폭 격차처럼 확인 가능한 조건을 정확히 적습니다.",
        "일정 문단이 빠져도 최종 공개 본문은 최소 1,800자를 넘겨야 하며 2,100~2,600자를 목표로 합니다. 분량을 채우려고 같은 결론이나 조건을 되풀이하지 말고, 확인된 숫자의 의미와 판단이 달라지는 조건을 보충합니다.",
      ]
      : contentType === "WEEKLY_MARKET_REVIEW"
        ? [
          "토요일 주간 복기 글은 본문의 70% 이상을 이번 주 한국·미국 지수, 수급, 주도 업종, 금리·환율, 실제 변동 원인에 배정합니다. 다음 주 내용은 이번 주에 확인된 신호가 이어지는지 볼 항목 3개로만 제한합니다.",
          "제목과 도입의 1차 검색 의도는 이번 주 증시 정리입니다. 다음 주 일정·전망·상승 조건을 메인 제목이나 별도 일정 섹션으로 확장하지 않습니다.",
        ]
        : contentType === "NEXT_WEEK_MARKET_PREVIEW"
          ? [
            "일요일 글은 지난주 복기를 2~3문장으로 끝내고, 본문의 70% 이상을 다음 주 주요 이슈 3개·영향 섹터·경제 및 실적 일정·대응 조건에 배정합니다.",
            "제목과 도입의 1차 검색 의도는 다음 주 주요 이슈와 수혜·주의 섹터입니다. 이슈마다 영향 경로와 확인할 공식 일정을 연결하고 단순 테마 나열은 금지합니다.",
          ]
          : contentType === "INVESTMENT_STUDY"
            ? [
              "화요일 글은 이번 주 공식 경제 일정의 발표시간·예상치·시장 영향 질문을 우선하고, 목요일 글은 발표 결과와 실제 주가 반응을 우선합니다. 연결할 일정이나 결과가 없으면 투자자가 실제로 검색하는 실전 질문 하나를 해결합니다.",
              "당일 코스피·미국장 이슈가 선택된 경우 검증된 숫자와 뉴스에서 출발해 원인·전달 경로·실제 사례·흔한 오해 순서로 설명합니다.",
              "검색 제목에는 CPI·PPI·FOMC·코스피·나스닥·외국인 수급·실적처럼 실제 검색어를 앞에 두고, 발표시간·왜·어떻게·받을 수 있을까 같은 구체 질문 하나를 사용합니다. '투자 공부' 같은 포괄어만 제목으로 사용하지 않습니다.",
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
    `최종 공개 본문은 공백 포함 ${bodyLength.min.toLocaleString("ko-KR")}~${bodyLength.max.toLocaleString("ko-KR")}자이며 ${bodyLength.targetMin.toLocaleString("ko-KR")}~${bodyLength.targetMax.toLocaleString("ko-KR")}자를 목표로 합니다. 한 문단에는 한 가지 생각만 담으며 문장 수를 고정하지 않습니다.`,
    "도입은 검색 질문의 답이나 검증된 장면에서 바로 시작합니다. 판단과 그 판단이 달라지는 조건은 관련 문단에 설명하고, 별도의 30초 요약 4줄을 강제하지 않습니다.",
    `핵심 숫자는 검증된 기준일·단위가 있는 값 ${policy.coreNumberMin}~${policy.coreNumberMax}개만 고르고, 숫자의 반복 설명 대신 각각이 시장에 갖는 의미를 한 문장으로 설명합니다.`,
    "핵심 변수는 1~2개에 집중하고 관찰 가능한 조건으로 해석합니다. 변수 1·변수 2나 상승·하락 표를 고정 서식으로 출력하지 않습니다.",
    "초보자 설명은 오늘 자료에 필요한 개념 하나를 관련 문단에서 풀고, 문장 수를 맞추기 위한 반복을 피합니다.",
    "실제로 확인할 시간·지표·조건을 관련 문단에 넣습니다. 체크리스트가 도움이 될 때만 사용하며 항목 수를 억지로 맞추지 않습니다. 댓글·공감·이웃·투표 요구는 금지합니다.",
    "'어제 전망 확인'은 이전 글의 구조화된 판단과 실제 결과가 입력으로 함께 제공된 경우에만 작성합니다. 근거가 없으면 섹션 자체를 생략하고 맞았다고 추정하지 않습니다.",
    ...templateFocusGuidelines,
    "검증된 referenceBundle과 MarketSnapshot에 있는 자료만 사실 근거로 사용합니다. 누락값은 생략하고 전망치와 실제치를 구분하며, 확인되지 않은 원인은 '영향을 줬을 가능성'처럼 범위를 제한합니다.",
    `대표 이미지 1장과 본문 이미지 ${policy.bodyImageMin}~${policy.bodyImageMax}장만 사용합니다. 이미지마다 한 메시지만 담고 캡션·기준일·단위·출처를 표시한 뒤 본문 숫자와 중복 설명하지 않습니다.`,
    "글 끝은 본문, 마무리, 함께 확인한 기사, 투자 유의문구 순서로 고정합니다. 기사 목록은 요약문이 아니라 실제 기사 제목과 원문 URL을 그대로 표시하고, 그 뒤에는 투자 유의문구만 정확히 한 번 둡니다. 내부 링크는 실제 발행 URL이 있을 때만 1~2개 사용하며 생성·추정하지 않습니다.",
    "차분한 개인 투자자가 직접 정리한 것처럼 씁니다. 도입에서 '이번 글에서는' 같은 예고를 하지 말고 검색 질문의 답부터 적습니다. 문단마다 먼저·다음으로·마지막으로를 붙이지 않습니다.",
    "영문 보고서를 옮긴 듯한 명사 나열과 번역투를 쓰지 않습니다. '금리 상승에 따른 성장주 부담 확대'보다 '금리가 오르면 성장주가 먼저 눌릴 수 있습니다'처럼 주어와 서술어가 분명한 한국어 문장으로 씁니다.",
    "'이는 ○○를 시사합니다·투자자들은 주목해야 합니다·○○로 이어질 것으로 예상됩니다'처럼 AI가 자주 쓰는 결론형 문장을 금지합니다. 확인된 사실 뒤에는 그 숫자가 왜 중요한지를 짧고 직접적으로 설명합니다.",
    "증권사 보고서식 과장, 같은 문장 시작과 어미 반복, '결론부터 말씀드리면·쉽게 말하면·살펴보겠습니다·알아보겠습니다' 같은 AI 상투어를 사용하지 않습니다.",
    "같은 핵심 판단은 도입·본문·마무리를 통틀어 최대 두 곳에서만 표현합니다. 이미 설명한 판단을 마지막에 '한 줄 평'이나 요약 문장으로 다시 시작하지 않습니다.",
    "문장 중간 강제 줄바꿈, 내용 없는 빈 문단, 연속된 세 줄 이상의 개행, 특수 공백으로 만든 여백을 금지합니다. 문단 사이는 한 번만 구분합니다.",
    ...STOCK_BLOG_NATURAL_STYLE_GUIDELINES,
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
  const translationeseMatches = TRANSLATIONESE_PATTERNS.flatMap((pattern) => body.match(pattern) ?? []);
  const forbiddenPhraseMatches = Array.from(new Set([
    ...STOCK_BLOG_HARD_PROHIBITED_PHRASES.filter((phrase) => body.includes(phrase)),
    ...translationeseMatches.map((match) => match.trim()),
  ]));
  const hasForbiddenEngagementCta = FORBIDDEN_ENGAGEMENT_PATTERNS.some((pattern) => pattern.test(body));
  const excessiveBlankLineRunCount = (body.replace(/\r\n?/g, "\n").match(/\n{3,}|\n[ \t]+\n/g) ?? []).length;
  const hasThirtySecondSummary = Boolean(summary) && summaryLabelCount === 4;
  const hasConditionalScenarios = Boolean(scenarios)
    && /(?:상승|상방)/.test(scenarios)
    && /(?:하락|하방)/.test(scenarios);
  const hasBgMarketNoteJudgment = /(?:^|\n)\s*\d+\.\s*BG\s*Market\s*Note\s*(?:의\s*)?판단\s*$/im.test(body);
  const violations: string[] = [];
  const narrative = inspectNaturalStockBlogLayout(body);

  if (narrative.active) {
    if (narrative.headingCount < policy.minimumHeadingCount) violations.push("내용에 맞는 소제목 2개 이상 필요");
    if (narrative.openingLength < 40 || narrative.openingLength > 450) violations.push("검증된 장면 또는 질문의 답으로 시작하는 간결한 도입 필요");
    if (narrative.explanationSentenceCount < 1) violations.push("자료의 이유·의미·차이를 풀어주는 설명 필요");
    if (narrative.conditionalSentenceCount < 1) violations.push("판단이 달라지는 관찰 가능한 조건 필요");
    if (narrative.observationSentenceCount < 1) violations.push("독자가 실제로 비교·확인할 내용 필요");
    if (!narrative.hasJudgment) violations.push("자료에서 도출한 글쓴이의 해석·판단 필요");
  } else {
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
    hasBgMarketNoteJudgment: narrative.active ? narrative.hasJudgment : hasBgMarketNoteJudgment,
    forbiddenPhraseMatches,
    hasForbiddenEngagementCta,
    excessiveBlankLineRunCount,
    violations,
  };
}
