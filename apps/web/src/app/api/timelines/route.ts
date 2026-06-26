import { NextRequest, NextResponse } from "next/server";
import { listTimelines } from "@/lib/repositories/timelines";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timelines = await listTimelines(searchParams.get("targetType"), searchParams.get("targetId"));
    return NextResponse.json({ timelines });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch timelines";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
