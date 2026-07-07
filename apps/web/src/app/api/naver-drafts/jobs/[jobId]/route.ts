import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { getNaverDraftJob } from "@/lib/naver-drafts/naver-draft-jobs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const { jobId } = await context.params;
  const job = await getNaverDraftJob(jobId);
  if (!job) return NextResponse.json({ ok: false, error: "NAVER_DRAFT_JOB_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ job });
}
