import { NextRequest, NextResponse } from "next/server";
import { listTimelines } from "@/lib/repositories/timelines";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const timelines = await listTimelines(searchParams.get("targetType"), searchParams.get("targetId"));
  return NextResponse.json({ timelines });
}
