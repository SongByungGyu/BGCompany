import { NextRequest, NextResponse } from "next/server";
import { getNaverDraftAgentKeyConfigured, getNextNaverDraftJob, verifyNaverDraftAgentKey } from "@/lib/naver-drafts/naver-draft-jobs";

function requireAgent(request: NextRequest) {
  if (!getNaverDraftAgentKeyConfigured()) {
    return NextResponse.json({ ok: false, error: "NAVER_DRAFT_AGENT_KEY_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!verifyNaverDraftAgentKey(request.headers.get("x-naver-draft-agent-key"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAgent(request);
  if (unauthorized) return unauthorized;
  const job = await getNextNaverDraftJob();
  return NextResponse.json({ job });
}
