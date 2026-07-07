import type { ContentPipelineDetail, ContentPipelineRequest, ContentPipelineResponse, ContentPipelineRun, HermesUsageSummary, NaverDraftJob } from "./content-pipeline-types";

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


export async function fetchHermesUsage(): Promise<HermesUsageSummary> {
  const response = await fetch("/api/hermes/usage", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to fetch Hermes usage.");
  return response.json() as Promise<HermesUsageSummary>;
}

export async function fetchNaverDraftJobs(contentPipelineId?: string): Promise<NaverDraftJob[]> {
  const query = contentPipelineId ? `?contentPipelineId=${encodeURIComponent(contentPipelineId)}` : "";
  const response = await fetch(`/api/naver-drafts/jobs${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch Naver draft jobs: ${response.status}`);
  const data = await response.json() as { jobs?: NaverDraftJob[] };
  return data.jobs ?? [];
}

export async function createNaverDraftJob(input: { contentPipelineId: string; approvalId?: string | null }): Promise<NaverDraftJob> {
  const response = await fetch("/api/naver-drafts/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(data?.message ?? data?.error ?? `Failed to create Naver draft job: ${response.status}`);
  }
  const data = await response.json() as { job: NaverDraftJob };
  return data.job;
}

export async function cancelNaverDraftJob(jobId: string): Promise<NaverDraftJob> {
  const response = await fetch(`/api/naver-drafts/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(data?.message ?? data?.error ?? `Failed to cancel Naver draft job: ${response.status}`);
  }
  const data = await response.json() as { job: NaverDraftJob };
  return data.job;
}
