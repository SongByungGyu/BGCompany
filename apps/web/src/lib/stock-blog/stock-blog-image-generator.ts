import "server-only";

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { buildStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";
import type { MarketSnapshot, MarketSnapshotMetric, ReferenceBundle, ReferenceFact, ReferenceMetric } from "@/lib/stock-blog/references/reference-types";
import { isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import { isAllowedKisSectorDegradedSnapshot } from "@/lib/stock-blog/references/kis-sector-degraded-policy";
import { isAllowedKisOverseasDegradedSnapshot } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import { evaluateStockBlogImageQuality } from "@/lib/stock-blog/stock-blog-image-quality";
import { getStockBlogImagePlacementHeadings } from "@/lib/stock-blog/stock-blog-image-placements";
import type { StockBlogContentImage, StockBlogImageDataPoint, StockBlogImageQualityAudit } from "@/lib/stock-blog/stock-blog-image-types";
import {
  buildInvestorFlowChartCopy,
  formatInvestorFlowChartValues,
  hasMeaningfulInvestorFlowValues,
  isInvestorFlowDateEligible,
} from "@/lib/stock-blog/investor-flow-policy";

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

type VerifiedInvestorFlow = {
  index: number;
  label: string;
  value: number;
  metric: MarketSnapshotMetric;
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
    marketLabel: "S&P 500 · NASDAQ · US 10Y",
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
  INVESTMENT_STUDY: {
    eyebrow: "INVESTMENT STUDY",
    marketLabel: "CONCEPT · NUMBERS · CASE",
    accent: "#56D7B0",
    secondary: "#B9F3E2",
    skyline: "#123F4C",
  },
  LARGE_CAP_DISCLOSURE_EARNINGS: {
    eyebrow: "OFFICIAL FILING · EARNINGS",
    marketLabel: "DART · SEC · RESULTS",
    accent: "#D9AB50",
    secondary: "#A8E5FF",
    skyline: "#173653",
  },
};

export function getStockBlogImageThemeMarketLabels(template: StockBriefingTemplate) {
  return THEMES[template].marketLabel.split(" · ");
}

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

type VerifiedNumericMetric = ReturnType<typeof numericMetric>;

function dataPoint(key: string, label: string, value: number, unit: string, asOf: string): StockBlogImageDataPoint {
  return { key, label, value, unit, asOf };
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shortDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(5, 10).replace("-", "월 ") + "일";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(date);
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
  const zeroX = 650;
  const maxWidth = 360;
  const rowSvg = input.rows.map((row, index) => {
    const y = 230 + index * 72;
    const width = Math.max(4, Math.round(Math.abs(row.value) / maxAbs * maxWidth));
    const positive = row.value >= 0;
    const x = positive ? zeroX : zeroX - width;
    const color = positive ? "#52D6A3" : "#F08A9B";
    const valueX = positive ? zeroX + width + 18 : zeroX - width - 18;
    const anchor = positive ? "start" : "end";
    return `<g>
      <text x="170" y="${y + 9}" text-anchor="end" fill="#E9F2FA" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(row.label)}</text>
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
  twoYear?: number;
  tenYear?: number;
  spread?: number;
  source: string;
}) {
  const rawRateRows = [
    ...(input.twoYear === undefined ? [] : [{ label: "미국 2년물", value: input.twoYear }]),
    ...(input.tenYear === undefined ? [] : [{ label: "미국 10년물", value: input.tenYear }]),
  ];
  if (rawRateRows.length === 0) {
    const content = `<g>
      <rect x="72" y="218" width="1056" height="335" rx="20" fill="#0A2138" stroke="#75BFFF" stroke-opacity="0.3"/>
      <text x="600" y="294" text-anchor="middle" fill="#BFD2E5" font-size="22" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원·달러 환율</text>
      <text x="600" y="410" text-anchor="middle" fill="#FFFFFF" font-size="82" font-weight="800" font-family="Arial,sans-serif">${input.fx.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</text>
      <text x="600" y="470" text-anchor="middle" fill="#BFD2E5" font-size="23" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원 · 전일 대비 ${signed(input.fxChange)}%</text>
    </g>`;
    return chartFrame({ title: "원·달러 환율 현황", subtitle: "확인된 최신 환율 수치만 표시했습니다.", source: input.source, content, accent: "#9B8CFF" });
  }
  const maxRate = Math.max(...rawRateRows.map((row) => row.value), 0.01);
  const rateRows = rawRateRows.map((row, index, rows) => ({
    ...row,
    y: rows.length === 1 ? 370 : 330 + (index * 100),
  })).map((row) => `<g><text x="650" y="${row.y}" fill="#DDEAF5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${row.label}</text><rect x="650" y="${row.y + 18}" width="390" height="28" rx="8" fill="#193B5A"/><rect x="650" y="${row.y + 18}" width="${Math.round(row.value / maxRate * 390)}" height="28" rx="8" fill="#9B8CFF"/><text x="1065" y="${row.y + 41}" text-anchor="end" fill="#FFFFFF" font-size="19" font-weight="800" font-family="Arial,sans-serif">${row.value.toFixed(2)}%</text></g>`).join("");
  const spreadRow = input.spread === undefined ? "" : `<text x="650" y="535" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">10년-2년 금리차</text>
    <text x="1065" y="535" text-anchor="end" fill="#FFFFFF" font-size="22" font-weight="800" font-family="Arial,sans-serif">${input.spread.toFixed(2)}%p</text>`;
  const content = `<g>
    <rect x="72" y="218" width="490" height="335" rx="20" fill="#0A2138" stroke="#75BFFF" stroke-opacity="0.3"/>
    <text x="112" y="273" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원·달러 환율</text>
    <text x="112" y="380" fill="#FFFFFF" font-size="68" font-weight="800" font-family="Arial,sans-serif">${input.fx.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</text>
    <text x="112" y="430" fill="#BFD2E5" font-size="21" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원 · 전일 대비 ${signed(input.fxChange)}%</text>
    <text x="650" y="260" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">미국 국채금리 비교</text>
    ${rateRows}
    ${spreadRow}
  </g>`;
  return chartFrame({ title: "환율과 미국 국채금리 현황", subtitle: "서로 다른 단위는 분리된 영역으로 표시했습니다.", source: input.source, content, accent: "#9B8CFF" });
}

function yenThumbnailSvg(input: { title: string; subtitle: string; footer: string }) {
  const lines = splitTitle(input.title, 15);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="yenBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#061426"/><stop offset="0.58" stop-color="#0B3144"/><stop offset="1" stop-color="#123B39"/></linearGradient>
    <pattern id="yenGrid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#64DDB3" stroke-opacity="0.08"/></pattern>
  </defs>
  <rect width="1200" height="675" rx="28" fill="url(#yenBg)"/>
  <rect width="1200" height="675" rx="28" fill="url(#yenGrid)"/>
  <text x="92" y="72" fill="#FFFFFF" font-size="24" font-weight="800" letter-spacing="2" font-family="Georgia,'Times New Roman',serif">BG MARKET NOTE</text>
  <text x="92" y="116" fill="#B9F3E2" font-size="18" font-weight="700" letter-spacing="3" font-family="Arial,sans-serif">YEN EXCHANGE STUDY</text>
  <rect x="92" y="136" width="96" height="6" rx="3" fill="#56D7B0"/>
  <text x="92" y="204" fill="#D2E2F1" font-size="22" font-weight="600" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.subtitle)}</text>
  ${lines.map((line, index) => `<text x="92" y="300" dy="${index * 66}" fill="#FFFFFF" font-size="52" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(line)}</text>`).join("")}
  <g transform="translate(790 160)">
    <circle cx="150" cy="150" r="142" fill="#071D2C" stroke="#56D7B0" stroke-width="4"/>
    <circle cx="150" cy="150" r="112" fill="#0F3A3B" stroke="#B9F3E2" stroke-opacity="0.45"/>
    <text x="150" y="150" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-size="120" font-weight="800" font-family="Arial,sans-serif">¥</text>
    <text x="150" y="235" text-anchor="middle" fill="#B9F3E2" font-size="22" font-weight="700" font-family="Arial,sans-serif">100 JPY</text>
  </g>
  <rect x="0" y="611" width="1200" height="64" fill="#041120" opacity="0.94"/>
  <text x="92" y="652" fill="#AFC5DA" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.footer)}</text>
  <text x="1108" y="652" text-anchor="end" fill="#FFFFFF" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">100엔 기준부터 실제 환전가까지</text>
</svg>`;
}

function yenSnapshotSvg(metrics: Record<string, ReferenceMetric>, source: string) {
  const cards = [
    { title: "원·엔 계산값", display: `${metrics["jpy.jpykrw100"].value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`, note: "100엔 기준" },
    { title: "달러·엔", display: metrics["jpy.usdjpy"].value.toFixed(2), note: "1달러당 엔" },
    { title: "일본은행 정책금리", display: `${metrics["jpy.bojPolicyRate"].value.toFixed(2)}%`, note: "무담보 익일물" },
  ];
  const content = cards.map((card, index) => {
    const x = 72 + index * 352;
    return `<g><rect x="${x}" y="235" width="320" height="260" rx="22" fill="#0A2138" stroke="#56D7B0" stroke-opacity="0.38"/><text x="${x + 28}" y="286" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${card.title}</text><text x="${x + 28}" y="380" fill="#FFFFFF" font-size="46" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">${card.display}</text><text x="${x + 28}" y="442" fill="#B9F3E2" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${card.note}</text></g>`;
  }).join("");
  return chartFrame({
    title: "엔화 환율을 볼 때 필요한 세 숫자",
    subtitle: "단위가 다른 환율과 금리는 각각 분리해 표시했습니다.",
    source,
    content,
    accent: "#56D7B0",
  });
}

function yenFormulaSvg(metrics: Record<string, ReferenceMetric>, source: string) {
  const usdKrw = metrics["jpy.usdkrw"].value;
  const usdJpy = metrics["jpy.usdjpy"].value;
  const jpyKrw100 = metrics["jpy.jpykrw100"].value;
  const content = `<g>
    <rect x="72" y="235" width="260" height="215" rx="22" fill="#0A2138" stroke="#56D7B0" stroke-opacity="0.38"/>
    <text x="202" y="288" text-anchor="middle" fill="#BFD2E5" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원·달러</text>
    <text x="202" y="365" text-anchor="middle" fill="#FFFFFF" font-size="43" font-weight="800" font-family="Arial,sans-serif">${usdKrw.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</text>
    <text x="202" y="410" text-anchor="middle" fill="#B9F3E2" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원 ÷</text>
    <rect x="470" y="235" width="260" height="215" rx="22" fill="#0A2138" stroke="#56D7B0" stroke-opacity="0.38"/>
    <text x="600" y="288" text-anchor="middle" fill="#BFD2E5" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">달러·엔</text>
    <text x="600" y="365" text-anchor="middle" fill="#FFFFFF" font-size="43" font-weight="800" font-family="Arial,sans-serif">${usdJpy.toFixed(2)}</text>
    <text x="600" y="410" text-anchor="middle" fill="#B9F3E2" font-size="18" font-family="Arial,sans-serif">× 100 =</text>
    <rect x="868" y="235" width="260" height="215" rx="22" fill="#123B39" stroke="#B9F3E2" stroke-opacity="0.62"/>
    <text x="998" y="288" text-anchor="middle" fill="#BFD2E5" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원·100엔</text>
    <text x="998" y="365" text-anchor="middle" fill="#FFFFFF" font-size="43" font-weight="800" font-family="Arial,sans-serif">${jpyKrw100.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</text>
    <text x="998" y="410" text-anchor="middle" fill="#B9F3E2" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">원</text>
    <path d="M345 343H448" stroke="#56D7B0" stroke-width="7" stroke-linecap="round"/><path d="M743 343H846" stroke="#56D7B0" stroke-width="7" stroke-linecap="round"/>
    <rect x="250" y="500" width="700" height="64" rx="18" fill="#2A2030" stroke="#F0B46A" stroke-opacity="0.48"/>
    <text x="600" y="540" text-anchor="middle" fill="#FFE0B2" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">은행의 실제 환전가는 현찰 스프레드와 환율 우대에 따라 달라집니다.</text>
  </g>`;
  return chartFrame({
    title: "왜 엔화 환율은 100엔 기준일까?",
    subtitle: "원·달러와 달러·엔을 이용한 재정환율 계산 예시입니다.",
    source,
    content,
    accent: "#56D7B0",
  });
}

