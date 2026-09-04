import { NextRequest, NextResponse } from "next/server";
import {
  getNaverDraftAgentKeyConfigured,
  getNaverDraftAgentRuntimeStatus,
  verifyNaverDraftAgentKey,
} from "@/lib/naver-drafts/naver-draft-jobs";

export async function GET(request: NextRequest) {
  if (!getNaverDraftAgentKeyConfigured()) {
    return NextResponse.json({ ok: false, error: "NAVER_DRAFT_AGENT_KEY_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!verifyNaverDraftAgentKey(request.headers.get("x-naver-draft-agent-key"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, runtime: await getNaverDraftAgentRuntimeStatus() });
}
