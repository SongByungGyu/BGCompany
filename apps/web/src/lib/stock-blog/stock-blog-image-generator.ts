import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { buildStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";

export type GeneratedStockBlogImages = {
  thumbnailImageUrl?: string;
  inlineImageUrls: string[];
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

export async function generateStockBlogImages(input: {
  pipelineId: string;
  template: StockBriefingTemplate;
  title: string;
  topic: string;
  marketDate?: string;
}): Promise<GeneratedStockBlogImages> {
  const generatedAt = new Date().toISOString();
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
    await mkdir(outputDir, { recursive: true });
    const files = [
      {
        name: "thumbnail.svg",
        svg: svgCard({ width: 1200, height: 675, title: editorialTitle, subtitle: input.topic, footer, theme, hero: true }),
      },
      {
        name: "market-summary.svg",
        svg: svgCard({ width: 1200, height: 675, title: "시장 흐름 요약", subtitle: input.topic, footer, theme }),
      },
      {
        name: "investor-checklist.svg",
        svg: svgCard({ width: 1200, height: 675, title: "투자자 체크리스트", subtitle: "금리 · 환율 · 수급 · 섹터", footer, theme }),
      },
    ];
    await Promise.all(files.map((file) => writeFile(path.join(outputDir, file.name), file.svg, "utf8")));
    return {
      thumbnailImageUrl: `${relativeDir}/thumbnail.svg`,
      inlineImageUrls: files.slice(1).map((file) => `${relativeDir}/${file.name}`),
      imageStatus: "generated",
      imageGeneratedAt: generatedAt,
    };
  } catch (error) {
    return {
      inlineImageUrls: [],
      imageStatus: "failed",
      imageGeneratedAt: generatedAt,
      imageErrorMessage: error instanceof Error ? error.message : "Stock blog image generation failed",
    };
  }
}
