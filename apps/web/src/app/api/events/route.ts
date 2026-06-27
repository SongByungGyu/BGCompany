import { NextRequest, NextResponse } from "next/server";
import { processInternalEvent } from "@/lib/events/event-processor";
import { listEvents } from "@/lib/repositories/events";

export async function GET() {
  const events = await listEvents();
  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body || typeof body.type !== "string") {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const event = await processInternalEvent({
    id: typeof body.id === "string" ? body.id : undefined,
    type: body.type,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
    employeeId: typeof body.employeeId === "string" ? body.employeeId : null,
    taskId: typeof body.taskId === "string" ? body.taskId : null,
    approvalId: typeof body.approvalId === "string" ? body.approvalId : null,
    payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    summary: typeof body.summary === "string" ? body.summary : null,
  });
  return NextResponse.json({ event }, { status: 201 });
}
