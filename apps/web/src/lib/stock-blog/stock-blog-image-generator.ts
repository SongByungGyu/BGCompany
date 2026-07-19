import "server-only";

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { buildStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";
import type { MarketSnapshot, MarketSnapshotMetric } from "@/lib/stock-blog/references/reference-types";
import { evaluateStockBlogImageQuality } from "@/lib/stock-blog/stock-blog-image-quality";
import type { StockBlogContentImage, StockBlogImageDataPoint, StockBlogImageQualityAudit } from "@/lib/stock-blog/stock-blog-image-types";

export type GeneratedStockBlogImages = {
  thumbnailImageUrl?: string;
  inlineImageUrls: string[];
  contentImages: StockBlogContentImage[];
  imageQuality: StockBlogImageQualityAudit;
  imageStatus: "generated" | "failed";
  imageGeneratedAt: string;
  imageErrorMessage?: string;
};

type ImageTheme = {
  eyebrow: string;
  marketLabel: string;
  accent: string;
  secondary: string;
  skyline: string;
};

const THEMES: Record<StockBriefingTemplate, ImageTheme> = {
  KOREA_DAILY_PREVIEW: {
    eyebrow: "KOREA MARKET PREVIEW",
    marketLabel: "KOSPI · KOSDAQ",
    accent: "#4DA3FF",
    secondary: "#B8DCFF",
    skyline: "#123D68",
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    eyebrow: "KOREA CLOSE · US PREVIEW",
    marketLabel: "KOSPI · NASDAQ · S&P 500",
    accent: "#D9AB50",
    secondary: "#FFE5A8",
    skyline: "#173653",
  },
  WEEKLY_MARKET_REVIEW: {
    eyebrow: "WEEKLY MARKET REVIEW",
    marketLabel: "GLOBAL WEEKLY FLOW",
    accent: "#56D7B0",
    secondary: "#B9F3E2",
    skyline: "#123F4C",
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    eyebrow: "NEXT WEEK PREVIEW",
    marketLabel: "EVENTS · RATES · EARNINGS",
    accent: "#9B8CFF",
    secondary: "#D8D2FF",
    skyline: "#28355D",
  },
};

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || "pipeline";
}

function splitTitle(value: string, maxLength = 19) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["시장 브리핑"];
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > maxLength) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 2) return lines;
  const visible = lines.slice(0, 2);
  visible[1] = `${visible[1].slice(0, Math.max(1, maxLength - 1))}…`;
  return visible;
}