function yenChecklistSvg(source: string) {
  const steps = [
    { title: "달러·엔", note: "엔화 자체의 강약" },
    { title: "원·달러", note: "원화의 강약" },
    { title: "일본은행", note: "정책금리·회의" },
    { title: "은행 환전가", note: "스프레드·우대" },
  ];
  const content = `<g>${steps.map((step, index) => {
    const x = 55 + index * 285;
    const arrow = index < steps.length - 1 ? `<path d="M${x + 238} 360H${x + 274}" stroke="#56D7B0" stroke-width="7" stroke-linecap="round"/><path d="M${x + 264} 348L${x + 278} 360L${x + 264} 372" fill="none" stroke="#56D7B0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return `<rect x="${x}" y="270" width="238" height="180" rx="22" fill="#0A2138" stroke="#56D7B0" stroke-opacity="0.42"/><circle cx="${x + 32}" cy="304" r="17" fill="#56D7B0"/><text x="${x + 32}" y="311" text-anchor="middle" fill="#071426" font-size="17" font-weight="800" font-family="Arial,sans-serif">${index + 1}</text><text x="${x + 22}" y="355" fill="#FFFFFF" font-size="21" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${step.title}</text><text x="${x + 22}" y="397" fill="#BFD2E5" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${step.note}</text>${arrow}`;
  }).join("")}</g><rect x="210" y="500" width="780" height="62" rx="18" fill="#163A2A" stroke="#56D7B0" stroke-opacity="0.48"/><text x="600" y="539" text-anchor="middle" fill="#B9F3E2" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">매매기준율과 내가 실제로 사는 가격은 같은 숫자가 아닙니다.</text>`;
  return chartFrame({
    title: "엔화 환전 전 확인할 네 가지",
    subtitle: "환율 방향과 실제 결제 비용을 나눠서 확인합니다.",
    source,
    content,
    accent: "#56D7B0",
  });
}

function youthSavingsThumbnailSvg(footer: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs><linearGradient id="ysBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#061426"/><stop offset="0.58" stop-color="#0B3144"/><stop offset="1" stop-color="#123B39"/></linearGradient><pattern id="ysGrid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#64DDB3" stroke-opacity="0.08"/></pattern></defs>
  <rect width="1200" height="675" rx="28" fill="url(#ysBg)"/><rect width="1200" height="675" rx="28" fill="url(#ysGrid)"/>
  <text x="92" y="72" fill="#FFFFFF" font-size="24" font-weight="800" letter-spacing="2" font-family="Georgia,'Times New Roman',serif">BG MARKET NOTE</text>
  <text x="92" y="116" fill="#B9F3E2" font-size="18" font-weight="700" letter-spacing="3" font-family="Arial,sans-serif">YOUTH SAVINGS GUIDE</text><rect x="92" y="136" width="96" height="6" rx="3" fill="#56D7B0"/>
  <text x="92" y="212" fill="#D2E2F1" font-size="22" font-weight="600" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">추가 모집 일정 · 현재 조건 · 미확정 변경안</text>
  <text x="92" y="310" fill="#FFFFFF" font-size="56" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">청년미래적금</text><text x="92" y="382" fill="#FFFFFF" font-size="48" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">지금 신청할 수 있을까?</text>
  <g transform="translate(810 164)"><rect width="270" height="300" rx="30" fill="#071D2C" stroke="#56D7B0" stroke-width="4"/><rect x="42" y="54" width="186" height="112" rx="18" fill="#123B39" stroke="#B9F3E2" stroke-opacity="0.55"/><text x="135" y="105" text-anchor="middle" fill="#B9F3E2" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">월 최대</text><text x="135" y="148" text-anchor="middle" fill="#FFFFFF" font-size="36" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">50만원</text><circle cx="86" cy="226" r="38" fill="#56D7B0"/><text x="86" y="237" text-anchor="middle" fill="#071426" font-size="28" font-weight="800" font-family="Arial,sans-serif">6%</text><circle cx="184" cy="226" r="38" fill="#B9F3E2"/><text x="184" y="237" text-anchor="middle" fill="#071426" font-size="24" font-weight="800" font-family="Arial,sans-serif">12%</text></g>
  <rect x="0" y="611" width="1200" height="64" fill="#041120" opacity="0.94"/><text x="92" y="652" fill="#AFC5DA" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(footer)}</text><text x="1108" y="652" text-anchor="end" fill="#FFFFFF" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">확정 내용과 검토 중 일정을 구분해 정리</text>
</svg>`;
}

function youthSavingsTimelineSvg(facts: Record<string, ReferenceFact>, source: string) {
  const steps = [
    ["1차 신청", facts["youthFutureSavings.initialApplicationPeriod"].value, "접수 종료", "#56D7B0"],
    ["계좌 개설", facts["youthFutureSavings.initialAccountOpeningPeriod"].value, "개설 종료", "#56D7B0"],
    ["추가 가입", facts["youthFutureSavings.additionalRecruitmentStatus"].value, "구체 일정 미공고", "#F0B46A"],
  ];
  const cards = steps.map(([title, value, note, color], index) => {
    const x = 72 + index * 352;
    const arrow = index < 2 ? `<path d="M${x + 320} 356H${x + 342}" stroke="#6F95B6" stroke-width="6" stroke-linecap="round"/><path d="M${x + 333} 345L${x + 345} 356L${x + 333} 367" fill="none" stroke="#6F95B6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return `<rect x="${x}" y="240" width="320" height="230" rx="22" fill="#0A2138" stroke="${color}" stroke-opacity="0.55"/><text x="${x + 28}" y="292" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${title}</text><text x="${x + 28}" y="365" fill="#FFFFFF" font-size="28" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(value)}</text><text x="${x + 28}" y="420" fill="${color}" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${note}</text>${arrow}`;
  }).join("");
  const content = `<g>${cards}</g><rect x="238" y="508" width="724" height="64" rx="18" fill="#2A2030" stroke="#F0B46A" stroke-opacity="0.5"/><text x="600" y="548" text-anchor="middle" fill="#FFE0B2" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">현재 신규 신청 가능 상태: ${xmlEscape(facts["youthFutureSavings.applicationOpenNow"].value)}</text>`;
  return chartFrame({ title: "청년미래적금 모집 일정, 어디까지 왔을까?", subtitle: "끝난 일정과 아직 확정되지 않은 추가 모집을 나눠 표시했습니다.", source, content, accent: "#56D7B0" });
}

function youthSavingsStructureSvg(metrics: Record<string, ReferenceMetric>, source: string) {
  const monthly = metrics["youthFutureSavings.monthlyDepositMaxKrw"].value / 10_000;
  const months = metrics["youthFutureSavings.termMonths"].value;
  const generalPct = metrics["youthFutureSavings.generalMatchPct"].value;
  const preferentialPct = metrics["youthFutureSavings.preferentialMatchPct"].value;
  const generalMax = metrics["youthFutureSavings.generalMonthlyContributionMaxKrw"].value / 10_000;
  const preferentialMax = metrics["youthFutureSavings.preferentialMonthlyContributionMaxKrw"].value / 10_000;
  const content = `<g><rect x="72" y="220" width="1056" height="92" rx="20" fill="#102D46" stroke="#56D7B0" stroke-opacity="0.42"/><text x="112" y="276" fill="#BFD2E5" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">납입 한도</text><text x="338" y="277" fill="#FFFFFF" font-size="31" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">월 최대 ${monthly}만원</text><text x="710" y="276" fill="#BFD2E5" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">만기</text><text x="860" y="277" fill="#FFFFFF" font-size="31" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${months}개월</text><rect x="72" y="344" width="500" height="205" rx="22" fill="#0A2138" stroke="#56D7B0" stroke-opacity="0.48"/><text x="108" y="399" fill="#B9F3E2" font-size="23" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">일반형</text><text x="108" y="475" fill="#FFFFFF" font-size="50" font-weight="800" font-family="Arial,sans-serif">${generalPct}%</text><text x="238" y="470" fill="#BFD2E5" font-size="21" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">정부기여</text><text x="108" y="523" fill="#BFD2E5" font-size="20" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">월 최대 ${generalMax}만원</text><rect x="628" y="344" width="500" height="205" rx="22" fill="#123B39" stroke="#B9F3E2" stroke-opacity="0.58"/><text x="664" y="399" fill="#B9F3E2" font-size="23" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">우대형</text><text x="664" y="475" fill="#FFFFFF" font-size="50" font-weight="800" font-family="Arial,sans-serif">${preferentialPct}%</text><text x="822" y="470" fill="#BFD2E5" font-size="21" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">정부기여</text><text x="664" y="523" fill="#BFD2E5" font-size="20" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">월 최대 ${preferentialMax}만원</text></g>`;
  return chartFrame({ title: "현재 확정된 청년미래적금 구조", subtitle: "2026년 가입 기준 6%·12% 구조입니다. 2027 예산안은 아직 확정 전입니다.", source, content, accent: "#56D7B0" });
}

function youthSavingsChecklistSvg(metrics: Record<string, ReferenceMetric>, facts: Record<string, ReferenceFact>, source: string) {
  const rows = [
    `나이: 만 ${metrics["youthFutureSavings.ageMin"].value}~${metrics["youthFutureSavings.ageMax"].value}세`,
    `병역: 최대 ${metrics["youthFutureSavings.militaryAgeExclusionMaxYears"].value}년 연령 계산에서 제외`,
    `총급여: ${metrics["youthFutureSavings.grossIncomeMaxKrw"].value / 10_000}만원 이하`,
    `가구소득: 일반 ${metrics["youthFutureSavings.householdMedianGeneralPct"].value}% · 우대 ${metrics["youthFutureSavings.householdMedianPreferentialPct"].value}%`,
    `청년도약계좌 중복: ${facts["youthFutureSavings.youthLeapOverlapAllowed"].value}`,
  ];
  const content = `<g>${rows.map((row, index) => `<rect x="120" y="${220 + index * 68}" width="960" height="52" rx="14" fill="${index % 2 === 0 ? "#0A2138" : "#102D46"}" stroke="#56D7B0" stroke-opacity="0.24"/><circle cx="151" cy="${246 + index * 68}" r="13" fill="#56D7B0"/><path d="M145 ${246 + index * 68}l5 5 9-11" fill="none" stroke="#071426" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><text x="184" y="${253 + index * 68}" fill="#FFFFFF" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(row)}</text>`).join("")}</g>`;
  return chartFrame({ title: "신청 전에 확인할 현재 기준", subtitle: "개인소득·가구소득·중복 가입 조건은 새 공고에서 다시 확인해야 합니다.", source, content, accent: "#56D7B0" });
}

