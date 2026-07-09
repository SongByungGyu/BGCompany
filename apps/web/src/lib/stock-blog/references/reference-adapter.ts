import { mockReferenceAdapter } from "./mock-reference-adapter";
import { naverSearchReferenceAdapter } from "./naver-search-reference-adapter";
import type { ReferenceBundle, ReferenceSearchInput } from "./reference-types";

export async function collectStockBlogReferences(input: ReferenceSearchInput): Promise<ReferenceBundle> {
  const provider = process.env.REFERENCE_SEARCH_PROVIDER?.trim();
  const maxResults = Number.parseInt(process.env.REFERENCE_SEARCH_MAX_RESULTS ?? "5", 10);
  const resolvedInput = { ...input, maxResults: Number.isFinite(maxResults) ? maxResults : input.maxResults };
  if (provider === "naver" || provider === "naver-search") {
    return naverSearchReferenceAdapter.search(resolvedInput);
  }
  return mockReferenceAdapter.search(resolvedInput);
}
