import type { ContentPipelineRun, StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type ThumbnailAutomationStatus = "copy_ready" | "image_pending" | "generated" | "failed";

export type StockBlogThumbnailVariant = {
  id: string;
  label: string;
  thumbnailTitle: string;
  thumbnailSubtitle: string;
  thumbnailHook: string;
  thumbnailStyle: string;
  thumbnailPrompt: string;
};

export type StockBlogThumbnailResult = {
  thumbnailTitle: string;
  thumbnailSubtitle: string;
  thumbnailHook: string;
  thumbnailStyle: string;
  thumbnailPrompt: string;
  thumbnailStatus: ThumbnailAutomationStatus;
  thumbnailImageUrl?: string;
  thumbnailVariants: StockBlogThumbnailVariant[];
  thumbnailErrorMessage?: string;
  thumbnailTemplateType: StockBriefingTemplate;
  thumbnailPrimaryText: string;
  thumbnailSecondaryText: string;
  thumbnailKeywords: string[];
};

type ThumbnailTemplateConfig = {
  templateType: StockBriefingTemplate;
  mainTitle: string;
  subtitle: string;
  hook: string;
  style: string;
  colors: string;
  promptFocus: string;
  keywords: string[];
  variants: Array<{ label: string; title: string; subtitle: string; hook: string }>;
};

const PROHIBITED_EXPRESSIONS = ["급등 확정", "무조건 상승", "매수 추천", "수익 보장", "상한가 확정", "폭등", "몰빵"];

export const STOCK_BLOG_THUMBNAIL_TEMPLATES: Record<StockBriefingTemplate, ThumbnailTemplateConfig> = {
  KOREA_DAILY_PREVIEW: {
    templateType: "KOREA_DAILY_PREVIEW",
    mainTitle: "오늘의 한국장 전망",
    subtitle: "코스피·코스닥 핵심 변수",
    hook: "환율·금리·수급·주도 섹터 체크",
    style: "BG Market Note 전용 16:9 금융 에디토리얼 카드, 짙은 네이비 도시 실루엣, 화이트 대형 제목, 블루 차트 포인트",
    colors: "deep navy / white / market blue",
    promptFocus: "한국 증시 장전 브리핑, 특정 건물을 재현하지 않은 한국형 도시 실루엣, 코스피·코스닥 추상 차트 라인, 캔들 차트, 글로벌 마켓 보드",
    keywords: ["한국장", "장전", "환율", "금리", "섹터"],
    variants: [
      { label: "한국장 전망", title: "오늘의 한국장 전망", subtitle: "코스피·코스닥", hook: "금리·환율·수급 체크" },
      { label: "핵심 변수", title: "한국 증시 핵심 변수", subtitle: "오늘의 시장 프리뷰", hook: "주도 섹터와 수급 점검" },
    ],
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    templateType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    mainTitle: "오늘의 미국장 전망",
    subtitle: "전일 미국장 복기·오늘 밤 전망",
    hook: "나스닥·금리·선물·실적 체크",
    style: "BG Market Note 전용 16:9 금융 에디토리얼 카드, 야간 도시 실루엣, 네이비 배경, 화이트 대형 제목, 골드 포인트",
    colors: "deep navy / white / gold",
    promptFocus: "전일 미국 증시 마감과 오늘 미국장 전망, 타사 로고 없는 글로벌 도시 실루엣, 나스닥·S&P500 추상 차트 패널, 미국 국채금리와 야간 시장 모니터",
    keywords: ["미국장전망", "나스닥", "S&P500", "미국금리", "경제일정"],
    variants: [
      { label: "미국장 전망", title: "오늘의 미국장 전망", subtitle: "전일 미국장 복기", hook: "나스닥·금리·실적 체크" },
      { label: "미장 복기+전망", title: "전일 미장·오늘 전망", subtitle: "S&P500·나스닥", hook: "오늘 밤 핵심 변수" },
    ],
  },
  WEEKLY_MARKET_REVIEW: {
    templateType: "WEEKLY_MARKET_REVIEW",
    mainTitle: "한국·미국 주간 시장 정리",
    subtitle: "이번 주 증시 흐름",
    hook: "지수·수급·주도 업종을 한눈에",
    style: "BG Market Note 전용 16:9 주간 리포트 표지, 딥 네이비 그라데이션, 도시 실루엣, 골드 라인, 주간 지수 그래프",
    colors: "deep navy / white / soft green",
    promptFocus: "한국·미국 한 주 증시 복기, 타사 로고 없는 글로벌 도시 실루엣, 코스피·나스닥 주간 흐름, 외국인 수급과 주도 업종을 보여주는 추상 그래프",
    keywords: ["주간증시", "시장정리", "코스피", "나스닥", "주간수급", "주도업종"],
    variants: [
      { label: "주간 리뷰", title: "한국·미국 주간 시장 정리", subtitle: "이번 주 핵심 흐름", hook: "수급·섹터·리스크 정리" },
      { label: "섹터 복기", title: "주간 섹터 흐름 한눈에", subtitle: "한국·미국 증시", hook: "주도 업종·수급 복기" },
    ],
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    templateType: "NEXT_WEEK_MARKET_PREVIEW",
    mainTitle: "다음 주 증시 전망",
    subtitle: "경제지표·실적 일정",
    hook: "한 주를 시작하기 전 확인할 변수",
    style: "BG Market Note 전용 16:9 프리뷰 카드, 딥 네이비 배경, 글로벌 도시 실루엣, 화이트 대형 제목, 퍼플·블루 포인트",
    colors: "deep navy / white / violet blue",
    promptFocus: "다음 주 증시 일정 프리뷰, 타사 로고 없는 글로벌 도시 실루엣, 경제 캘린더, 기업 실적 일정, 금리와 물가 지표를 상징하는 추상 아이콘",
    keywords: ["다음주증시", "경제지표", "실적", "일정", "프리뷰"],
    variants: [
      { label: "다음 주 전망", title: "다음 주 증시 전망", subtitle: "주요 일정과 변수", hook: "지표·실적·금리 이벤트" },
      { label: "다음 주 변수", title: "다음 주 시장 체크", subtitle: "한국·미국 증시", hook: "한 주 전 점검하는 리스크" },
    ],
  },
  INVESTMENT_STUDY: {
    templateType: "INVESTMENT_STUDY",
    mainTitle: "오늘의 투자 공부",
    subtitle: "숫자와 사례로 이해",
    hook: "한 가지 개념을 제대로 익히기",
    style: "BG Market Note 전용 16:9 투자 교육 카드, 딥 네이비 배경, 화이트 대형 제목, 민트 포인트, 정돈된 인포그래픽",
    colors: "deep navy / white / mint",
    promptFocus: "초보 투자자를 위한 주식 개념 학습, 재무제표와 계산식을 상징하는 추상 숫자·표·차트, 실제 기업 사례를 보여주는 교육형 인포그래픽, 타사 로고 없음",
    keywords: ["투자공부", "주식기초", "재무제표", "주식용어", "투자체크리스트"],
    variants: [
      { label: "투자 공부", title: "오늘의 투자 공부", subtitle: "숫자로 이해하는 주식", hook: "개념·사례·주의점" },
      { label: "주식 기초", title: "주식 개념 한 가지", subtitle: "실제 사례로 이해", hook: "초보 투자자 체크" },
    ],
  },
  LARGE_CAP_DISCLOSURE_EARNINGS: {
    templateType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    mainTitle: "대형주 공시·실적",
    subtitle: "공식 발표 핵심 숫자",
    hook: "매출·이익·가이던스 영향 체크",
    style: "BG Market Note 전용 16:9 기업 실적 카드, 딥 네이비 배경, 화이트 대형 제목, 골드와 시안 데이터 포인트",
    colors: "deep navy / white / gold cyan",
    promptFocus: "대형주 공식 공시와 실적 발표, 기업 로고 없는 재무제표·막대 그래프·컨퍼런스 발표 장면의 추상 금융 인포그래픽",
    keywords: ["공시분석", "실적발표", "대형주", "기업분석", "가이던스"],
    variants: [
      { label: "공시 체크", title: "대형주 공시 체크", subtitle: "공식 발표 핵심", hook: "숫자와 주가 영향" },
      { label: "실적 분석", title: "대형주 실적 분석", subtitle: "매출·이익·가이던스", hook: "다음 분기 조건 체크" },
    ],
  },
};

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: Array<string | undefined | null>, limit = 10) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const item = clean(value).replace(/^#/, "");
    if (!item || seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  return result.slice(0, limit);
}

function safeText(value: string) {
  return PROHIBITED_EXPRESSIONS.reduce((text, expression) => text.replaceAll(expression, "체크"), value).trim();
}

function trimForThumbnail(value: string, fallback: string, maxLength = 28) {
  const cleaned = safeText(clean(value) || fallback);
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function inferStockBriefingTemplateFromPipeline(pipeline: ContentPipelineRun): StockBriefingTemplate {
  const source = `${pipeline.title} ${pipeline.topic} ${pipeline.writerResult?.finalTitle ?? ""}`.toLowerCase();
  if (source.includes("공시") || source.includes("실적 발표") || source.includes("10-q") || source.includes("10-k")) return "LARGE_CAP_DISCLOSURE_EARNINGS";
  if (source.includes("투자 공부") || source.includes("재무제표") || source.includes("주식 기초")) return "INVESTMENT_STUDY";
  if (source.includes("다음 주") || source.includes("next week") || source.includes("일정")) return "NEXT_WEEK_MARKET_PREVIEW";
  if (source.includes("주간") || source.includes("금주") || source.includes("weekly")) return "WEEKLY_MARKET_REVIEW";
  if (source.includes("미국") || source.includes("us") || source.includes("나스닥") || source.includes("미장")) return "KOREA_MARKET_CLOSE_US_PREVIEW";
  return "KOREA_DAILY_PREVIEW";
}

export function buildStockBlogThumbnail(pipeline: ContentPipelineRun, preferredTemplate?: StockBriefingTemplate): StockBlogThumbnailResult {
  const templateType = preferredTemplate ?? pipeline.naverBlogPublishPrep?.briefingTemplate ?? inferStockBriefingTemplateFromPipeline(pipeline);
  const template = STOCK_BLOG_THUMBNAIL_TEMPLATES[templateType];
  const titleSource = clean(pipeline.marketingResult?.thumbnailCopy)
    || clean(pipeline.plannerResult?.thumbnailIdea)
    || clean(pipeline.writerResult?.finalTitle)
    || clean(pipeline.outputTitle)
    || pipeline.title;
  const subtitleSource = clean(pipeline.topic) || template.subtitle;
  const hookSource = clean(pipeline.marketingResult?.introHook) || template.hook;
  const thumbnailTitle = trimForThumbnail(titleSource, template.mainTitle, 24);
  const thumbnailSubtitle = trimForThumbnail(subtitleSource, template.subtitle, 30);
  const thumbnailHook = trimForThumbnail(hookSource, template.hook, 34);
  const thumbnailKeywords = unique([
    ...template.keywords,
    ...(pipeline.writerResult?.usedSeoKeywords ?? []),
    ...(pipeline.marketingResult?.seoKeywords ?? []),
    ...(pipeline.plannerResult?.seoKeywords ?? []),
  ], 12);
  const thumbnailStyle = `${template.style} · 색상: ${template.colors}`;
  const thumbnailPrompt = [
    "Naver blog thumbnail, original BG Market Note Korean financial editorial cover, 16:9 landscape card.",
    `Main title text: ${thumbnailTitle}.`,
    `Subtitle text: ${thumbnailSubtitle}.`,
    `Hook text: ${thumbnailHook}.`,
    `Visual direction: ${template.promptFocus}.`,
    `Style: ${thumbnailStyle}.`,
    "Use a deep navy city-at-night background, large clean Korean typography, one big title and one subtitle, chart/candlestick/global market mood. Keep all text inside the center-safe area. Do not reproduce real news photos or landmarks exactly. No third-party logos, no fake index numbers, no guaranteed profit wording, no buy/sell recommendation.",
  ].join(" ");

  return {
    thumbnailTitle,
    thumbnailSubtitle,
    thumbnailHook,
    thumbnailStyle,
    thumbnailPrompt,
    thumbnailStatus: "copy_ready",
    thumbnailImageUrl: pipeline.naverBlogPublishPrep?.thumbnailImageUrl,
    thumbnailVariants: template.variants.map((variant, index) => ({
      id: `${templateType}-${index + 1}`,
      label: variant.label,
      thumbnailTitle: trimForThumbnail(variant.title, template.mainTitle, 24),
      thumbnailSubtitle: trimForThumbnail(variant.subtitle, template.subtitle, 30),
      thumbnailHook: trimForThumbnail(variant.hook, template.hook, 34),
      thumbnailStyle,
      thumbnailPrompt: [
        "Naver blog thumbnail variant, premium finance card.",
        `Main title text: ${trimForThumbnail(variant.title, template.mainTitle, 24)}.`,
        `Subtitle text: ${trimForThumbnail(variant.subtitle, template.subtitle, 30)}.`,
        `Hook text: ${trimForThumbnail(variant.hook, template.hook, 34)}.`,
        `Visual direction: ${template.promptFocus}.`,
        "No logos, no exaggerated investment claims, no buy/sell recommendation.",
      ].join(" "),
    })),
    thumbnailTemplateType: templateType,
    thumbnailPrimaryText: thumbnailTitle,
    thumbnailSecondaryText: thumbnailSubtitle,
    thumbnailKeywords,
  };
}