function nvidiaThumbnailSvg(input: { title: string; subtitle: string; footer: string; theme: ImageTheme }) {
  const separatedLines = input.title.split(/\s*\|\s*/).filter(Boolean);
  const lines = separatedLines.length === 2 ? separatedLines : splitTitle(input.title, 14);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="nvBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#041326"/><stop offset="0.62" stop-color="#0A2B36"/><stop offset="1" stop-color="#123A35"/></linearGradient>
    <pattern id="nvGrid" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M34 0H0V34" fill="none" stroke="#8EE63F" stroke-opacity="0.08"/></pattern>
  </defs>
  <rect width="1200" height="675" rx="28" fill="url(#nvBg)"/>
  <rect width="1200" height="675" rx="28" fill="url(#nvGrid)"/>
  <text x="92" y="72" fill="#FFFFFF" font-size="24" font-weight="800" letter-spacing="2" font-family="Georgia,'Times New Roman',serif">BG MARKET NOTE</text>
  <text x="92" y="116" fill="#B9F3E2" font-size="18" font-weight="700" letter-spacing="3" font-family="Arial,sans-serif">NVIDIA EARNINGS CHECK</text>
  <rect x="92" y="136" width="96" height="6" rx="3" fill="#76D33C"/>
  <text x="92" y="204" fill="#D2E2F1" font-size="22" font-weight="600" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(truncate(input.subtitle, 44))}</text>
  ${lines.map((line, index) => `<text x="92" y="286" dy="${index * 66}" fill="#FFFFFF" font-size="52" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(line)}</text>`).join("")}
  <g transform="translate(760 150)">
    <rect x="0" y="0" width="310" height="310" rx="30" fill="#071A25" stroke="#8EE63F" stroke-width="4"/>
    <rect x="54" y="54" width="202" height="202" rx="20" fill="#102C33" stroke="#B9F3E2" stroke-opacity="0.55"/>
    <text x="155" y="142" text-anchor="middle" fill="#8EE63F" font-size="26" font-weight="800" font-family="Arial,sans-serif">AI ACCELERATOR</text>
    <text x="155" y="190" text-anchor="middle" fill="#FFFFFF" font-size="34" font-weight="800" font-family="Arial,sans-serif">NVDA</text>
    <text x="155" y="226" text-anchor="middle" fill="#BFD2E5" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">실적 · 가이던스 · HBM</text>
    ${Array.from({ length: 8 }, (_, index) => `<line x1="${36 + index * 34}" y1="-18" x2="${36 + index * 34}" y2="0" stroke="#8EE63F" stroke-width="6"/><line x1="${36 + index * 34}" y1="310" x2="${36 + index * 34}" y2="328" stroke="#8EE63F" stroke-width="6"/>`).join("")}
    ${Array.from({ length: 8 }, (_, index) => `<line x1="-18" y1="${36 + index * 34}" x2="0" y2="${36 + index * 34}" stroke="#8EE63F" stroke-width="6"/><line x1="310" y1="${36 + index * 34}" x2="328" y2="${36 + index * 34}" stroke="#8EE63F" stroke-width="6"/>`).join("")}
  </g>
  <rect x="0" y="611" width="1200" height="64" fill="#041120" opacity="0.94"/>
  <text x="92" y="652" fill="#AFC5DA" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.footer)}</text>
  <text x="1108" y="652" text-anchor="end" fill="#FFFFFF" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">공식 실적과 시장 반응을 함께 확인</text>
</svg>`;
}

function nvidiaEarningsSvg(metrics: Record<string, ReferenceMetric>, source: string) {
  const cards = [
    { key: "nvidia.fy2027.q2.revenue", title: "2분기 매출", display: `$${metrics["nvidia.fy2027.q2.revenue"].value.toFixed(1)}B`, note: "전년 동기 대비 +106%" },
    { key: "nvidia.fy2027.q2.dataCenterRevenue", title: "데이터센터 매출", display: `$${metrics["nvidia.fy2027.q2.dataCenterRevenue"].value.toFixed(1)}B`, note: "전년 동기 대비 +117%" },
    { key: "nvidia.fy2027.q2.nonGaapEps", title: "조정 EPS", display: `$${metrics["nvidia.fy2027.q2.nonGaapEps"].value.toFixed(2)}`, note: "비GAAP 기준" },
    { key: "nvidia.fy2027.q3.revenueGuidance", title: "3분기 매출 가이던스", display: `$${metrics["nvidia.fy2027.q3.revenueGuidance"].value.toFixed(0)}B`, note: "±2% 범위" },
  ];
  const content = cards.map((card, index) => {
    const x = 72 + (index % 2) * 540;
    const y = 220 + Math.floor(index / 2) * 165;
    return `<g><rect x="${x}" y="${y}" width="500" height="132" rx="18" fill="#0A2138" stroke="#76D33C" stroke-opacity="0.38"/><text x="${x + 32}" y="${y + 39}" fill="#BFD2E5" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${card.title}</text><text x="${x + 32}" y="${y + 92}" fill="#FFFFFF" font-size="43" font-weight="800" font-family="Arial,sans-serif">${card.display}</text><text x="${x + 468}" y="${y + 92}" text-anchor="end" fill="#8EE63F" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${card.note}</text></g>`;
  }).join("");
  return chartFrame({
    title: "엔비디아 FY2027 2분기 핵심 숫자",
    subtitle: "실적·데이터센터 매출·다음 분기 가이던스를 한 화면에 정리했습니다.",
    source,
    content,
    accent: "#76D33C",
  });
}

function nvidiaExpectationsSvg(metrics: Record<string, ReferenceMetric>, source: string) {
  const revenueActual = metrics["nvidia.fy2027.q2.revenue"].value;
  const revenueEstimate = metrics["nvidia.fy2027.q2.revenueEstimate"].value;
  const epsActual = metrics["nvidia.fy2027.q2.nonGaapEps"].value;
  const epsEstimate = metrics["nvidia.fy2027.q2.nonGaapEpsEstimate"].value;
  const afterHours = metrics["nvidia.fy2027.q2.afterHoursChangePct"].value;
  const comparison = (x: number, y: number, label: string, actual: number, estimate: number, unit: string, digits: number) => {
    const maximum = Math.max(actual, estimate);
    const actualWidth = Math.round(actual / maximum * 330);
    const estimateWidth = Math.round(estimate / maximum * 330);
    return `<g><rect x="${x}" y="${y}" width="480" height="245" rx="20" fill="#0A2138" stroke="#76D33C" stroke-opacity="0.3"/><text x="${x + 30}" y="${y + 45}" fill="#FFFFFF" font-size="24" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${label}</text><text x="${x + 30}" y="${y + 96}" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">실제</text><rect x="${x + 100}" y="${y + 73}" width="${actualWidth}" height="30" rx="8" fill="#76D33C"/><text x="${x + 445}" y="${y + 97}" text-anchor="end" fill="#FFFFFF" font-size="20" font-weight="800" font-family="Arial,sans-serif">${actual.toFixed(digits)}${unit}</text><text x="${x + 30}" y="${y + 156}" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">예상</text><rect x="${x + 100}" y="${y + 133}" width="${estimateWidth}" height="30" rx="8" fill="#71879C"/><text x="${x + 445}" y="${y + 157}" text-anchor="end" fill="#FFFFFF" font-size="20" font-weight="800" font-family="Arial,sans-serif">${estimate.toFixed(digits)}${unit}</text><text x="${x + 30}" y="${y + 210}" fill="#8EE63F" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">FactSet 예상치 상회</text></g>`;
  };
  const content = `${comparison(72, 218, "매출 비교", revenueActual, revenueEstimate, "B", 2)}${comparison(590, 218, "조정 EPS 비교", epsActual, epsEstimate, "달러", 2)}<rect x="390" y="500" width="420" height="72" rx="18" fill="#163A2A" stroke="#8EE63F" stroke-opacity="0.5"/><text x="600" y="530" text-anchor="middle" fill="#B9F3E2" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">실적 발표 뒤 시간외 반응</text><text x="600" y="562" text-anchor="middle" fill="#FFFFFF" font-size="30" font-weight="800" font-family="Arial,sans-serif">+${afterHours.toFixed(1)}%</text>`;
  return chartFrame({
    title: "시장 예상치와 발표 뒤 반응",
    subtitle: "매출과 EPS는 단위가 달라 각각 비교하고, 시간외 반응은 별도로 표시했습니다.",
    source,
    content,
    accent: "#76D33C",
  });
}

function nvidiaHbmPathSvg(source: string) {
  const steps = [
    { title: "데이터센터 수요", note: "클라우드·AI 투자" },
    { title: "AI 가속기 출하 기대", note: "엔비디아 가이던스" },
    { title: "HBM 수요 기대", note: "가속기당 고대역폭 메모리" },
    { title: "국내 반도체 확인", note: "삼성전자·SK하이닉스 수급" },
  ];
  const content = `<g>${steps.map((step, index) => {
    const x = 55 + index * 285;
    const arrow = index < steps.length - 1 ? `<path d="M${x + 238} 360H${x + 274}" stroke="#8EE63F" stroke-width="7" stroke-linecap="round"/><path d="M${x + 264} 348L${x + 278} 360L${x + 264} 372" fill="none" stroke="#8EE63F" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return `<rect x="${x}" y="270" width="238" height="180" rx="22" fill="#0A2138" stroke="#76D33C" stroke-opacity="0.42"/><circle cx="${x + 32}" cy="${304}" r="17" fill="#76D33C"/><text x="${x + 32}" y="311" text-anchor="middle" fill="#071426" font-size="17" font-weight="800" font-family="Arial,sans-serif">${index + 1}</text><text x="${x + 22}" y="355" fill="#FFFFFF" font-size="21" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${step.title}</text><text x="${x + 22}" y="397" fill="#BFD2E5" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${step.note}</text>${arrow}`;
  }).join("")}</g><rect x="210" y="500" width="780" height="62" rx="18" fill="#2A2030" stroke="#F0B46A" stroke-opacity="0.48"/><text x="600" y="539" text-anchor="middle" fill="#FFE0B2" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">전달 경로일 뿐, 개별 종목의 상승을 보장하지 않습니다.</text>`;
  return chartFrame({
    title: "엔비디아 실적이 국내 HBM주로 전달되는 경로",
    subtitle: "실적 숫자에서 국내 반도체 수급까지는 네 단계를 나눠 확인합니다.",
    source,
    content,
    accent: "#76D33C",
  });
}

function topicThumbnailSvg(input: {
  eyebrow: string;
  title: string;
  subtitle: string;
  badge: string;
  footer: string;
  accent: string;
}) {
  const lines = splitTitle(input.title, 17);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs><linearGradient id="topicBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#061427"/><stop offset="1" stop-color="#12334B"/></linearGradient><pattern id="topicGrid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" fill="none" stroke="${input.accent}" stroke-opacity="0.08"/></pattern></defs>
  <rect width="1200" height="675" rx="28" fill="url(#topicBg)"/><rect width="1200" height="675" rx="28" fill="url(#topicGrid)"/>
  <text x="92" y="72" fill="#FFFFFF" font-size="24" font-weight="800" letter-spacing="2" font-family="Georgia,'Times New Roman',serif">BG MARKET NOTE</text>
  <text x="92" y="116" fill="${input.accent}" font-size="18" font-weight="800" letter-spacing="3" font-family="Arial,sans-serif">${xmlEscape(input.eyebrow)}</text>
  <rect x="92" y="136" width="96" height="6" rx="3" fill="${input.accent}"/>
  <text x="92" y="206" fill="#C8D9E8" font-size="21" font-weight="600" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(truncate(input.subtitle, 46))}</text>
  ${lines.map((line, index) => `<text x="92" y="300" dy="${index * 66}" fill="#FFFFFF" font-size="50" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(line)}</text>`).join("")}
  <g transform="translate(820 176)"><rect width="260" height="260" rx="44" fill="#081C30" stroke="${input.accent}" stroke-width="4"/><circle cx="130" cy="104" r="65" fill="none" stroke="${input.accent}" stroke-width="8"/><path d="M130 62V108L166 132" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><text x="130" y="215" text-anchor="middle" fill="#FFFFFF" font-size="29" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">${xmlEscape(input.badge)}</text></g>
  <rect x="0" y="611" width="1200" height="64" fill="#041120" opacity="0.94"/><text x="92" y="652" fill="#AFC5DA" font-size="17" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.footer)}</text><text x="1108" y="652" text-anchor="end" fill="#FFFFFF" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">주제에 맞는 공식 자료만 시각화</text>
