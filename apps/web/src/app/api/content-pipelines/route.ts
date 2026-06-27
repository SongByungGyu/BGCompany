import { NextRequest, NextResponse } from "next/server";
import { listContentPipelines, startContentPipeline } from "@/lib/content-pipeline/content-pipeline-service";

export async function GET() {
  const pipelines = await listContentPipelines();
  return NextResponse.json({ pipelines });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pipeline = await startContentPipeline(body);
    return NextResponse.json({ ok: true, pipeline }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON", message: "request body must be valid JSON" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown content pipeline error";
    return NextResponse.json({ ok: false, error: "CONTENT_PIPELINE_FAILED", message }, { status: 400 });
  }
}
