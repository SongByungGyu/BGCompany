import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { getContentPipelineDetail } from "@/lib/content-pipeline/content-pipeline-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ pipelineId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const { pipelineId } = await context.params;
  const detail = await getContentPipelineDetail(pipelineId);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "CONTENT_PIPELINE_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
