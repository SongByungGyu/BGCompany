import { NextRequest, NextResponse } from "next/server";
import { getAgentRunById } from "@/lib/repositories/agent-runs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const agentRun = await getAgentRunById(runId);
  if (!agentRun) return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  return NextResponse.json({ agentRun });
}
