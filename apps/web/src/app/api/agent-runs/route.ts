import { NextRequest, NextResponse } from "next/server";
import { AgentEventError } from "@/lib/events/agent-event-types";
import { runAgentTask } from "@/lib/agents/agent-runner-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await runAgentTask(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AgentEventError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON", message: "request body must be valid JSON" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown agent run error";
    return NextResponse.json({ ok: false, error: "AGENT_RUN_FAILED", message }, { status: 500 });
  }
}
