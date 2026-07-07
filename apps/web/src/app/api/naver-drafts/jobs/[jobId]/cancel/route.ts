import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { cancelNaverDraftJob } from "@/lib/naver-drafts/naver-draft-jobs";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    const { jobId } = await context.params;
    const job = await cancelNaverDraftJob(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "NAVER_DRAFT_JOB_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown naver draft cancel error";
    return NextResponse.json({ ok: false, error: message, message }, { status: 400 });
  }
}
