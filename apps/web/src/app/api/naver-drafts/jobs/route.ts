import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { createNaverDraftJobFromPipeline, getNaverDraftPolicy, listNaverDraftJobs } from "@/lib/naver-drafts/naver-draft-jobs";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const contentPipelineId = request.nextUrl.searchParams.get("contentPipelineId");
  const jobs = await listNaverDraftJobs({ contentPipelineId });
  return NextResponse.json({ jobs, policy: getNaverDraftPolicy() });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json() as {
      contentPipelineId?: unknown;
      approvalId?: unknown;
      allowPublish?: unknown;
      publishKey?: unknown;
      marketDate?: unknown;
      scheduleSlot?: unknown;
    };
    const contentPipelineId = typeof body.contentPipelineId === "string" ? body.contentPipelineId.trim() : "";
    const approvalId = typeof body.approvalId === "string" ? body.approvalId.trim() : null;
    const allowPublish = body.allowPublish === true;
    const publishKey = typeof body.publishKey === "string" ? body.publishKey.trim() : null;
    const marketDate = typeof body.marketDate === "string" ? body.marketDate.trim() : null;
    const scheduleSlot = typeof body.scheduleSlot === "string" ? body.scheduleSlot.trim() : null;
    if (!contentPipelineId) {
      return NextResponse.json({ ok: false, error: "CONTENT_PIPELINE_ID_REQUIRED" }, { status: 400 });
    }
    if (allowPublish && (!publishKey || !marketDate || !scheduleSlot)) {
      return NextResponse.json({ ok: false, error: "NAVER_AUTO_PUBLISH_IDEMPOTENCY_FIELDS_REQUIRED" }, { status: 400 });
    }
    const job = await createNaverDraftJobFromPipeline({
      contentPipelineId,
      approvalId,
      allowPublish,
      publishKey,
      marketDate,
      scheduleSlot,
    });
    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown naver draft job error";
    const status = message === "CONTENT_PIPELINE_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message, message }, { status });
  }
}
