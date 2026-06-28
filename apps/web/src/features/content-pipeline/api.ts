import type { ContentPipelineDetail, ContentPipelineRequest, ContentPipelineResponse, ContentPipelineRun } from "./content-pipeline-types";

export async function fetchContentPipelines(): Promise<ContentPipelineRun[]> {
  const response = await fetch("/api/content-pipelines", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch content pipelines: ${response.status}`);
  const data = await response.json() as { pipelines?: ContentPipelineRun[] };
  return data.pipelines ?? [];
}

export async function fetchContentPipeline(pipelineId: string): Promise<ContentPipelineDetail> {
  const response = await fetch(`/api/content-pipelines/${encodeURIComponent(pipelineId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch content pipeline: ${response.status}`);
  return response.json() as Promise<ContentPipelineDetail>;
}

export async function startContentPipeline(input: ContentPipelineRequest): Promise<ContentPipelineResponse> {
  const response = await fetch("/api/content-pipelines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(data?.message ?? `Failed to start content pipeline: ${response.status}`);
  }
  return response.json() as Promise<ContentPipelineResponse>;
}
