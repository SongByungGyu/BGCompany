import { NextRequest, NextResponse } from "next/server";
import { AgentEventError } from "@/lib/events/agent-event-types";
import { runAgentTask } from "@/lib/agents/agent-runner-service";
import { getAgentRuns } from "@/lib/repositories/agent-runs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runs = await getAgentRuns({
    taskId: searchParams.get("taskId") ?? undefined,
    employeeId: searchParams.get("employeeId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });
  return NextResponse.json({ agentRuns: runs });
}

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
