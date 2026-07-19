import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { regenerateContentPipelineImages } from "@/lib/content-pipeline/content-pipeline-service";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ pipelineId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { pipelineId } = await context.params;
    const images = await regenerateContentPipelineImages(pipelineId);
    return NextResponse.json({ ok: images.imageQuality.status === "passed", images }, { status: images.imageQuality.status === "passed" ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image regeneration failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "CONTENT_PIPELINE_NOT_FOUND" ? 404 : 400 });
  }
}
