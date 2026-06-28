import { NextResponse } from "next/server";
import { getContentPipelineDetail } from "@/lib/content-pipeline/content-pipeline-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ pipelineId: string }> },
) {
  const { pipelineId } = await context.params;
  const detail = await getContentPipelineDetail(pipelineId);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "CONTENT_PIPELINE_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
