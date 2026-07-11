import fs from "node:fs/promises";
import path from "node:path";
import { buildManualReferenceBundle } from "./stock-reference-normalizer";
import { collectMarketSnapshot } from "./market-snapshot-provider";
import { getStockReferenceTemplate } from "./stock-reference-templates";
import type { ReferenceAdapter, ReferenceBundle, ReferenceSearchInput } from "./reference-types";

type ManualReferenceFile = {
  references?: unknown[];
  bundles?: Array<{
    contentType?: string;
    marketDate?: string;
    references?: unknown[];
    summary?: string;
    risks?: string[];
    missingItems?: string[];
  }>;
};

function safeParseJson(value: string): ManualReferenceFile | null {
  try {
    const parsed = JSON.parse(value) as ManualReferenceFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveManualPath(rawPath?: string) {
  const value = rawPath?.trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), value);
}

async function loadManualFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return safeParseJson(content);
  } catch {
    return null;
  }
}

function selectReferences(input: ReferenceSearchInput, data: ManualReferenceFile | null) {
  if (!data) return { references: [], summary: undefined, risks: undefined, missingItems: [`${getStockReferenceTemplate(input.contentType).label} 수동 참고자료 파일/JSON 없음`] };
  const bundle = data.bundles?.find((item) => item.contentType === input.contentType);
  if (bundle) return { references: bundle.references ?? [], summary: bundle.summary, risks: bundle.risks, missingItems: bundle.missingItems, marketDate: bundle.marketDate };
  return { references: data.references ?? [], summary: undefined, risks: undefined, missingItems: [] };
}

export const manualStockReferenceProvider: ReferenceAdapter = {
  async search(input: ReferenceSearchInput): Promise<ReferenceBundle> {
    const inlineJson = process.env.STOCK_REFERENCE_MANUAL_JSON?.trim();
    const filePath = resolveManualPath(process.env.STOCK_REFERENCE_MANUAL_PATH ?? "config/stock-references/manual-references.json");
    const data = inlineJson ? safeParseJson(inlineJson) : filePath ? await loadManualFile(filePath) : null;
    const selected = selectReferences(input, data);
    const bundle = buildManualReferenceBundle(input, selected.references, {
      marketDate: selected.marketDate,
      summary: selected.summary,
      risks: selected.risks,
      missingItems: selected.missingItems,
    });
    const marketSnapshot = await collectMarketSnapshot(input);
    return {
      ...bundle,
      status: bundle.items.length ? (marketSnapshot.status === "ready" ? "ready" : "needs_data") : "needs_reference",
      marketSnapshot,
      marketDate: marketSnapshot.marketDate,
      missingItems: Array.from(new Set([...(bundle.missingItems ?? []), ...marketSnapshot.missingItems])),
    };
  },
};
