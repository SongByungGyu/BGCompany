import { NextRequest, NextResponse } from "next/server";
import { validateAdminOrAgentApiKey } from "@/lib/auth/agent-api-auth";
import { getAgentRunById } from "@/lib/repositories/agent-runs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await validateAdminOrAgentApiKey(request);
  if (!auth.ok) return auth.response;

  const { runId } = await context.params;
  const agentRun = await getAgentRunById(runId);
  if (!agentRun) return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  return NextResponse.json({ agentRun });
}
