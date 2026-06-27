import { NextRequest, NextResponse } from "next/server";
import { validateAgentApiKey } from "@/lib/auth/agent-api-auth";
import { AgentEventError } from "@/lib/events/agent-event-types";
import { processAgentEvent } from "@/lib/events/event-processor";

export async function POST(request: NextRequest) {
  const auth = validateAgentApiKey(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const result = await processAgentEvent(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AgentEventError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON", message: "request body must be valid JSON" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown agent event error";
    return NextResponse.json({ ok: false, error: "AGENT_EVENT_PROCESSING_FAILED", message }, { status: 500 });
  }
}
