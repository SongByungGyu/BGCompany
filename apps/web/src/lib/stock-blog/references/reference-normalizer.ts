import type { BlogImagePrompt, ReferenceBundle, ReferenceItem } from "./reference-types";

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeReferenceItem(item: ReferenceItem): ReferenceItem {
  return {
    ...item,
    title: stripHtml(item.title),
    summary: item.summary ? stripHtml(item.summary) : undefined,
    copyrightPolicy: item.copyrightPolicy ?? "제목/요약을 참고 신호로만 사용하고 원문 문장을 그대로 복사하지 않습니다.",
  };
}

export function summarizeReferenceItems(items: ReferenceItem[]) {
  const keywords = items.flatMap((item) => item.keywords ?? []);
  const repeatedKeywords = Array.from(new Set(keywords)).slice(0, 8);
  return {
    keyThemes: repeatedKeywords.length ? repeatedKeywords : ["지수 흐름", "수급", "금리", "환율"],
    repeatedKeywords,
    differentiationPoints: [
      "뉴스 제목을 나열하지 않고 투자자가 체크할 흐름으로 재구성",
      "매수·매도 추천 대신 관찰 포인트와 리스크 중심으로 정리",
      "네이버 블로그 수동 게시에 맞춘 제목/태그/이미지 프롬프트까지 함께 준비",
    ],
  };
}

export function buildBlogImagePrompts(bundle: ReferenceBundle): BlogImagePrompt[] {
  const themeText = bundle.keyThemes.slice(0, 3).join(", ") || "시장 흐름";
  const negativePrompt = "no logos, no real company trademarks, no copyrighted news photos, no real index numbers, no buy or sell recommendation text, no sensational profit guarantee";
  return [
    {
      id: `${bundle.contentType}-thumbnail`,
      purpose: "thumbnail",
      placement: "네이버 블로그 대표 썸네일",
      title: "시장 브리핑 썸네일",
      textOverlay: bundle.market === "US" ? "오늘 밤 미국장 체크" : "오늘의 증시 체크",
      aspectRatio: "16:9",
      prompt: `Clean Korean financial blog thumbnail, abstract stock market dashboard, calm blue and green gradient, simplified candlestick shapes without real numbers, theme keywords: ${themeText}, readable Korean text area, professional but not alarmist`,
      negativePrompt,
      notes: ["실제 종목 로고와 실시간 지수 숫자는 넣지 않습니다.", "투자 수익 보장/추천 문구를 넣지 않습니다."],
    },
    {
      id: `${bundle.contentType}-market-flow`,
      purpose: "section",
      placement: "시장 요약 섹션",
      title: "시장 흐름 인포그래픽",
      aspectRatio: "4:3",
      prompt: `Minimal infographic for Korean stock market briefing, arrows showing neutral market flow, sectors represented by generic icons, no brand logos, no exact price or index numbers, soft newspaper editorial style, themes: ${themeText}`,
      negativePrompt,
      notes: ["섹터는 범용 아이콘으로만 표현합니다.", "뉴스 사진을 재현하지 않습니다."],
    },
    {
      id: `${bundle.contentType}-checklist`,
      purpose: "inline",
      placement: "투자자 체크리스트 섹션",
      title: "체크리스트 카드",
      aspectRatio: "1:1",
      prompt: "Square checklist card for a Naver finance blog, clean notebook style, checkboxes for rate, FX, earnings, global market, Korean typography space, no tickers, no investment advice, calm professional visual",
      negativePrompt,
      notes: ["체크리스트용 보조 이미지입니다.", "특정 종목 추천처럼 보이지 않게 유지합니다."],
    },
  ];
}
