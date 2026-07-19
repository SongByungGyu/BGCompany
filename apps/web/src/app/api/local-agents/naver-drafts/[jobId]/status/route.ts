import { NextRequest, NextResponse } from "next/server";
import { getNaverDraftAgentKeyConfigured, reportNaverDraftJobStatus, verifyNaverDraftAgentKey, type NaverDraftJobStatus } from "@/lib/naver-drafts/naver-draft-jobs";

const statuses = new Set([
  "created", "queued", "claimed", "in_progress", "image_uploading", "draft_saving", "draft_saved",
  "publish_ready", "publishing", "published", "user_publish_required", "completed", "failed",
  "login_required", "captcha_required", "security_check_required", "readability_failed",
  "image_upload_failed", "image_quality_failed", "draft_save_failed", "publish_blocked", "publish_failed", "duplicate_blocked",
  "quality_failed", "reference_failed", "market_data_failed", "cancelled",
]);

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
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const status = typeof body.status === "string" ? body.status : "";
  if (!statuses.has(status)) return NextResponse.json({ ok: false, error: "INVALID_NAVER_DRAFT_STATUS" }, { status: 400 });
  const { jobId } = await context.params;
  const job = await reportNaverDraftJobStatus(jobId, {
    status: status as NaverDraftJobStatus,
    claimedBy: typeof body.agentId === "string" ? body.agentId : undefined,
    externalUrl: typeof body.externalUrl === "string" ? body.externalUrl : undefined,
    publishedUrl: typeof body.publishedUrl === "string" ? body.publishedUrl : undefined,
    naverPostId: typeof body.naverPostId === "string" ? body.naverPostId : undefined,
    errorCode: typeof body.errorCode === "string" ? body.errorCode : undefined,
    errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
  });
  return NextResponse.json({ ok: true, job });
}