</svg>`;
}

function metricCardsSvg(input: {
  title: string;
  subtitle: string;
  source: string;
  accent: string;
  cards: Array<{ label: string; display: string; note: string }>;
}) {
  const content = `<g>${input.cards.map((card, index) => {
    const x = 72 + index * 350;
    return `<rect x="${x}" y="235" width="316" height="250" rx="24" fill="#0A2138" stroke="${input.accent}" stroke-opacity="0.5"/><text x="${x + 28}" y="286" fill="#BDD1E3" font-size="20" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(card.label)}</text><text x="${x + 28}" y="370" fill="#FFFFFF" font-size="45" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">${xmlEscape(card.display)}</text><text x="${x + 28}" y="430" fill="${input.accent}" font-size="18" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(card.note)}</text>`;
  }).join("")}</g>`;
  return chartFrame({ ...input, content });
}

function flowCardsSvg(input: { title: string; subtitle: string; source: string; accent: string; steps: string[]; caution?: string }) {
  const content = `<g>${input.steps.map((step, index) => {
    const x = 60 + index * 285;
    const arrow = index < input.steps.length - 1 ? `<path d="M${x + 230} 350H${x + 270}" stroke="${input.accent}" stroke-width="7" stroke-linecap="round"/><path d="M${x + 258} 338L${x + 272} 350L${x + 258} 362" fill="none" stroke="${input.accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return `<rect x="${x}" y="265" width="225" height="170" rx="22" fill="#0A2138" stroke="${input.accent}" stroke-opacity="0.48"/><circle cx="${x + 32}" cy="302" r="17" fill="${input.accent}"/><text x="${x + 32}" y="309" text-anchor="middle" fill="#071426" font-size="17" font-weight="800" font-family="Arial,sans-serif">${index + 1}</text><text x="${x + 112}" y="360" text-anchor="middle" fill="#FFFFFF" font-size="20" font-weight="800" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(step)}</text>${arrow}`;
  }).join("")}</g>${input.caution ? `<rect x="190" y="500" width="820" height="62" rx="18" fill="#2A2030" stroke="#F0B46A" stroke-opacity="0.48"/><text x="600" y="539" text-anchor="middle" fill="#FFE0B2" font-size="19" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">${xmlEscape(input.caution)}</text>` : ""}`;
  return chartFrame({ ...input, content });
}

function cpiReleaseTimeSvg(releaseValue: string, source: string) {
  const content = `<g><rect x="110" y="235" width="450" height="265" rx="28" fill="#0A2138" stroke="#9B8CFF" stroke-opacity="0.55"/><text x="335" y="292" text-anchor="middle" fill="#CFC9FF" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">미국 동부시간</text><text x="335" y="370" text-anchor="middle" fill="#FFFFFF" font-size="42" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">9월 11일 08:30</text><text x="335" y="430" text-anchor="middle" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">BLS 공식 발표 일정</text><rect x="640" y="235" width="450" height="265" rx="28" fill="#151D3B" stroke="#56D7B0" stroke-opacity="0.6"/><text x="865" y="292" text-anchor="middle" fill="#B9F3E2" font-size="21" font-weight="700" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">한국시간</text><text x="865" y="370" text-anchor="middle" fill="#FFFFFF" font-size="42" font-weight="800" font-family="Arial,'Noto Sans KR',sans-serif">9월 11일 21:30</text><text x="865" y="430" text-anchor="middle" fill="#BFD2E5" font-size="18" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif">발표 전 실제값은 미확정</text></g>`;
  return chartFrame({ title: "9월 미국 CPI 발표시간", subtitle: releaseValue, source, content, accent: "#9B8CFF" });
}

const LEGACY_NVIDIA_METRICS: Record<string, ReferenceMetric[]> = {
  "official-nvidia-q2-fy2027-results": [
    { key: "nvidia.fy2027.q2.revenue", label: "매출", value: 96.2, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
    { key: "nvidia.fy2027.q2.dataCenterRevenue", label: "데이터센터 매출", value: 89, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
    { key: "nvidia.fy2027.q2.nonGaapEps", label: "조정 EPS", value: 2.22, unit: "달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
    { key: "nvidia.fy2027.q3.revenueGuidance", label: "다음 분기 매출 가이던스", value: 108, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
  ],
  "verified-ap-nvidia-q2-fy2027-reaction": [
    { key: "nvidia.fy2027.q2.revenueEstimate", label: "FactSet 매출 예상", value: 92.27, unit: "십억달러", asOf: "2026-08-26", sourceName: "AP News · FactSet", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
    { key: "nvidia.fy2027.q2.nonGaapEpsEstimate", label: "FactSet 조정 EPS 예상", value: 2.09, unit: "달러", asOf: "2026-08-26", sourceName: "AP News · FactSet", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
    { key: "nvidia.fy2027.q2.afterHoursChangePct", label: "시간외 주가 반응", value: 4.1, unit: "%", asOf: "2026-08-26 실적 발표 뒤", sourceName: "AP News", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
  ],
};

function withLegacyNvidiaMetrics(bundle?: ReferenceBundle): ReferenceBundle | undefined {
  if (!bundle) return undefined;
  return {
    ...bundle,
    items: bundle.items.map((item) => ({
      ...item,
      metrics: item.metrics?.length ? item.metrics : LEGACY_NVIDIA_METRICS[item.id],
    })),
  };
}

function referenceMetricMap(bundle?: ReferenceBundle): Record<string, ReferenceMetric> {
  return Object.fromEntries((bundle?.items ?? []).flatMap((item) => item.metrics ?? []).map((metric) => [metric.key, metric]));
}

function referenceFactMap(bundle?: ReferenceBundle): Record<string, ReferenceFact> {
  return Object.fromEntries((bundle?.items ?? []).flatMap((item) => item.facts ?? []).map((fact) => [fact.key, fact]));
}

function isOfficialYouthSavingsUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fsc.go.kr" || hostname.endsWith(".fsc.go.kr") || hostname === "kinfa.or.kr" || hostname.endsWith(".kinfa.or.kr");
  } catch {
    return false;
  }
}

function verifiedYouthSavingsData(bundle?: ReferenceBundle) {
  const metrics: Record<string, ReferenceMetric> = {};
  const facts: Record<string, ReferenceFact> = {};
  for (const item of bundle?.items ?? []) {
    if (item.reliability !== "official" || !item.url || !isOfficialYouthSavingsUrl(item.url)) continue;
    for (const metric of item.metrics ?? []) {
      if (metric.sourceUrl && isOfficialYouthSavingsUrl(metric.sourceUrl)) metrics[metric.key] = metric;
    }
    for (const fact of item.facts ?? []) {
      if (isOfficialYouthSavingsUrl(fact.sourceUrl)) facts[fact.key] = fact;
    }
  }
  const expectedMetrics: Record<string, number> = {
    "youthFutureSavings.monthlyDepositMaxKrw": 500_000,
    "youthFutureSavings.termMonths": 36,
    "youthFutureSavings.generalMatchPct": 6,
    "youthFutureSavings.preferentialMatchPct": 12,
    "youthFutureSavings.generalMonthlyContributionMaxKrw": 30_000,
    "youthFutureSavings.preferentialMonthlyContributionMaxKrw": 60_000,
    "youthFutureSavings.ageMin": 19,
    "youthFutureSavings.ageMax": 34,
    "youthFutureSavings.militaryAgeExclusionMaxYears": 6,
    "youthFutureSavings.grossIncomeMaxKrw": 75_000_000,
    "youthFutureSavings.householdMedianGeneralPct": 200,
    "youthFutureSavings.householdMedianPreferentialPct": 150,
  };
  const expectedFacts: Record<string, string> = {
    "youthFutureSavings.initialApplicationPeriod": "6월 22일~7월 3일",
    "youthFutureSavings.initialAccountOpeningPeriod": "7월 27일~8월 7일",
    "youthFutureSavings.additionalRecruitmentStatus": "검토 중",
    "youthFutureSavings.applicationOpenNow": "아니요",
    "youthFutureSavings.youthLeapOverlapAllowed": "불가",
    "youthFutureSavings.budgetProposalStatus": "국회 심의 전",
  };
  const missing = [
    ...Object.keys(expectedMetrics).filter((key) => !metrics[key]),
    ...Object.keys(expectedFacts).filter((key) => !facts[key]),
  ];
  if (missing.length > 0) throw new Error(`YOUTH_SAVINGS_REFERENCES_MISSING:${missing.join(",")}`);
  const mismatched = [
    ...Object.entries(expectedMetrics).filter(([key, value]) => metrics[key].value !== value).map(([key]) => key),
    ...Object.entries(expectedFacts).filter(([key, value]) => facts[key].value !== value).map(([key]) => key),
  ];
  if (mismatched.length > 0) throw new Error(`YOUTH_SAVINGS_REFERENCES_MISMATCH:${mismatched.join(",")}`);
  if (Object.values(metrics).some((metric) => !Number.isFinite(metric.value) || !metric.unit || !metric.asOf || !metric.sourceName || !metric.sourceUrl)) {
    throw new Error("YOUTH_SAVINGS_METRICS_UNVERIFIED");
  }
  if (Object.values(facts).some((fact) => !fact.value || !fact.asOf || !fact.sourceName || !fact.sourceUrl)) {
    throw new Error("YOUTH_SAVINGS_FACTS_UNVERIFIED");
  }
  return { metrics, facts };
}

export function isNvidiaEarningsSubject(input: { title: string; topic: string }) {
  const text = `${input.title}\n${input.topic}`;
  return /NVIDIA|엔비디아|\bNVDA\b/i.test(text)
    && /실적|earnings?|매출|revenue|EPS|가이던스|guidance|FY20\d{2}|분기\s*(?:실적|매출)|데이터센터\s*매출/i.test(text);
}

export function isBroadcomEarningsSubject(input: { title: string; topic: string }) {
  const text = `${input.title}\n${input.topic}`;
  return /Broadcom|브로드컴|\bAVGO\b/i.test(text)
    && /실적|earnings?|매출|revenue|가이던스|guidance|AI\s*반도체/i.test(text);
}

export function isCpiScheduleSubject(input: { title: string; topic: string }) {
  const text = `${input.title}\n${input.topic}`;
  return /\bCPI\b|소비자물가(?:지수)?/i.test(text)
    && /발표시간|발표\s*시각|공식\s*일정|release\s*(?:time|schedule)/i.test(text);
}

export function isMarketHolidayStudySubject(input: { title: string; topic: string }) {
  const text = `${input.title}\n${input.topic}`;
  return /휴장/.test(text) && /다음\s*(?:정규\s*)?개장일|주문\s*가능|거래시간/.test(text);
}

export function isUsMarketStudySubject(input: { title: string; topic: string }) {
  return /미국(?:장|증시)|뉴욕증시|나스닥|S&P\s*500|다우(?:존스)?|Wall\s*Street|U\.S\.\s*market/i
    .test(`${input.title}\n${input.topic}`);
}

export function usesUsFocusedGenericImages(input: {
  template: StockBriefingTemplate;
  title: string;
  topic: string;
}) {
  return input.template === "KOREA_MARKET_CLOSE_US_PREVIEW"
    || (input.template === "INVESTMENT_STUDY" && isUsMarketStudySubject(input));
}

export function getGenericMarketImagePolicy(input: {
  template: StockBriefingTemplate;
  title: string;
  topic: string;
}) {
  const usFocused = usesUsFocusedGenericImages(input);
  return {
    includeDomesticIndices: !usFocused,
    includeInvestorFlowChart: !usFocused,
    omitUnsubstantiatedFlatUsIndices: usFocused,
  };
}

export function selectGenericOverseasIndexChanges<T extends { value: number }>(
  input: { template: StockBriefingTemplate; title: string; topic: string },
  metrics: readonly T[],
) {
  const policy = getGenericMarketImagePolicy(input);
  return policy.omitUnsubstantiatedFlatUsIndices
    ? metrics.filter((metric) => metric.value !== 0)
    : [...metrics];
}

function isYouthFutureSavingsSubject(input: { title: string; topic: string }) {
  return /청년미래적금/.test(`${input.title}\n${input.topic}`);
}

function isYenSubject(input: { title: string; topic: string }) {
  return /엔화|100엔|원[·ㆍ/ -]?엔|\bJPY\b|USD\s*\/\s*JPY/i.test(`${input.title}\n${input.topic}`);
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
  referenceBundle?: ReferenceBundle;
}): Promise<GeneratedStockBlogImages> {
  const generatedAt = new Date().toISOString();
  const snapshot = input.marketSnapshot;
  const id = safeSegment(input.pipelineId);
  const relativeDir = `/generated/stock-blog/${id}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", id);
  const theme = THEMES[input.template];
  const placements = getStockBlogImagePlacementHeadings(input.template);
  const footer = `${input.marketDate || generatedAt.slice(0, 10)} · BG Market Note original graphic`;
  const editorialTitle = buildStockBlogEditorialTitle({
    template: input.template,
    marketDate: input.marketDate,
    sourceTitle: input.title,
  });
  const titleFocus = input.title.split(/[｜|]/).slice(1).join(" · ").trim();
  const thumbnailTitle = input.template === "NEXT_WEEK_MARKET_PREVIEW"
    ? "다음 주 한국·미국 증시 전망"
    : editorialTitle;
  const thumbnailSubtitle = titleFocus || input.topic;
  try {
    if (isYouthFutureSavingsSubject(input)) {
      if (input.template !== "INVESTMENT_STUDY") throw new Error("YOUTH_SAVINGS_TEMPLATE_INVALID");
      const { metrics, facts } = verifiedYouthSavingsData(input.referenceBundle);
      const timelineSource = "기준 2026.08.11 | 출처 금융위원회 · 서민금융진흥원";
      const structureSource = "2026년 가입 기준 | 출처 금융위원회 · 서민금융진흥원";
      const checklistSource = "현재 가입 기준 | 출처 금융위원회 · 서민금융진흥원";
      const files = [
        { name: "thumbnail.svg", svg: youthSavingsThumbnailSvg(footer) },
        { name: "youth-savings-timeline.svg", svg: youthSavingsTimelineSvg(facts, timelineSource) },
        { name: "youth-savings-structure.svg", svg: youthSavingsStructureSvg(metrics, structureSource) },
        { name: "youth-savings-checklist.svg", svg: youthSavingsChecklistSvg(metrics, facts, checklistSource) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const metricPoint = (key: string) => dataPoint(`reference.${key}`, metrics[key].label, metrics[key].value, metrics[key].unit, metrics[key].asOf);
      const structureKeys = [
        "youthFutureSavings.monthlyDepositMaxKrw",
        "youthFutureSavings.termMonths",
        "youthFutureSavings.generalMatchPct",
        "youthFutureSavings.preferentialMatchPct",
        "youthFutureSavings.generalMonthlyContributionMaxKrw",
        "youthFutureSavings.preferentialMonthlyContributionMaxKrw",
      ];
      const officialProductUrl = metrics["youthFutureSavings.monthlyDepositMaxKrw"].sourceUrl;
      const contentImages: StockBlogContentImage[] = [
        {
          id: "thumbnail", role: "thumbnail", type: "thumbnail", title: "청년미래적금 지금 신청할 수 있을까?",
          placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: "청년미래적금 추가 모집 일정과 현재 조건",
          sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: ["youth-savings", "policy-savings"],
          licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [],
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "youth-savings-timeline", role: "body", type: "related-image", title: "청년미래적금 모집 일정",
          placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/youth-savings-timeline.svg`, caption: "종료된 1차 일정과 검토 중인 추가 가입 일정 구분",
          sourceLabel: timelineSource, sourceName: "금융위원회 · 서민금융진흥원", sourceUrl: facts["youthFutureSavings.additionalRecruitmentStatus"].sourceUrl,
          relevanceTags: ["youth-savings", "recruitment"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "youth-savings-structure", role: "body", type: "chart", title: "현재 확정된 청년미래적금 구조",
          placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/youth-savings-structure.svg`, caption: "월 납입 한도와 일반형·우대형 정부기여 구조",
          sourceLabel: structureSource, sourceName: "금융위원회 · 서민금융진흥원", sourceUrl: officialProductUrl,
          relevanceTags: ["youth-savings", "contribution"], licenseType: "generated-data-chart", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: structureKeys.map((key) => `reference.${key}`), dataPoints: structureKeys.map(metricPoint), width: 1200, height: 675,
          fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "youth-savings-checklist", role: "body", type: "related-image", title: "신청 전 확인할 현재 기준",
          placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/youth-savings-checklist.svg`, caption: "나이·소득·가구소득·중복 가입 조건 체크리스트",
          sourceLabel: checklistSource, sourceName: "금융위원회 · 서민금융진흥원", sourceUrl: officialProductUrl,
          relevanceTags: ["youth-savings", "eligibility"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, {
        referenceBundle: input.referenceBundle,
        requiredRelevanceTags: ["youth-savings"],
        minimumRelevantBodyImages: 3,
      });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return {
        thumbnailImageUrl: `${relativeDir}/thumbnail.svg`,
        inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl),
        contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt,
      };
    }

    if (isYenSubject(input)) {
      const metrics = referenceMetricMap(input.referenceBundle);
      const requiredMetricKeys = ["jpy.usdkrw", "jpy.usdjpy", "jpy.jpykrw100", "jpy.bojPolicyRate"];
      const missingMetricKeys = requiredMetricKeys.filter((key) => !metrics[key]);
      if (missingMetricKeys.length > 0) {
        throw new Error(`YEN_TOPIC_IMAGE_METRICS_MISSING:${missingMetricKeys.join(",")}`);
      }
      if (requiredMetricKeys.some((key) => !metrics[key].sourceUrl)) {
        throw new Error("YEN_TOPIC_IMAGE_SOURCES_MISSING");
      }
      if (requiredMetricKeys.some((key) => !Number.isFinite(metrics[key].value))) {
        throw new Error("YEN_TOPIC_IMAGE_METRICS_INVALID");
      }
      const calculatedJpyKrw100 = Number((metrics["jpy.usdkrw"].value / metrics["jpy.usdjpy"].value * 100).toFixed(2));
      if (!Number.isFinite(calculatedJpyKrw100) || Math.abs(calculatedJpyKrw100 - metrics["jpy.jpykrw100"].value) > 0.01) {
        throw new Error("YEN_CROSS_RATE_MISMATCH");
      }
      const referencePoint = (key: string) => {
        const metric = metrics[key];
        return dataPoint(`reference.${key}`, metric.label, metric.value, metric.unit, metric.asOf);
      };
      const snapshotSource = `기준일 ${metrics["jpy.usdjpy"].asOf.slice(0, 10)} · ${metrics["jpy.usdkrw"].asOf.slice(0, 10)} | 출처 일본은행 · 한국투자증권 Open API`;
      const formulaSource = "산식 한국은행 | 입력값 일본은행·한국투자증권 | BG Market Note 계산";
      const checklistSource = "출처 한국은행 환율교육 · 일본은행 금융정책 자료";
      const yenThumbnailTitle = "엔화 환율, 지금 환전해도 될까?";
      const files = [
        { name: "thumbnail.svg", svg: yenThumbnailSvg({ title: yenThumbnailTitle, subtitle: "100엔 기준 · 일본은행 금리 · 실제 환전가", footer }) },
        { name: "yen-market-snapshot.svg", svg: yenSnapshotSvg(metrics, snapshotSource) },
        { name: "yen-quote-formula.svg", svg: yenFormulaSvg(metrics, formulaSource) },
        { name: "yen-exchange-checklist.svg", svg: yenChecklistSvg(checklistSource) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const contentImages: StockBlogContentImage[] = [
        {
          id: "thumbnail", role: "thumbnail", type: "thumbnail", title: yenThumbnailTitle,
          placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: yenThumbnailTitle,
          sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: ["yen", "jpy", "exchange-rate"],
          licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [],
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "yen-market-snapshot", role: "body", type: "chart", title: "엔화 환율을 볼 때 필요한 세 숫자",
          placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/yen-market-snapshot.svg`,
          caption: "원·100엔 계산값, 달러·엔 환율, 일본은행 정책금리를 단위별로 구분",
          sourceLabel: snapshotSource, sourceName: "일본은행 · 한국투자증권 Open API", sourceUrl: metrics["jpy.usdjpy"].sourceUrl,
          relevanceTags: ["yen", "jpy", "exchange-rate"], licenseType: "generated-data-chart", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: ["jpy.jpykrw100", "jpy.usdjpy", "jpy.bojPolicyRate"].map((key) => `reference.${key}`),
          dataPoints: ["jpy.jpykrw100", "jpy.usdjpy", "jpy.bojPolicyRate"].map(referencePoint),
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "yen-quote-formula", role: "body", type: "chart", title: "원·100엔 재정환율 계산법",
          placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/yen-quote-formula.svg`,
          caption: "원·달러 ÷ 달러·엔 × 100으로 원·100엔 환율을 계산하는 예시",
          sourceLabel: formulaSource, sourceName: "한국은행 · 일본은행 · 한국투자증권 Open API", sourceUrl: metrics["jpy.jpykrw100"].sourceUrl,
          relevanceTags: ["yen", "jpy", "exchange-rate"], licenseType: "generated-data-chart", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: ["jpy.usdkrw", "jpy.usdjpy", "jpy.jpykrw100"].map((key) => `reference.${key}`),
          dataPoints: ["jpy.usdkrw", "jpy.usdjpy", "jpy.jpykrw100"].map(referencePoint),
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "yen-exchange-checklist", role: "body", type: "related-image", title: "엔화 환전 전 확인할 네 가지",
          placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/yen-exchange-checklist.svg`,
          caption: "달러·엔, 원·달러, 일본은행, 은행 환전가를 순서대로 확인",
          sourceLabel: checklistSource, sourceName: "한국은행 · 일본은행", sourceUrl: metrics["jpy.bojPolicyRate"].sourceUrl,
          relevanceTags: ["yen", "jpy", "exchange-rate"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true,
          dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, {
        referenceBundle: input.referenceBundle,
        requiredRelevanceTags: ["yen"],
        minimumRelevantBodyImages: 3,
      });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return {
        thumbnailImageUrl: `${relativeDir}/thumbnail.svg`,
        inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl),
        contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt,
      };
    }

    if (isBroadcomEarningsSubject(input)) {
      if (input.template !== "INVESTMENT_STUDY") throw new Error("BROADCOM_TEMPLATE_INVALID");
      const metrics = referenceMetricMap(input.referenceBundle);
      const keys = ["broadcom.fy2026.q3.revenue", "broadcom.fy2026.q3.revenueGrowth", "broadcom.fy2026.q4.revenueGuidance"];
      const missing = keys.filter((key) => !metrics[key]);
      if (missing.length > 0) throw new Error(`BROADCOM_TOPIC_IMAGE_METRICS_MISSING:${missing.join(",")}`);
      const officialItem = input.referenceBundle?.items.find((item) => item.id === "official-broadcom-q3-fy2026-results");
      if (!officialItem?.url || officialItem.reliability !== "official") throw new Error("BROADCOM_TOPIC_IMAGE_SOURCE_MISSING");
      const source = "기준일 2026.09.02 | 출처 Broadcom Investor Relations";
      const files = [
        { name: "thumbnail.svg", svg: topicThumbnailSvg({ eyebrow: "BROADCOM EARNINGS", title: "브로드컴 실적과 AI 반도체 가이던스", subtitle: "3분기 매출 · 성장률 · 4분기 회사 전망", badge: "AVGO", footer, accent: "#56D7B0" }) },
        { name: "broadcom-results.svg", svg: metricCardsSvg({ title: "브로드컴 실적에서 볼 세 숫자", subtitle: "확정 실적과 다음 분기 회사 가이던스를 구분했습니다.", source, accent: "#56D7B0", cards: [
          { label: "3분기 매출", display: "$29.6B", note: "확정 실적" },
          { label: "전년 동기 대비", display: "+86%", note: "매출 증가율" },
          { label: "4분기 매출 전망", display: "$34.8B", note: "회사 가이던스" },
        ] }) },
        { name: "broadcom-guidance.svg", svg: metricCardsSvg({ title: "확정 매출과 다음 분기 가이던스", subtitle: "같은 십억달러 단위로 두 숫자를 비교했습니다.", source, accent: "#9B8CFF", cards: [
          { label: "2026회계연도 3분기", display: "$29.6B", note: "발표된 매출" },
          { label: "2026회계연도 4분기", display: "$34.8B", note: "회사 전망" },
        ] }) },
        { name: "broadcom-ai-path.svg", svg: flowCardsSvg({ title: "브로드컴 실적에서 AI 반도체를 읽는 순서", subtitle: "한 분기 매출보다 수요가 다음 분기로 이어지는지 확인합니다.", source, accent: "#56D7B0", steps: ["AI 인프라 투자", "맞춤형 가속기", "네트워크 수요", "다음 분기 매출"], caution: "가이던스는 회사 전망이며 확정 실적이 아닙니다." }) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const point = (key: string) => dataPoint(`reference.${key}`, metrics[key].label, metrics[key].value, metrics[key].unit, metrics[key].asOf);
      const contentImages: StockBlogContentImage[] = [
        { id: "thumbnail", role: "thumbnail", type: "thumbnail", title: "브로드컴 실적과 AI 반도체 가이던스", placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: "브로드컴 실적과 AI 반도체 가이던스", sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: ["broadcom", "earnings", "ai-semiconductor"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "broadcom-results", role: "body", type: "chart", title: "브로드컴 실적에서 볼 세 숫자", placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/broadcom-results.svg`, caption: "3분기 매출·증가율·4분기 매출 가이던스", sourceLabel: source, sourceName: "Broadcom Investor Relations", sourceUrl: officialItem.url, relevanceTags: ["broadcom", "earnings", "ai-semiconductor"], licenseType: "generated-data-chart", collectedAt: officialItem.collectedAt ?? generatedAt, usageAllowed: true, dataKeys: keys.map((key) => `reference.${key}`), dataPoints: keys.map(point), width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "broadcom-guidance", role: "body", type: "chart", title: "확정 매출과 다음 분기 가이던스", placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/broadcom-guidance.svg`, caption: "3분기 확정 매출과 4분기 회사 전망 비교", sourceLabel: source, sourceName: "Broadcom Investor Relations", sourceUrl: officialItem.url, relevanceTags: ["broadcom", "earnings", "guidance"], licenseType: "generated-data-chart", collectedAt: officialItem.collectedAt ?? generatedAt, usageAllowed: true, dataKeys: [keys[0], keys[2]].map((key) => `reference.${key}`), dataPoints: [keys[0], keys[2]].map(point), width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "broadcom-ai-path", role: "body", type: "related-image", title: "AI 반도체 수요를 읽는 순서", placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/broadcom-ai-path.svg`, caption: "AI 인프라 투자에서 다음 분기 매출까지 이어지는 확인 경로", sourceLabel: source, sourceName: "Broadcom Investor Relations", sourceUrl: officialItem.url, relevanceTags: ["broadcom", "ai-semiconductor", "guidance"], licenseType: "generated", collectedAt: officialItem.collectedAt ?? generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, { referenceBundle: input.referenceBundle, requiredRelevanceTags: ["broadcom"], minimumRelevantBodyImages: 3 });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return { thumbnailImageUrl: `${relativeDir}/thumbnail.svg`, inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl), contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt };
    }

    if (isCpiScheduleSubject(input)) {
      if (input.template !== "INVESTMENT_STUDY") throw new Error("CPI_SCHEDULE_TEMPLATE_INVALID");
      const facts = referenceFactMap(input.referenceBundle);
      const releaseFact = facts["bls.cpi.releaseAt.2026-09"];
      if (!releaseFact?.sourceUrl || !/bls\.gov/i.test(releaseFact.sourceUrl)) throw new Error("CPI_SCHEDULE_FACT_MISSING");
      const source = "발표 일정 확인 2026.09.07 | 출처 미국 노동통계국(BLS)";
      const files = [
        { name: "thumbnail.svg", svg: topicThumbnailSvg({ eyebrow: "US CPI SCHEDULE", title: "9월 미국 CPI 발표시간", subtitle: "미국 동부시간과 한국시간을 함께 확인", badge: "CPI", footer, accent: "#9B8CFF" }) },
        { name: "cpi-release-time.svg", svg: cpiReleaseTimeSvg(releaseFact.value, source) },
        { name: "cpi-market-path.svg", svg: flowCardsSvg({ title: "CPI가 나스닥에 전달되는 경로", subtitle: "예상과 실제의 차이가 금리 기대를 거쳐 성장주에 반영됩니다.", source, accent: "#9B8CFF", steps: ["CPI 실제값", "예상치와 차이", "국채금리 반응", "나스닥 반응"], caution: "발표 전에는 실제 CPI 수치가 확정되지 않았습니다." }) },
        { name: "cpi-check-order.svg", svg: flowCardsSvg({ title: "CPI 발표 전후 확인 순서", subtitle: "방향을 단정하지 않고 네 항목을 순서대로 봅니다.", source, accent: "#56D7B0", steps: ["발표 시각", "예상·실제", "2년물 금리", "지수 선물"], caution: "한 숫자만 보고 매수·매도를 결정하지 않습니다." }) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const contentImages: StockBlogContentImage[] = [
        { id: "thumbnail", role: "thumbnail", type: "thumbnail", title: "9월 미국 CPI 발표시간", placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: "9월 미국 CPI 발표시간", sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: ["cpi", "release-schedule", "inflation"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "cpi-release-time", role: "body", type: "related-image", title: "9월 미국 CPI 발표시간", placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/cpi-release-time.svg`, caption: "미국 동부시간과 한국시간으로 확인한 BLS 공식 발표 일정", sourceLabel: source, sourceName: "미국 노동통계국(BLS)", sourceUrl: releaseFact.sourceUrl, relevanceTags: ["cpi", "release-schedule", "inflation"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "cpi-market-path", role: "body", type: "related-image", title: "CPI가 나스닥에 전달되는 경로", placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/cpi-market-path.svg`, caption: "CPI 실제값에서 국채금리와 나스닥으로 이어지는 확인 경로", sourceLabel: source, sourceName: "미국 노동통계국(BLS) · BG Market Note", sourceUrl: releaseFact.sourceUrl, relevanceTags: ["cpi", "inflation", "nasdaq"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "cpi-check-order", role: "body", type: "related-image", title: "CPI 발표 전후 확인 순서", placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/cpi-check-order.svg`, caption: "발표 시각·예상과 실제·2년물 금리·지수 선물 확인 순서", sourceLabel: source, sourceName: "미국 노동통계국(BLS) · BG Market Note", sourceUrl: releaseFact.sourceUrl, relevanceTags: ["cpi", "release-schedule", "nasdaq"], licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, { referenceBundle: input.referenceBundle, requiredRelevanceTags: ["cpi"], minimumRelevantBodyImages: 3 });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return { thumbnailImageUrl: `${relativeDir}/thumbnail.svg`, inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl), contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt };
    }

    if (isMarketHolidayStudySubject(input)) {
      if (input.template !== "INVESTMENT_STUDY") throw new Error("MARKET_HOLIDAY_STUDY_TEMPLATE_INVALID");
      const text = `${input.title}\n${input.topic}`;
      const isUs = /미국장|미국\s*증시|NYSE|나스닥|프리마켓|애프터마켓/i.test(text);
      const closedDate = input.marketDate ?? text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
      const nextOpenDate = text.match(/다음\s*정규\s*개장일은\s*(20\d{2}-\d{2}-\d{2})/)?.[1]
        ?? text.match(/다음\s*개장일[^0-9]*(20\d{2}-\d{2}-\d{2})/)?.[1];
      if (!closedDate || !nextOpenDate) throw new Error("MARKET_HOLIDAY_STUDY_DATES_MISSING");
      const marketLabel = isUs ? "미국 증시" : "국내 증시";
      const sourceName = isUs ? "NYSE" : "한국거래소(KRX)";
      const sourceUrl = isUs
        ? "https://www.nyse.com/markets/hours-calendars"
        : "https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T1.jsp";
      const source = `휴장일 ${closedDate} | 출처 ${sourceName}`;
      const marketHours = isUs ? "한국시간 정규장" : "정규장 09:00~15:30";
      const files = [
        { name: "thumbnail.svg", svg: topicThumbnailSvg({ eyebrow: "MARKET HOLIDAY GUIDE", title: `오늘 ${marketLabel} 휴장?`, subtitle: "다음 개장일과 주문 가능 여부 확인", badge: isUs ? "US" : "KR", footer, accent: "#9B8CFF" }) },
        { name: "market-holiday-status.svg", svg: metricCardsSvg({ title: `${marketLabel} 휴장일 핵심 정리`, subtitle: "휴장일과 다음 정규 개장일을 구분했습니다.", source, accent: "#9B8CFF", cards: [
          { label: "확인 시장", display: marketLabel, note: "정규시장 기준" },
          { label: "휴장일", display: closedDate, note: "정규장 휴장" },
          { label: "다음 개장일", display: nextOpenDate, note: "공식 일정 확인" },
        ] }) },
        { name: "market-holiday-order.svg", svg: flowCardsSvg({ title: "휴장일에 주문을 확인하는 순서", subtitle: "주문 접수와 실제 체결 가능 여부를 나눠 봅니다.", source, accent: "#56D7B0", steps: ["휴장 여부", "주문 접수", "실제 체결", "다음 개장일"], caution: "증권사별 예약주문 접수 방식은 다를 수 있습니다." }) },
        { name: "market-holiday-checklist.svg", svg: flowCardsSvg({ title: "다음 개장 전 확인할 네 가지", subtitle: `${marketHours}과 함께 시장 변수를 순서대로 확인합니다.`, source, accent: "#9B8CFF", steps: isUs ? ["선물 흐름", "국채금리", "달러 방향", "경제일정"] : ["원·달러", "미국장", "공시 일정", "주문 상태"], caution: "휴장 중 움직인 변수는 다음 개장일에 한꺼번에 반영될 수 있습니다." }) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const tags = ["market-holiday", isUs ? "us-market" : "kr-market", "next-open-date"];
      const contentImages: StockBlogContentImage[] = [
        { id: "thumbnail", role: "thumbnail", type: "thumbnail", title: `오늘 ${marketLabel} 휴장?`, placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: `오늘 ${marketLabel} 휴장 여부와 다음 개장일`, sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: tags, licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "market-holiday-status", role: "body", type: "related-image", title: `${marketLabel} 휴장일 핵심 정리`, placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/market-holiday-status.svg`, caption: `${closedDate} 휴장 여부와 ${nextOpenDate} 다음 개장일`, sourceLabel: source, sourceName, sourceUrl, relevanceTags: tags, licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "market-holiday-order", role: "body", type: "related-image", title: "휴장일 주문 확인 순서", placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/market-holiday-order.svg`, caption: "휴장 여부부터 다음 개장일까지 주문 확인 순서", sourceLabel: source, sourceName, sourceUrl, relevanceTags: tags, licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
        { id: "market-holiday-checklist", role: "body", type: "related-image", title: "다음 개장 전 체크리스트", placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/market-holiday-checklist.svg`, caption: `다음 ${marketLabel} 개장 전에 확인할 시장 변수`, sourceLabel: source, sourceName, sourceUrl, relevanceTags: tags, licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, { referenceBundle: input.referenceBundle, requiredRelevanceTags: ["market-holiday"], minimumRelevantBodyImages: 3 });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return { thumbnailImageUrl: `${relativeDir}/thumbnail.svg`, inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl), contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt };
    }

    if (isNvidiaEarningsSubject(input)) {
      const subjectReferenceBundle = withLegacyNvidiaMetrics(input.referenceBundle);
      const metrics = referenceMetricMap(subjectReferenceBundle);
      const requiredMetricKeys = [
        "nvidia.fy2027.q2.revenue",
        "nvidia.fy2027.q2.dataCenterRevenue",
        "nvidia.fy2027.q2.nonGaapEps",
        "nvidia.fy2027.q3.revenueGuidance",
        "nvidia.fy2027.q2.revenueEstimate",
        "nvidia.fy2027.q2.nonGaapEpsEstimate",
        "nvidia.fy2027.q2.afterHoursChangePct",
      ];
      const missingMetricKeys = requiredMetricKeys.filter((key) => !metrics[key]);
      if (missingMetricKeys.length > 0) {
        throw new Error(`NVIDIA_TOPIC_IMAGE_METRICS_MISSING:${missingMetricKeys.join(",")}`);
      }
      const officialItem = subjectReferenceBundle?.items.find((item) => item.id === "official-nvidia-q2-fy2027-results");
      const reactionItem = subjectReferenceBundle?.items.find((item) => item.id === "verified-ap-nvidia-q2-fy2027-reaction");
      const hbmItem = subjectReferenceBundle?.items.find((item) => item.id === "verified-etoday-nvidia-hbm-link-20260826");
      if (!officialItem?.url || !reactionItem?.url || !hbmItem?.url) {
        throw new Error("NVIDIA_TOPIC_IMAGE_SOURCES_MISSING");
      }
      const officialSource = `기준일 ${metrics["nvidia.fy2027.q2.revenue"].asOf} | 출처 NVIDIA Newsroom`;
      const reactionSource = `기준일 ${metrics["nvidia.fy2027.q2.afterHoursChangePct"].asOf} | 출처 NVIDIA Newsroom · AP News · FactSet`;
      const hbmSource = "산업 연결 경로 | 출처 NVIDIA Newsroom · 이투데이 · BG Market Note 재구성";
      const nvidiaThumbnailTitle = "엔비디아 실적 발표 | 매출·시간외 주가·HBM";
      const files = [
        { name: "thumbnail.svg", svg: nvidiaThumbnailSvg({ title: nvidiaThumbnailTitle, subtitle: "매출 962억달러 · 시간외 +4.1% · HBM 전달 경로", footer, theme }) },
        { name: "nvidia-earnings.svg", svg: nvidiaEarningsSvg(metrics, officialSource) },
        { name: "nvidia-expectations.svg", svg: nvidiaExpectationsSvg(metrics, reactionSource) },
        { name: "nvidia-hbm-path.svg", svg: nvidiaHbmPathSvg(hbmSource) },
      ];
      await mkdir(outputDir, { recursive: true });
      await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
      const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
      if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
      const referencePoint = (key: string) => {
        const metric = metrics[key];
        return dataPoint(`reference.${key}`, metric.label, metric.value, metric.unit, metric.asOf);
      };
      const contentImages: StockBlogContentImage[] = [
        {
          id: "thumbnail", role: "thumbnail", type: "thumbnail", title: nvidiaThumbnailTitle,
          placementAfterHeading: "__thumbnail__", imageUrl: `${relativeDir}/thumbnail.svg`, caption: nvidiaThumbnailTitle,
          sourceLabel: "BG Market Note 자체 제작", sourceName: "BG Market Note", relevanceTags: ["nvidia", "earnings", "hbm"],
          licenseType: "generated", collectedAt: generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [],
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "nvidia-earnings", role: "body", type: "chart", title: "엔비디아 FY2027 2분기 핵심 숫자",
          placementAfterHeading: placements.majorIndexChange, imageUrl: `${relativeDir}/nvidia-earnings.svg`,
          caption: "엔비디아 매출·데이터센터 매출·조정 EPS·다음 분기 매출 가이던스",
          sourceLabel: officialSource, sourceName: "NVIDIA Newsroom", sourceUrl: officialItem.url, relevanceTags: ["nvidia", "earnings", "data-center"],
          licenseType: "generated-data-chart", collectedAt: officialItem.collectedAt ?? generatedAt, usageAllowed: true,
          dataKeys: requiredMetricKeys.slice(0, 4).map((key) => `reference.${key}`),
          dataPoints: requiredMetricKeys.slice(0, 4).map(referencePoint),
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "nvidia-hbm-path", role: "body", type: "related-image", title: "엔비디아 실적에서 국내 HBM주까지 전달 경로",
          placementAfterHeading: placements.fxAndUsYields, imageUrl: `${relativeDir}/nvidia-hbm-path.svg`,
          caption: "데이터센터 수요에서 AI 가속기·HBM·국내 반도체 수급으로 이어지는 확인 순서",
          sourceLabel: hbmSource, sourceName: "NVIDIA Newsroom · 이투데이", sourceUrl: hbmItem.url, relevanceTags: ["nvidia", "hbm", "samsung-electronics", "sk-hynix"],
          licenseType: "generated", collectedAt: hbmItem.collectedAt ?? generatedAt, usageAllowed: true, dataKeys: [], dataPoints: [],
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
        {
          id: "nvidia-expectations", role: "body", type: "chart", title: "시장 예상치와 발표 뒤 반응",
          placementAfterHeading: placements.kospiInvestorFlow, imageUrl: `${relativeDir}/nvidia-expectations.svg`,
          caption: "FactSet 매출·조정 EPS 예상치와 실제값, 발표 뒤 엔비디아 시간외 주가 반응",
          sourceLabel: reactionSource, sourceName: "NVIDIA Newsroom · AP News · FactSet", sourceUrl: reactionItem.url, relevanceTags: ["nvidia", "earnings", "after-hours"],
          licenseType: "generated-data-chart", collectedAt: reactionItem.collectedAt ?? generatedAt, usageAllowed: true,
          dataKeys: [
            "nvidia.fy2027.q2.revenue", "nvidia.fy2027.q2.revenueEstimate", "nvidia.fy2027.q2.nonGaapEps",
            "nvidia.fy2027.q2.nonGaapEpsEstimate", "nvidia.fy2027.q2.afterHoursChangePct",
          ].map((key) => `reference.${key}`),
          dataPoints: [
            "nvidia.fy2027.q2.revenue", "nvidia.fy2027.q2.revenueEstimate", "nvidia.fy2027.q2.nonGaapEps",
            "nvidia.fy2027.q2.nonGaapEpsEstimate", "nvidia.fy2027.q2.afterHoursChangePct",
          ].map(referencePoint),
          width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
        },
      ];
      const imageQuality = evaluateStockBlogImageQuality(contentImages, snapshot, {
        referenceBundle: subjectReferenceBundle,
        requiredRelevanceTags: ["nvidia"],
        minimumRelevantBodyImages: 3,
      });
      if (imageQuality.status !== "passed") throw new Error(imageQuality.issues.map((issue) => `${issue.code}:${issue.message}`).join(" | "));
      return {
        thumbnailImageUrl: `${relativeDir}/thumbnail.svg`,
        inlineImageUrls: contentImages.filter((image) => image.role === "body").map((image) => image.imageUrl),
        contentImages, imageQuality, imageStatus: "generated", imageGeneratedAt: generatedAt,
      };
    }

    if (input.template === "INVESTMENT_STUDY") {
      throw new Error("INVESTMENT_STUDY_TOPIC_IMAGE_TEMPLATE_MISSING");
    }

    if (
      !snapshot
      || snapshot.status !== "ready"
      || (
        snapshot.dataQuality !== "verified"
        && !isAllowedFredDegradedSnapshot(snapshot)
        && !isAllowedKisSectorDegradedSnapshot(snapshot)
        && !isAllowedKisOverseasDegradedSnapshot(snapshot)
      )
      || snapshot.freshness?.status !== "fresh"
      || snapshot.fallbackUsed !== false
    ) {
      throw new Error("검증된 최신 MarketSnapshot이 없어 데이터 차트를 생성하지 않았습니다.");
    }
    const omitMissingOverseasItems = isAllowedKisOverseasDegradedSnapshot(snapshot);
    const genericImagePolicy = getGenericMarketImagePolicy(input);
    const useUsFocusedGenericImages = !genericImagePolicy.includeDomesticIndices;
    const kospi = numericMetric(snapshot.korea?.kospi, "changePct", "KOSPI_CHANGE");
    const kosdaq = numericMetric(snapshot.korea?.kosdaq, "changePct", "KOSDAQ_CHANGE");
    const sp500 = snapshot.us?.sp500 ? numericMetric(snapshot.us.sp500, "changePct", "SP500_CHANGE") : undefined;
    const nasdaq = snapshot.us?.nasdaq ? numericMetric(snapshot.us.nasdaq, "changePct", "NASDAQ_CHANGE") : undefined;
    const dow = snapshot.us?.dow ? numericMetric(snapshot.us.dow, "changePct", "DOW_CHANGE") : undefined;
    const fx = snapshot.us?.fx ? numericMetric(snapshot.us.fx, "value", "USDKRW_VALUE") : undefined;
    const fxChange = snapshot.us?.fx ? numericMetric(snapshot.us.fx, "changePct", "USDKRW_CHANGE") : undefined;
    if (
      !omitMissingOverseasItems
      && (!sp500 || !nasdaq || (!useUsFocusedGenericImages && !dow) || !fx || !fxChange)
    ) {
      throw new Error("IMAGE_DATA_MISSING_OVERSEAS_CORE");
    }
    const twoYear = snapshot.macro?.us2Year
      ? numericMetric(snapshot.macro.us2Year, "value", "US2Y_VALUE")
      : undefined;
    const tenYear = snapshot.macro?.us10Year
      ? numericMetric(snapshot.macro.us10Year, "value", "US10Y_VALUE")
      : undefined;
    const spread = snapshot.macro?.yieldSpread10Y2Y
      ? numericMetric(snapshot.macro.yieldSpread10Y2Y, "value", "SPREAD_VALUE")
      : undefined;
    const flows = snapshot.korea?.investorFlows ?? [];
    const kospiFlows = [
      { index: flows.findIndex((metric) => metric.label === "KOSPI 외국인 순매수"), label: "외국인" },
      { index: flows.findIndex((metric) => metric.label === "KOSPI 기관 순매수"), label: "기관" },
      { index: flows.findIndex((metric) => metric.label === "KOSPI 개인 순매수"), label: "개인" },
    ].map((item) => {
      if (item.index < 0) return undefined;
      try {
        const metric = numericMetric(flows[item.index], "value", `KOSPI_FLOW_${item.label}`);
        return { ...item, ...metric };
      } catch {
        return undefined;
      }
    }).filter((flow): flow is VerifiedInvestorFlow => Boolean(flow));
    const includeInvestorFlowChart = genericImagePolicy.includeInvestorFlowChart
      && kospiFlows.length === 3
      && hasMeaningfulInvestorFlowValues(kospiFlows.map((flow) => flow.value))
      && kospiFlows.every((flow) => flow.metric.unit === "백만원")
      && isInvestorFlowDateEligible(
        input.template,
        input.marketDate ?? snapshot.marketDate,
        kospiFlows.map((flow) => flow.metric.asOf!),
      );
    const formattedInvestorFlows = includeInvestorFlowChart
      ? formatInvestorFlowChartValues(kospiFlows.map((flow) => flow.value))
      : undefined;
    const flowAsOf = formattedInvestorFlows ? kospiFlows[0].metric.asOf! : undefined;
    const flowCopy = formattedInvestorFlows && flowAsOf
      ? buildInvestorFlowChartCopy(input.template, shortDateLabel(flowAsOf), formattedInvestorFlows.subtitle)
      : undefined;

    await mkdir(outputDir, { recursive: true });
    const overseasIndexMetrics = selectGenericOverseasIndexChanges(
      input,
      [sp500, nasdaq, dow].filter((metric): metric is VerifiedNumericMetric => Boolean(metric)),
    );
    const displayedSp500 = sp500 && overseasIndexMetrics.includes(sp500) ? sp500 : undefined;
    const displayedNasdaq = nasdaq && overseasIndexMetrics.includes(nasdaq) ? nasdaq : undefined;
    const displayedDow = dow && overseasIndexMetrics.includes(dow) ? dow : undefined;
    const hasOverseasIndexMetrics = overseasIndexMetrics.length > 0;
    if (useUsFocusedGenericImages && !hasOverseasIndexMetrics) throw new Error("IMAGE_DATA_MISSING_US_INDEX");
    const overseasIndexLabels = [
      ...(displayedSp500 ? ["S&P 500"] : []),
      ...(displayedNasdaq ? ["나스닥"] : []),
      ...(displayedDow ? ["다우"] : []),
    ];
    const domesticSessionLabel = input.template === "KOREA_DAILY_PREVIEW" ? "직전 거래일" : "최근 거래일";
    const indexTitle = useUsFocusedGenericImages
      ? "미국 주요 지수 등락 비교"
      : hasOverseasIndexMetrics ? "한국·미국 주요 지수 등락 비교" : "한국 주요 지수 등락 비교";
    const indexCaption = useUsFocusedGenericImages
      ? `최근 거래일 기준 ${overseasIndexLabels.join("·")} 등락률 비교`
      : hasOverseasIndexMetrics
      ? `${domesticSessionLabel} 기준 한국과 미국 주요 지수 등락률 비교`
      : `${domesticSessionLabel} 기준 코스피와 코스닥 등락률 비교`;
    const indexSource = useUsFocusedGenericImages
      ? `기준일 ${dateLabel(overseasIndexMetrics[0].metric.asOf!)} | 출처 한국투자증권 Open API`
      : hasOverseasIndexMetrics
      ? `기준일 ${dateLabel(kospi.metric.asOf!)}(한국) · ${dateLabel(overseasIndexMetrics[0].metric.asOf!)}(미국) | 출처 한국투자증권 Open API`
      : `기준일 ${dateLabel(kospi.metric.asOf!)} | 출처 한국투자증권 Open API`;
    const indexRows = [
      ...(!useUsFocusedGenericImages ? [
        { label: "KOSPI", value: kospi.value, display: `${signed(kospi.value)}%` },
        { label: "KOSDAQ", value: kosdaq.value, display: `${signed(kosdaq.value)}%` },
      ] : []),
      ...(displayedSp500 ? [{ label: "S&P 500", value: displayedSp500.value, display: `${signed(displayedSp500.value)}%` }] : []),
      ...(displayedNasdaq ? [{ label: "NASDAQ", value: displayedNasdaq.value, display: `${signed(displayedNasdaq.value)}%` }] : []),
      ...(displayedDow ? [{ label: "Dow Jones", value: displayedDow.value, display: `${signed(displayedDow.value)}%` }] : []),
    ];
    const flowSource = formattedInvestorFlows
      ? `기준일 ${dateLabel(kospiFlows[0].metric.asOf!)} | 단위 ${formattedInvestorFlows.unit} | 출처 한국투자증권 Open API`
      : undefined;
    const yieldMetric = tenYear ?? twoYear;
    const macroSource = fx
      ? yieldMetric
        ? `기준일 ${dateLabel(yieldMetric.metric.asOf!)}(금리) · ${dateLabel(fx.metric.asOf!)}(환율) | 출처 한국투자증권 Open API · FRED`
        : `기준일 ${dateLabel(fx.metric.asOf!)} | 출처 한국투자증권 Open API`
      : undefined;
    const files: Array<{ name: string; svg: string }> = [
      {
        name: "thumbnail.svg",
        svg: svgCard({ width: 1200, height: 675, title: thumbnailTitle, subtitle: thumbnailSubtitle, footer, theme, hero: true }),
      },
      {
        name: "major-index-change.svg",
        svg: horizontalComparisonSvg({
          title: indexTitle,
          subtitle: useUsFocusedGenericImages
            ? "확인된 미국 최근 거래일 등락률만 같은 단위로 비교했습니다."
            : hasOverseasIndexMetrics
            ? `확인된 각 시장의 ${domesticSessionLabel} 등락률만 같은 단위로 비교했습니다.`
            : `확인된 국내 ${domesticSessionLabel} 등락률만 같은 단위로 비교했습니다.`,
          source: indexSource,
          rows: indexRows,
        }),
      },
    ];
    if (formattedInvestorFlows && flowSource && flowCopy) {
      files.push({
        name: "kospi-investor-flow.svg",
        svg: horizontalComparisonSvg({
          title: flowCopy.title,
          subtitle: flowCopy.subtitle,
          source: flowSource,
          rows: kospiFlows.map((flow, index) => ({ label: flow.label, ...formattedInvestorFlows.values[index] })),
        }),
      });
    }
    if (fx && fxChange && macroSource) {
      files.push({
        name: "fx-and-us-yields.svg",
        svg: ratesAndFxSvg({
          fx: fx.value,
          fxChange: fxChange.value,
          twoYear: twoYear?.value,
          tenYear: tenYear?.value,
          spread: twoYear && tenYear ? spread?.value : undefined,
          source: macroSource,
        }),
      });
    }
    await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
    const sizes = await Promise.all(files.map((file) => stat(path.join(outputDir, file.name))));
    if (sizes.some((file) => !file.isFile() || file.size < 500)) throw new Error("IMAGE_FILE_VERIFICATION_FAILED");
    const contentImages: StockBlogContentImage[] = [
      {
        id: "thumbnail",
        role: "thumbnail",
        type: "thumbnail",
        title: thumbnailTitle,
        placementAfterHeading: "__thumbnail__",
        imageUrl: `${relativeDir}/thumbnail.svg`,
        caption: thumbnailTitle,
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
        title: indexTitle,
        placementAfterHeading: placements.majorIndexChange,
        imageUrl: `${relativeDir}/major-index-change.svg`,
        caption: indexCaption,
        sourceLabel: indexSource,
        sourceName: "한국투자증권 Open API",
        sourceUrl: useUsFocusedGenericImages ? overseasIndexMetrics[0].metric.url : kospi.metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: [
          ...(!useUsFocusedGenericImages ? ["korea.kospi.changePct", "korea.kosdaq.changePct"] : []),
          ...(displayedSp500 ? ["us.sp500.changePct"] : []),
          ...(displayedNasdaq ? ["us.nasdaq.changePct"] : []),
          ...(displayedDow ? ["us.dow.changePct"] : []),
        ],
        dataPoints: [
          ...(!useUsFocusedGenericImages ? [
            dataPoint("korea.kospi.changePct", "KOSPI", kospi.value, "%", kospi.metric.asOf!),
            dataPoint("korea.kosdaq.changePct", "KOSDAQ", kosdaq.value, "%", kosdaq.metric.asOf!),
          ] : []),
          ...(displayedSp500 ? [dataPoint("us.sp500.changePct", "S&P 500", displayedSp500.value, "%", displayedSp500.metric.asOf!)] : []),
          ...(displayedNasdaq ? [dataPoint("us.nasdaq.changePct", "NASDAQ", displayedNasdaq.value, "%", displayedNasdaq.metric.asOf!)] : []),
          ...(displayedDow ? [dataPoint("us.dow.changePct", "Dow Jones", displayedDow.value, "%", displayedDow.metric.asOf!)] : []),
        ],
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      },
    ];
    if (formattedInvestorFlows && flowSource && flowCopy) {
      contentImages.push({
        id: "kospi-investor-flow",
        role: "body",
        type: "chart",
        title: flowCopy.title,
        placementAfterHeading: placements.kospiInvestorFlow,
        imageUrl: `${relativeDir}/kospi-investor-flow.svg`,
        caption: flowCopy.caption,
        sourceLabel: flowSource,
        sourceName: "한국투자증권 Open API",
        sourceUrl: kospiFlows[0].metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: kospiFlows.map((flow) => `korea.investorFlows.${flow.index}.value`),
        dataPoints: kospiFlows.map((flow) => dataPoint(`korea.investorFlows.${flow.index}.value`, flow.label, flow.value, "백만원", flow.metric.asOf!)),
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      });
    }
    if (fx && fxChange && macroSource) {
      contentImages.push({
        id: "fx-and-us-yields",
        role: "body",
        type: "chart",
        title: yieldMetric ? "원·달러 환율과 미국 국채금리 현황" : "원·달러 환율 현황",
        placementAfterHeading: placements.fxAndUsYields,
        imageUrl: `${relativeDir}/fx-and-us-yields.svg`,
        caption: twoYear && tenYear
          ? "원·달러 환율과 미국 2년물·10년물 국채금리 비교"
          : tenYear
            ? "원·달러 환율과 미국 10년물 국채금리 비교"
            : twoYear
              ? "원·달러 환율과 미국 2년물 국채금리 비교"
              : "원·달러 환율 현황",
        sourceLabel: macroSource,
        sourceName: yieldMetric ? "한국투자증권 Open API · FRED" : "한국투자증권 Open API",
        sourceUrl: yieldMetric?.metric.url ?? fx.metric.url,
        licenseType: "generated-data-chart",
        collectedAt: snapshot.collectedAt,
        usageAllowed: true,
        dataKeys: [
          "us.fx.value",
          "us.fx.changePct",
          ...(twoYear ? ["macro.us2Year.value"] : []),
          ...(tenYear ? ["macro.us10Year.value"] : []),
          ...(twoYear && tenYear && spread ? ["macro.yieldSpread10Y2Y.value"] : []),
        ],
        dataPoints: [
          dataPoint("us.fx.value", "USD/KRW", fx.value, "원", fx.metric.asOf!),
          dataPoint("us.fx.changePct", "USD/KRW 등락률", fxChange.value, "%", fxChange.metric.asOf!),
          ...(twoYear ? [dataPoint("macro.us2Year.value", "미국 2년물", twoYear.value, "%", twoYear.metric.asOf!)] : []),
          ...(tenYear ? [dataPoint("macro.us10Year.value", "미국 10년물", tenYear.value, "%", tenYear.metric.asOf!)] : []),
          ...(twoYear && tenYear && spread ? [dataPoint("macro.yieldSpread10Y2Y.value", "10Y-2Y", spread.value, "%p", spread.metric.asOf!)] : []),
        ],
        width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
      });
    }
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
