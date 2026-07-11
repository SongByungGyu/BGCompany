import type { ReferenceItem } from "@/lib/stock-blog/references/reference-types";

export type NaverBodyBlock =
  | { type: "intro"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bulletList"; items: string[] }
  | { type: "reference"; item: ReferenceItem; index: number }
  | { type: "disclaimer"; text: string };

function normalizeLines(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderReference(item: ReferenceItem, index: number) {
  const source = item.sourceName || item.publisher || item.provider;
  return [
    `${index}. ${normalizeLines(item.title)}`,
    `- 출처: ${source}`,
    `- 발행일: ${item.publishedAt?.slice(0, 10) || "확인 필요"}`,
    `- 핵심 내용: ${normalizeLines(item.summary || item.usageNote || "원문 링크에서 핵심 내용을 확인합니다.")}`,
    `- 시장 영향: ${normalizeLines(item.usageNote || "시장 흐름과 체크포인트를 해석하는 근거로 활용합니다.")}`,
    `- 원문: ${item.url || "확인 필요"}`,
  ].join("\n");
}

export function renderNaverBlock(block: NaverBodyBlock) {
  if (block.type === "bulletList") return block.items.map((item) => `- ${normalizeLines(item)}`).join("\n");
  if (block.type === "reference") return renderReference(block.item, block.index);
  return normalizeLines(block.text);
}

export function renderNaverBody(blocks: NaverBodyBlock[]) {
  return blocks.map(renderNaverBlock).filter(Boolean).join("\n\n");
}
