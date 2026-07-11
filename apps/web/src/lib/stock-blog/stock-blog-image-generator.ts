import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type GeneratedStockBlogImages = {
  thumbnailImageUrl?: string;
  inlineImageUrls: string[];
  imageStatus: "generated" | "failed";
  imageGeneratedAt: string;
  imageErrorMessage?: string;
};

type ImageTheme = {
  eyebrow: string;
  accent: string;
  secondary: string;
};

const THEMES: Record<StockBriefingTemplate, ImageTheme> = {
  KOREA_DAILY_PREVIEW: { eyebrow: "KOREA DAILY PREVIEW", accent: "#42A5FF", secondary: "#8ED0FF" },
  KOREA_MARKET_CLOSE_US_PREVIEW: { eyebrow: "KOREA CLOSE · US PREVIEW", accent: "#D5A64A", secondary: "#FFE09A" },
  WEEKLY_MARKET_REVIEW: { eyebrow: "WEEKLY MARKET REVIEW", accent: "#56D7B0", secondary: "#A7F0D8" },
  NEXT_WEEK_MARKET_PREVIEW: { eyebrow: "NEXT WEEK PREVIEW", accent: "#9B8CFF", secondary: "#D0C9FF" },
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

function splitTitle(value: string, maxLength = 17) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["시장 브리핑"];
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > maxLength) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.slice(0, 3);
}

function chartPath(width: number, height: number) {
  const points = [0.03, 0.18, 0.12, 0.35, 0.3, 0.48, 0.42, 0.39, 0.57, 0.68, 0.62, 0.82, 0.78, 0.91];
  return points.map((value, index) => {
    const x = Math.round((index / (points.length - 1)) * width);
    const y = Math.round(height - value * height);
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
}

function svgCard(input: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  footer: string;
  theme: ImageTheme;
}) {
  const lines = splitTitle(input.title, input.width >= 1100 ? 24 : 17);
  const titleSize = input.width >= 1100 ? 66 : 72;
  const startY = input.height >= 1000 ? 350 : 250;
  const lineGap = titleSize + 18;
  const titleSvg = lines.map((line, index) => (
    `<text x="72" y="${startY + index * lineGap}" fill="#FFFFFF" font-size="${titleSize}" font-weight="800" font-family="Arial, 'Noto Sans KR', sans-serif">${xmlEscape(line)}</text>`
  )).join("\n");
  const chartTop = Math.round(input.height * 0.63);
  const chartWidth = input.width - 144;
  const chartHeight = Math.round(input.height * 0.18);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071426"/><stop offset="1" stop-color="#102F55"/></linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${input.theme.secondary}"/><stop offset="1" stop-color="${input.theme.accent}"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" rx="34" fill="url(#bg)"/>
  <circle cx="${input.width - 120}" cy="100" r="180" fill="${input.theme.accent}" opacity="0.10"/>
  <text x="72" y="95" fill="${input.theme.secondary}" font-size="24" font-weight="700" letter-spacing="3" font-family="Arial, sans-serif">${xmlEscape(input.theme.eyebrow)}</text>
  <rect x="72" y="126" width="92" height="8" rx="4" fill="${input.theme.accent}"/>
  <text x="72" y="210" fill="#C9D8EA" font-size="30" font-weight="600" font-family="Arial, 'Noto Sans KR', sans-serif">${xmlEscape(input.subtitle)}</text>
  ${titleSvg}
  <g transform="translate(72 ${chartTop})">
    <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#FFFFFF" opacity="0.15"/>
    <path d="${chartPath(chartWidth, chartHeight)}" fill="none" stroke="url(#line)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  </g>
  <text x="72" y="${input.height - 62}" fill="#9EB2CA" font-size="23" font-family="Arial, 'Noto Sans KR', sans-serif">${xmlEscape(input.footer)}</text>
  <text x="${input.width - 72}" y="${input.height - 62}" text-anchor="end" fill="#FFFFFF" font-size="25" font-weight="700" font-family="Arial, sans-serif">BG MARKET NOTE</text>
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
  const footer = `${input.marketDate || generatedAt.slice(0, 10)} · 자체 생성 정보 카드`;
  try {
    await mkdir(outputDir, { recursive: true });
    const files = [
      {
        name: "thumbnail.svg",
        svg: svgCard({ width: 1080, height: 1080, title: input.title, subtitle: "핵심 흐름과 체크포인트", footer, theme }),
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
