import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { updateOperationalLesson } from "@/lib/operational-learning/operational-learning-service";

const allowedStatuses = new Set(["observed", "contained", "prevented", "verified", "archived"]);

function optionalString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : undefined;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ lessonId: string }> },
) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  const { lessonId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  const status = typeof body.status === "string" && allowedStatuses.has(body.status)
    ? body.status as "observed" | "contained" | "prevented" | "verified" | "archived"
    : undefined;
  if (body.status !== undefined && !status) {
    return NextResponse.json({ ok: false, error: "UNSUPPORTED_LESSON_STATUS" }, { status: 400 });
  }

  try {
    const lesson = await updateOperationalLesson({
      lessonId,
      title: optionalString(body.title) ?? undefined,
      agentId: optionalString(body.agentId),
      rootCause: optionalString(body.rootCause),
      preventionRule: optionalString(body.preventionRule),
      regressionTest: optionalString(body.regressionTest),
      verificationEvidence: optionalString(body.verificationEvidence),
      policyVersion: optionalString(body.policyVersion),
      status,
    });
    return NextResponse.json({ ok: true, lesson });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Operational lesson update failed";
    const verificationBlocked = message.startsWith("OPERATIONAL_LESSON_VERIFICATION_BLOCKED:");
    return NextResponse.json({ ok: false, error: verificationBlocked ? "VERIFICATION_BLOCKED" : "LESSON_UPDATE_FAILED", message }, { status: verificationBlocked ? 409 : 400 });
  }
}
