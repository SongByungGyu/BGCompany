import { createHash } from "node:crypto";

export const OPERATIONAL_LEARNING_WINDOW_DAYS = 7;
export const OPERATIONAL_LEARNING_PROPOSAL_THRESHOLD = 2;
export const OPERATIONAL_LEARNING_MAX_INSTRUCTIONS = 5;

export type OperationalFailureInput = {
  sourceEventId: string;
  eventType?: string;
  employeeId?: string | null;
  taskId?: string | null;
  occurredAt?: Date;
  summary?: string | null;
  payload?: Record<string, unknown>;
};

export type OperationalFailureClassification = {
  fingerprint: string;
  occurrenceKey: string;
  title: string;
  area: string;
  stage: string;
  errorCode: string | null;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  ownerAgentId: string | null;
  correlationId: string | null;
  proposedPreventionRule: string;
};

export type LessonInstructionCandidate = {
  id: string;
  fingerprint: string;
  title: string;
  area: string;
  agentId: string | null;
  status: string;
  approvalStatus: string;
  preventionRule: string | null;
  policyVersion: string | null;
  updatedAt: Date;
};

export type OperationalLessonInstruction = {
  lessonId: string;
  fingerprint: string;
  title: string;
  instruction: string;
  policyVersion?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function kebab(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[_\s/]+/g, "-")
    .replace(/[^a-z0-9가-힣-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

export function redactOperationalFailureText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[secret]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [secret]")
    .replace(/([?&](?:key|token|secret|password)=)[^\s&]+/gi, "$1[secret]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function stableMessageDigest(message: string) {
  const normalized = message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
    .replace(/\b\d{2,}\b/g, "[n]")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized || "unknown-error").digest("hex").slice(0, 12);
}

function inferErrorCode(payload: Record<string, unknown>, message: string) {
  const explicit = stringValue(payload, "errorCode", "code", "failureCode");
  if (explicit) return explicit.toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 120);
  const prefix = message.match(/^([A-Z][A-Z0-9_]{3,})(?::|\b)/)?.[1];
  return prefix ?? null;
}

function knownCause(errorCode: string | null, message: string) {
  const combined = `${errorCode ?? ""} ${message}`;
  if (/STOCK_REFERENCE_PREFLIGHT_BLOCKED|needs_credentials|검증된 MarketSnapshot|검증 스냅샷/i.test(combined)) {
    return { area: "stock-blog", stage: "reference-preflight", cause: "missing-verified-market-data", owner: "stock-monitor", severity: "high" as const };
  }
  if (/STOCK_CONTENT_QUALITY_FAILED|품질 게이트|editorial.*(?:short|length)|본문.*(?:짧|길이)/i.test(combined)) {
    return { area: "stock-blog", stage: "quality-gate", cause: "editorial-quality-gate-blocked", owner: "qa-auditor", severity: "high" as const };
  }
  if (/NAVER_|네이버|publish|게시 실패/i.test(combined)) {
    return { area: "naver-publishing", stage: "publish", cause: kebab(errorCode ?? "publish-failed", "publish-failed"), owner: "local-naver-draft-agent", severity: "high" as const };
  }
  if (/timeout|timed out|시간 초과/i.test(combined)) {
    return { area: "agent-runtime", stage: "execution", cause: "timeout", owner: null, severity: "medium" as const };
  }
  if (/rate.?limit|429|한도 부족/i.test(combined)) {
    return { area: "agent-runtime", stage: "capacity", cause: "rate-limit", owner: null, severity: "medium" as const };
  }
  return null;
}

function severityValue(payload: Record<string, unknown>, fallback: OperationalFailureClassification["severity"]) {
  const value = stringValue(payload, "severity", "riskLevel")?.toLowerCase();
  if (value === "critical" || value === "치명적") return "critical";
  if (value === "high" || value === "높음") return "high";
  if (value === "low" || value === "낮음") return "low";
  if (value === "medium" || value === "보통") return "medium";
  return fallback;
}

function proposedRule(area: string, stage: string, cause: string) {
  if (cause === "missing-verified-market-data") {
    return "검증된 Provider 인증·최신 시장 데이터가 준비되지 않으면 생성 전에 안전 정지하고, 인증 실패는 자동 반복하지 않으며 데이터 부재만 제한적으로 재시도한다.";
  }
  if (cause === "editorial-quality-gate-blocked") {
    return "품질 게이트를 완화하지 말고 상위 차단 사유를 구조화해 Writer에 전달하며, QA 수정 횟수와 생성·게시 재시도를 분리해 기록한다.";
  }
  if (cause === "timeout") {
    return "시간 제한을 바로 늘리지 말고 입력 크기·Provider 상태·동시성을 먼저 확인하며, 동일 단계의 자동 재시도는 제한된 횟수만 허용한다.";
  }
  if (cause === "rate-limit") {
    return "남은 호출량을 실행 전에 확인하고 용량 부족은 실패가 아닌 지연 상태로 분류하며, 비용 한도를 자동으로 높이지 않는다.";
  }
  return `${area}/${stage}의 ${cause} 원인을 재현하고 안전 정지 조건과 회귀 검증을 추가한 뒤에만 자동 재시도를 허용한다.`;
}

function titleFor(area: string, stage: string, cause: string) {
  if (cause === "missing-verified-market-data") return "검증된 시장 데이터 부재의 반복 방지";
  if (cause === "editorial-quality-gate-blocked") return "콘텐츠 품질 게이트 반복 차단 개선";
  if (cause === "timeout") return `${area} ${stage} 시간 초과 개선`;
  if (cause === "rate-limit") return `${area} 실행 한도 부족 개선`;
  return `${area} ${stage} 반복 실패 개선`;
}

export function classifyOperationalFailure(input: OperationalFailureInput): OperationalFailureClassification {
  const payload = record(input.payload);
  const rawMessage = stringValue(payload, "message", "error", "reason", "summary") ?? input.summary ?? "Unknown operational failure";
  const message = redactOperationalFailureText(rawMessage);
  const errorCode = inferErrorCode(payload, message);
  const known = knownCause(errorCode, message);
  const inferredArea = stringValue(payload, "area", "workflow")
    ?? (stringValue(payload, "contentPipelineId", "contentType", "scheduleKey") ? "stock-blog" : input.employeeId ? "agent-runtime" : "operations");
  const area = known?.area ?? kebab(inferredArea, "operations");
  const rawStage = stringValue(payload, "stage", "failurePhase", "phase", "role") ?? input.employeeId ?? "runtime";
  const stage = known?.stage ?? kebab(rawStage, "runtime");
  const cause = known?.cause ?? (errorCode ? kebab(errorCode, "unknown-error") : `message-${stableMessageDigest(message)}`);
  const fingerprint = `${area}:${stage}:${cause}`;
  const scheduleKey = stringValue(payload, "scheduleKey");
  const attempt = typeof payload.attempt === "number" || typeof payload.attempt === "string" ? String(payload.attempt) : undefined;
  const correlationId = stringValue(payload, "contentPipelineId", "pipelineId", "runId")
    ?? (scheduleKey ? `${scheduleKey}${attempt ? `:attempt:${attempt}` : ""}` : null);
  const occurrenceKey = correlationId ? `${fingerprint}:${correlationId}` : `${fingerprint}:event:${input.sourceEventId}`;
  const ownerAgentId = stringValue(payload, "ownerAgentId") ?? known?.owner ?? input.employeeId ?? null;
  const fallbackSeverity = known?.severity ?? "medium";
  return {
    fingerprint,
    occurrenceKey,
    title: titleFor(area, stage, cause),
    area,
    stage,
    errorCode,
    message,
    severity: severityValue(payload, fallbackSeverity),
    ownerAgentId,
    correlationId,
    proposedPreventionRule: proposedRule(area, stage, cause),
  };
}

export function isOperationalFailureEvent(input: { type: string; payload?: unknown }) {
  const payload = record(input.payload);
  const errorCode = stringValue(payload, "errorCode", "code", "failureCode") ?? "";
  if (/_SKIPPED_AFTER_/i.test(errorCode)) return false;
  if (input.type === "ErrorOccurred") return true;
  const status = stringValue(payload, "status")?.toLowerCase();
  return status === "failed" || status === "partial_failed" || status === "blocked";
}

export function recentOccurrenceCount(occurredAt: Date[], now = new Date(), windowDays = OPERATIONAL_LEARNING_WINDOW_DAYS) {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return occurredAt.filter((value) => value.getTime() >= cutoff && value.getTime() <= now.getTime()).length;
}

export function shouldCreateImprovementProposal(occurredAt: Date[], now = new Date()) {
  return recentOccurrenceCount(occurredAt, now) >= OPERATIONAL_LEARNING_PROPOSAL_THRESHOLD;
}

export function operationalLessonVerificationErrors(input: {
  approvalStatus: string;
  preventionRule?: string | null;
  regressionTest?: string | null;
  verificationEvidence?: string | null;
}) {
  const errors: string[] = [];
  if (input.approvalStatus !== "approved") errors.push("승인된 교훈만 verified로 전환할 수 있습니다.");
  if (!input.preventionRule?.trim()) errors.push("예방 규칙이 필요합니다.");
  if (!input.regressionTest?.trim()) errors.push("회귀 테스트 또는 수동 검증 절차가 필요합니다.");
  if (!input.verificationEvidence?.trim()) errors.push("검증 통과 증거가 필요합니다.");
  return errors;
}

export function selectApplicableLessonInstructions(
  lessons: LessonInstructionCandidate[],
  input: { agentId: string; area?: string; limit?: number },
): OperationalLessonInstruction[] {
  return lessons
    .filter((lesson) => lesson.approvalStatus === "approved")
    .filter((lesson) => lesson.status === "prevented" || lesson.status === "verified")
    .filter((lesson) => Boolean(lesson.preventionRule?.trim()))
    .filter((lesson) => !lesson.agentId || lesson.agentId === input.agentId)
    .filter((lesson) => !input.area || lesson.area === input.area || lesson.area === "operations" || lesson.area === "agent-runtime")
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "verified" ? -1 : 1;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.limit ?? OPERATIONAL_LEARNING_MAX_INSTRUCTIONS)
    .map((lesson) => ({
      lessonId: lesson.id,
      fingerprint: lesson.fingerprint,
      title: lesson.title,
      instruction: lesson.preventionRule!.trim().slice(0, 600),
      ...(lesson.policyVersion ? { policyVersion: lesson.policyVersion } : {}),
    }));
}