function truncate(value: string, maxLength: number) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function chartPath(width: number, height: number) {
  const points = [0.14, 0.25, 0.19, 0.43, 0.36, 0.52, 0.48, 0.63, 0.57, 0.76, 0.69, 0.9, 0.8, 0.96];
  return points.map((value, index) => {
    const x = Math.round((index / (points.length - 1)) * width);
    const y = Math.round(height - value * height);
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
}

function gridSvg(width: number, height: number) {
  const vertical = Array.from({ length: 10 }, (_, index) => {
    const x = Math.round((index / 9) * width);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`;
  }).join("");
  const horizontal = Array.from({ length: 6 }, (_, index) => {
    const y = Math.round((index / 5) * height);
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`;
  }).join("");
  return `<g stroke="#AFCBE8" stroke-width="1" opacity="0.09">${vertical}${horizontal}</g>`;
}

function candleSvg(theme: ImageTheme) {
  const candles = [
    [95, 108, 62, 136, 32], [132, 94, 48, 122, 35], [169, 117, 77, 142, 31],
    [206, 83, 41, 119, 34], [243, 67, 34, 103, 31], [280, 89, 51, 126, 34],
    [317, 59, 24, 96, 31], [354, 49, 18, 82, 33], [391, 72, 39, 108, 31],
  ];
  return candles.map(([x, open, close, low, width], index) => {
    const rising = close < open;
    const color = rising ? theme.accent : "#E9899B";
    const bodyY = Math.min(open, close);
    const bodyHeight = Math.max(10, Math.abs(open - close));
    return `<g opacity="${0.58 + index * 0.035}"><line x1="${x + width / 2}" y1="${close - 18}" x2="${x + width / 2}" y2="${low}" stroke="${color}" stroke-width="3"/><rect x="${x}" y="${bodyY}" width="${width}" height="${bodyHeight}" rx="3" fill="${color}"/></g>`;
  }).join("");
}

function skylineSvg(width: number, baseY: number, theme: ImageTheme) {
  const buildings = [
    [0, 145, 72], [70, 105, 54], [122, 170, 86], [205, 120, 62], [265, 195, 78],
    [340, 152, 52], [390, 225, 94], [482, 176, 66], [546, 250, 80], [624, 185, 56],
    [678, 215, 74], [750, 162, 58], [806, 275, 98], [902, 205, 70], [970, 154, 62],
    [1030, 232, 88], [1115, 178, 85],
  ];
  const shapes = buildings.map(([x, height, buildingWidth], index) => {
    const y = baseY - height;
    const windows = Array.from({ length: Math.max(2, Math.floor(buildingWidth / 18)) }, (_, windowIndex) => {
      const wx = x + 9 + windowIndex * 16;
      return `<line x1="${wx}" y1="${y + 18}" x2="${wx}" y2="${baseY - 12}"/>`;
    }).join("");
    return `<g><rect x="${x}" y="${y}" width="${buildingWidth}" height="${height}" fill="${index % 3 === 0 ? "#0A2038" : theme.skyline}" opacity="${0.78 + (index % 3) * 0.07}"/><g stroke="#B9D5EE" stroke-width="2" opacity="0.13">${windows}</g></g>`;
  }).join("");
  return `<g clip-path="url(#cityClip)">${shapes}<rect x="0" y="${baseY}" width="${width}" height="80" fill="#071426"/></g>`;
}

function marketPanelSvg(theme: ImageTheme) {
  const rows = theme.marketLabel.split(" · ").slice(0, 4);
  return `<g transform="translate(830 118)">
    <rect width="250" height="${86 + rows.length * 48}" rx="20" fill="#06182B" opacity="0.78" stroke="#88B7E3" stroke-opacity="0.24"/>
    <text x="24" y="38" fill="${theme.secondary}" font-size="17" font-weight="700" letter-spacing="2" font-family="Arial, sans-serif">MARKET CHECK</text>
    ${rows.map((row, index) => `<g transform="translate(24 ${70 + index * 48})"><text y="18" fill="#EAF3FC" font-size="17" font-weight="700" font-family="Arial, 'Noto Sans KR', sans-serif">${xmlEscape(row)}</text><line x1="128" y1="12" x2="202" y2="12" stroke="${theme.accent}" stroke-width="4" opacity="${0.88 - index * 0.12}"/></g>`).join("")}
  </g>`;
}

function svgCard(input: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  footer: string;
  theme: ImageTheme;
  hero?: boolean;
}) {
  const safeX = 120;
  const lines = splitTitle(input.title, input.hero ? 19 : 13);
  const titleSize = input.hero ? 52 : 50;
  const startY = input.hero ? 286 : 278;
  const titleSvg = lines.map((line, index) => (
    `<text x="${safeX}" y="${startY + index * 66}" fill="#FFFFFF" font-size="${titleSize}" font-weight="800" font-family="'Noto Sans KR', 'Malgun Gothic', Arial, sans-serif" paint-order="stroke" stroke="#061322" stroke-width="3">${xmlEscape(line)}</text>`
  )).join("\n");
  const chartTop = input.hero ? 388 : 360;
  const chartWidth = input.hero ? 900 : 560;
  const chartHeight = 145;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#041326"/><stop offset="0.54" stop-color="#0A2B4E"/><stop offset="1" stop-color="#102F55"/></linearGradient>
    <linearGradient id="overlay" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#031020" stop-opacity="0.96"/><stop offset="0.62" stop-color="#071A30" stop-opacity="0.48"/><stop offset="1" stop-color="#0B2D50" stop-opacity="0.2"/></linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${input.theme.secondary}"/><stop offset="1" stop-color="${input.theme.accent}"/></linearGradient>
    <clipPath id="cityClip"><rect width="${input.width}" height="${input.height}"/></clipPath>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#9BC7ED" opacity="0.13"/></pattern>
  </defs>
  <rect width="100%" height="100%" rx="28" fill="url(#bg)"/>
  <rect width="100%" height="100%" rx="28" fill="url(#dots)"/>
  ${gridSvg(input.width, input.height)}
  <g transform="translate(70 85)">${candleSvg(input.theme)}</g>
  <g transform="translate(${safeX} ${chartTop})"><path d="${chartPath(chartWidth, chartHeight)}" fill="none" stroke="url(#line)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.72" filter="url(#glow)"/></g>
  ${skylineSvg(input.width, input.height - 42, input.theme)}
  <rect width="100%" height="100%" rx="28" fill="url(#overlay)"/>
  <text x="${safeX}" y="70" fill="#FFFFFF" font-size="24" font-weight="800" letter-spacing="2" font-family="Georgia, 'Times New Roman', serif">BG MARKET NOTE</text>
  <text x="${safeX}" y="112" fill="${input.theme.secondary}" font-size="18" font-weight="700" letter-spacing="3" font-family="Arial, sans-serif">${xmlEscape(input.theme.eyebrow)}</text>
  <rect x="${safeX}" y="132" width="96" height="6" rx="3" fill="${input.theme.accent}"/>
  <text x="${safeX}" y="205" fill="#D2E2F1" font-size="22" font-weight="600" font-family="'Noto Sans KR', 'Malgun Gothic', Arial, sans-serif">${xmlEscape(truncate(input.subtitle, input.hero ? 40 : 25))}</text>
  ${titleSvg}
  ${input.hero ? "" : marketPanelSvg(input.theme)}
  <rect x="0" y="${input.height - 64}" width="100%" height="64" fill="#041120" opacity="0.92"/>
  <text x="${safeX}" y="${input.height - 23}" fill="#AFC5DA" font-size="17" font-family="'Noto Sans KR', 'Malgun Gothic', Arial, sans-serif">${xmlEscape(input.footer)}</text>
  <text x="${input.width - safeX}" y="${input.height - 23}" text-anchor="end" fill="#FFFFFF" font-size="18" font-weight="700" font-family="Arial, sans-serif">한국·미국 시장 흐름을 정리하는 브리핑</text>
</svg>`;
}

function numericMetric(metric: MarketSnapshotMetric | undefined, field: "value" | "changePct", label: string) {
  const value = metric?.[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`IMAGE_DATA_MISSING_${label}`);
  if (!metric?.asOf || metric.freshness !== "fresh" || !metric.sourceName || !metric.url) throw new Error(`IMAGE_DATA_UNVERIFIED_${label}`);
  return { value, metric };
}

function dataPoint(key: string, label: string, value: number, unit: string, asOf: string): StockBlogImageDataPoint {
  return { key, label, value, unit, asOf };
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function signed(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function chartFrame(input: { title: string; subtitle: string; source: string; content: string; accent?: string }) {
  const accent = input.accent ?? "#66B3FF";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="chartBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071426"/><stop offset="1" stop-color="#102D4C"/></linearGradient>
  </defs>
  <rect width="1200" height="675" rx="24" fill="url(#chartBg)"/>
  <text x="72" y="62" fill="#FFFFFF" font-size="23" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">BG MARKET NOTE</text>
  <rect x="72" y="82" width="82" height="5" rx="2.5" fill="${accent}"/>
  <text x="72" y="135" fill="#FFFFFF" font-size="36" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.title)}</text>
  <text x="72" y="174" fill="#BFD2E5" font-size="19" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.subtitle)}</text>
  ${input.content}
  <line x1="72" y1="610" x2="1128" y2="610" stroke="#AFCBE8" stroke-opacity="0.22"/>
  <text x="72" y="645" fill="#AFC5DA" font-size="16" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.source)}</text>
</svg>`;
}

function horizontalComparisonSvg(input: {
  title: string;
  subtitle: string;
  source: string;
  rows: Array<{ label: string; value: number; display: string }>;
}) {
  const maxAbs = Math.max(...input.rows.map((row) => Math.abs(row.value)), 0.0001);
  const zeroX = 600;
  const maxWidth = 370;
  const rowSvg = input.rows.map((row, index) => {
    const y = 230 + index * 72;
    const width = Math.max(4, Math.round(Math.abs(row.value) / maxAbs * maxWidth));
    const positive = row.value >= 0;
    const x = positive ? zeroX : zeroX - width;
    const color = positive ? "#52D6A3" : "#F08A9B";
    const valueX = positive ? zeroX + width + 18 : zeroX - width - 18;
    const anchor = positive ? "start" : "end";
    return `<g>
      <text x="210" y="${y + 9}" text-anchor="end" fill="#E9F2FA" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(row.label)}</text>
      <rect x="${x}" y="${y - 19}" width="${width}" height="38" rx="9" fill="${color}" opacity="0.9"/>
      <text x="${valueX}" y="${y + 9}" text-anchor="${anchor}" fill="#FFFFFF" font-size="19" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">${xmlEscape(row.display)}</text>
    </g>`;
  }).join("");
  const content = `<line x1="${zeroX}" y1="205" x2="${zeroX}" y2="570" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="2"/>
    <text x="${zeroX}" y="198" text-anchor="middle" fill="#9CB4CA" font-size="14" font-family="Arial,sans-serif">0</text>${rowSvg}`;
  return chartFrame({ ...input, content });
}

function ratesAndFxSvg(input: {
  fx: number;
  fxChange: number;
  twoYear: number;
  tenYear: number;
  spread: number;
  source: string;
}) {
  const maxRate = Math.max(input.twoYear, input.tenYear, 0.01);
  const rateRows = [
    { label: "미국 2년물", value: input.twoYear, y: 330 },
    { label: "미국 10년물", value: input.tenYear, y: 430 },
  ].map((row) => `<g><text x="650" y="${row.y}" fill="#DDEAF5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${row.label}</text><rect x="650" y="${row.y + 18}" width="390" height="28" rx="8" fill="#193B5A"/><rect x="650" y="${row.y + 18}" width="${Math.round(row.value / maxRate * 390)}" height="28" rx="8" fill="#9B8CFF"/><text x="1065" y="${row.y + 41}" text-anchor="end" fill="#FFFFFF" font-size="19" font-weight="800" font-family="Arial,sans-serif">${row.value.toFixed(2)}%</text></g>`).join("");
  const content = `<g>
    <rect x="72" y="218" width="490" height="335" rx="20" fill="#0A2138" stroke="#75BFFF" stroke-opacity="0.3"/>
    <text x="112" y="273" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원·달러 환율</text>
    <text x="112" y="380" fill="#FFFFFF" font-size="68" font-weight="800" font-family="Arial,sans-serif">${input.fx.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</text>
    <text x="112" y="430" fill="#BFD2E5" font-size="21" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원 · 전일 대비 ${signed(input.fxChange)}%</text>
    <text x="650" y="260" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">미국 국채금리 비교</text>
    ${rateRows}
    <text x="650" y="535" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">10년-2년 금리차</text>
    <text x="1065" y="535" text-anchor="end" fill="#FFFFFF" font-size="22" font-weight="800" font-family="Arial,sans-serif">${input.spread.toFixed(2)}%p</text>
  </g>`;
  return chartFrame({ title: "환율과 미국 국채금리 현황", subtitle: "서로 다른 단위는 분리된 영역으로 표시했습니다.", source: input.source, content, accent: "#9B8CFF" });
}

function blockedImageResult(generatedAt: string, message: string): GeneratedStockBlogImages {
  return {
    inlineImageUrls: [],
    contentImages: [],
    imageQuality: {
      status: "blocked",
      checkedAt: generatedAt,
      bodyImageCount: 0,
      chartImageCount: 0,
      relatedImageCount: 0,
      generatedImageCount: 0,
      externalImageCount: 0,
      checks: [],
      issues: [{ code: "image_quality_failed", message }],
    },
    imageStatus: "failed",
    imageGeneratedAt: generatedAt,
    imageErrorMessage: message,
  };
}

export async function generateStockBlogImages(input: {
  pipelineId: string;
  template: StockBriefingTemplate;
  title: string;
  topic: string;
  marketDate?: string;
  marketSnapshot?: MarketSnapshot;
}): Promise<GeneratedStockBlogImages> {
  const generatedAt = new Date().toISOString();
  const snapshot = input.marketSnapshot;
  if (!snapshot || snapshot.status !== "ready" || snapshot.dataQuality !== "verified" || snapshot.freshness?.status !== "fresh" || snapshot.fallbackUsed !== false) {
    return blockedImageResult(generatedAt, "검증된 최신 MarketSnapshot이 없어 데이터 차트를 생성하지 않았습니다.");
  }
  const id = safeSegment(input.pipelineId);
  const relativeDir = `/generated/stock-blog/${id}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", id);
  const theme = THEMES[input.template];
  const footer = `${input.marketDate || generatedAt.slice(0, 10)} · BG Market Note original graphic`;
  const editorialTitle = buildStockBlogEditorialTitle({
    template: input.template,
    marketDate: input.marketDate,
    sourceTitle: input.title,
  });
  try {
    const kospi = numericMetric(snapshot.korea?.kospi, "changePct", "KOSPI_CHANGE");
    const kosdaq = numericMetric(snapshot.korea?.kosdaq, "changePct", "KOSDAQ_CHANGE");
    const sp500 = numericMetric(snapshot.us?.sp500, "changePct", "SP500_CHANGE");
    const nasdaq = numericMetric(snapshot.us?.nasdaq, "changePct", "NASDAQ_CHANGE");
    const dow = numericMetric(snapshot.us?.dow, "changePct", "DOW_CHANGE");
    const fx = numericMetric(snapshot.us?.fx, "value", "USDKRW_VALUE");
    const fxChange = numericMetric(snapshot.us?.fx, "changePct", "USDKRW_CHANGE");
    const twoYear = numericMetric(snapshot.macro?.us2Year, "value", "US2Y_VALUE");
    const tenYear = numericMetric(snapshot.macro?.us10Year, "value", "US10Y_VALUE");
    const spread = numericMetric(snapshot.macro?.yieldSpread10Y2Y, "value", "SPREAD_VALUE");
    const flows = snapshot.korea?.investorFlows ?? [];
    const kospiFlows = [
      { index: flows.findIndex((metric) => metric.label === "KOSPI 외국인 순매수"), label: "외국인" },
      { index: flows.findIndex((metric) => metric.label === "KOSPI 기관 순매수"), label: "기관" },
      { index: flows.findIndex((metric) => metric.label === "KOSPI 개인 순매수"), label: "개인" },
    ].map((item) => {
      if (item.index < 0) throw new Error(`IMAGE_DATA_MISSING_KOSPI_FLOW_${item.label}`);
      const metric = numericMetric(flows[item.index], "value", `KOSPI_FLOW_${item.label}`);
      return { ...item, ...metric };
    });

    await mkdir(outputDir, { recursive: true });
    const indexSource = `기준일 ${dateLabel(kospi.metric.asOf!)}(한국) · ${dateLabel(sp500.metric.asOf!)}(미국) | 출처 한국투자증권 Open API`;
    const flowSource = `기준일 ${dateLabel(kospiFlows[0].metric.asOf!)} | 단위 조원 | 출처 한국투자증권 Open API`;
    const macroSource = `기준일 ${dateLabel(tenYear.metric.asOf!)}(금리) · ${dateLabel(fx.metric.asOf!)}(환율) | 출처 한국투자증권 Open API · FRED`;
    const files = [
      {
        name: "thumbnail.svg",
        svg: svgCard({ width: 1200, height: 675, title: editorialTitle, subtitle: input.topic, footer, theme, hero: true }),
      },
      {
        name: "major-index-change.svg",
        svg: horizontalComparisonSvg({
          title: "한국·미국 주요 지수 등락 비교",
          subtitle: "각 시장의 최근 거래일 등락률을 같은 단위로 비교했습니다.",
          source: indexSource,
          rows: [
            { label: "KOSPI", value: kospi.value, display: `${signed(kospi.value)}%` },
            { label: "KOSDAQ", value: kosdaq.value, display: `${signed(kosdaq.value)}%` },
            { label: "S&P 500", value: sp500.value, display: `${signed(sp500.value)}%` },
            { label: "NASDAQ", value: nasdaq.value, display: `${signed(nasdaq.value)}%` },
            { label: "Dow Jones", value: dow.value, display: `${signed(dow.value)}%` },
          ],
        }),
      },
      {
        name: "kospi-investor-flow.svg",
        svg: horizontalComparisonSvg({
          title: "KOSPI 투자자별 순매수 비교",
          subtitle: "백만원 단위 원자료를 조원으로 환산했습니다.",
          source: flowSource,
          rows: kospiFlows.map((flow) => ({ label: flow.label, value: flow.value / 1_000_000, display: `${signed(flow.value / 1_000_000)}조원` })),
        }),
      },
      {
        name: "fx-and-us-yields.svg",
        svg: ratesAndFxSvg({
          fx: fx.value,
          fxChange: fxChange.value,
          twoYear: twoYear.value,
          tenYear: tenYear.value,
          spread: spread.value,
          source: macroSource,
        }),
      },
    ];
    await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
    const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
    if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
    const contentImages: StockBlogContentImage[] = [
      {
        id: "thumbnail",
        role: "thumbnail",
        type: "thumbnail",
        title: editorialTitle,
        placementAfterHeading: "__thumbnail__",
        imageUrl: `${relativeDir}/thumbnail.svg`,
        caption: "다음 주 한국·미국 증시 전망",
        sourceLabel: "BG Market Note 자체 제작",
        sourceName: "BG Market Note",
        licenseType: "generated",
        collectedAt: generatedAt,
        usageAllowed: true,
        dataKeys: [],
        dataPoints: [],
        width: 1200,
        height: 675,
        fileFormat: "image/svg+xml",
        uploadFormat: "image/png",
        fileVerified: true,
      },
      {
        id: "major-index-change",
        role: "body",
        type: "chart",
        title: "한국·미국 주요 지수 등락 비교",
        placementAfterHeading: "1. 지난주 시장은 어땠을까",
        imageUrl: `${relativeDir}/major-index-change.svg`,
        caption: "최근 거래일 기준 한국과 미국 주요 지수 등락률 비교",
        sourceLabel: indexSource,
        sourceName: "한국투자증권 Open API",
        sourceUrl: kospi.metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: ["korea.kospi.changePct", "korea.kosdaq.changePct", "us.sp500.changePct", "us.nasdaq.changePct", "us.dow.changePct"],
        dataPoints: [
          dataPoint("korea.kospi.changePct", "KOSPI", kospi.value, "%", kospi.metric.asOf!),
          dataPoint("korea.kosdaq.changePct", "KOSDAQ", kosdaq.value, "%", kosdaq.metric.asOf!),
          dataPoint("us.sp500.changePct", "S&P 500", sp500.value, "%", sp500.metric.asOf!),
          dataPoint("us.nasdaq.changePct", "NASDAQ", nasdaq.value, "%", nasdaq.metric.asOf!),
          dataPoint("us.dow.changePct", "Dow Jones", dow.value, "%", dow.metric.asOf!),
        ],
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      },
      {
        id: "kospi-investor-flow",
        role: "body",
        type: "chart",
        title: "KOSPI 투자자별 순매수 비교",
        placementAfterHeading: "2. 다음 주 한국 증시 전망",
        imageUrl: `${relativeDir}/kospi-investor-flow.svg`,
        caption: "외국인·기관·개인의 KOSPI 순매수 비교",
        sourceLabel: flowSource,
        sourceName: "한국투자증권 Open API",
        sourceUrl: kospiFlows[0].metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: kospiFlows.map((flow) => `korea.investorFlows.${flow.index}.value`),
        dataPoints: kospiFlows.map((flow) => dataPoint(`korea.investorFlows.${flow.index}.value`, flow.label, flow.value, "백만원", flow.metric.asOf!)),
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      },
      {
        id: "fx-and-us-yields",
        role: "body",
        type: "chart",
        title: "원·달러 환율과 미국 국채금리 현황",
        placementAfterHeading: "3. 다음 주 미국 증시 전망",
        imageUrl: `${relativeDir}/fx-and-us-yields.svg`,
        caption: "원·달러 환율과 미국 2년물·10년물 국채금리 비교",
        sourceLabel: macroSource,
        sourceName: "한국투자증권 Open API · FRED",
        sourceUrl: tenYear.metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: ["us.fx.value", "us.fx.changePct", "macro.us2Year.value", "macro.us10Year.value", "macro.yieldSpread10Y2Y.value"],
        dataPoints: [
          dataPoint("us.fx.value", "USD/KRW", fx.value, "원", fx.metric.asOf!),
          dataPoint("us.fx.changePct", "USD/KRW 등락률", fxChange.value, "%", fxChange.metric.asOf!),
          dataPoint("macro.us2Year.value", "미국 2년물", twoYear.value, "%", twoYear.metric.asOf!),
          dataPoint("macro.us10Year.value", "미국 10년물", tenYear.value, "%", tenYear.metric.asOf!),
          dataPoint("macro.yieldSpread10Y2Y.value", "10Y-2Y", spread.value, "%p", spread.metric.asOf!),
        ],
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      },
    ];
    const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot);
    if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
    return {
      thumbnailImageUrl: `${relativeDir}/thumbnail.svg`,
      inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl),
      contentImages,
      imageQuality,
      imageStatus: "generated",
      imageGeneratedAt: generatedAt,
    };
  } catch (error) {
    return blockedImageResult(generatedAt, error instanceof Error ? error.message : "Stock blog image generation failed");
  }
}
