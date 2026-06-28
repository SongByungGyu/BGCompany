import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { resolveApproval } from "@/lib/repositories/approval-actions";

const allowedStatuses = ["승인 완료", "반려", "수정 요청", "보류"] as const;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ approvalId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const { approvalId } = await context.params;
  const body = await request.json();
  if (!allowedStatuses.includes(body.status)) {
    return NextResponse.json({ error: "unsupported approval status" }, { status: 400 });
  }
  const result = await resolveApproval({
    approvalId,
    status: body.status,
    decisionReason: typeof body.decisionReason === "string" ? body.decisionReason : undefined,
  });
  return NextResponse.json(result);
}
