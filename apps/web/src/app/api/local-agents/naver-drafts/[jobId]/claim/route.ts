import { NextRequest, NextResponse } from "next/server";
import { claimNaverDraftJob, getNaverDraftAgentKeyConfigured, verifyNaverDraftAgentKey } from "@/lib/naver-drafts/naver-draft-jobs";

function requireAgent(request: NextRequest) {
  if (!getNaverDraftAgentKeyConfigured()) {
    return NextResponse.json({ ok: false, error: "NAVER_DRAFT_AGENT_KEY_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!verifyNaverDraftAgentKey(request.headers.get("x-naver-draft-agent-key"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const unauthorized = requireAgent(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { agentId?: unknown };
  const claimedBy = typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : "local-naver-draft-agent";
  const { jobId } = await context.params;
  const job = await claimNaverDraftJob(jobId, claimedBy);
  if (!job) return NextResponse.json({ ok: false, error: "NAVER_DRAFT_JOB_NOT_CLAIMABLE" }, { status: 409 });
  return NextResponse.json({ ok: true, job });
}
