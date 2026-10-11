export const SAFE_KINDS = ["research", "plan", "build", "qa", "trial_deploy", "growth"] as const;
export const RESTRICTED_KINDS = ["public_release", "payments", "permissions", "paid_api"] as const;
export type TaskKind = typeof SAFE_KINDS[number] | typeof RESTRICTED_KINDS[number];
export const ERROR_CODES = ["BUILD_FAILED", "TEST_FAILED", "RUNNER_UNAVAILABLE", "QUOTA_EXHAUSTED", "EXECUTION_STOPPED"] as const;
export type ErrorCode = typeof ERROR_CODES[number];

export class ControlPlaneError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 ||
      /[\r\n\x00-\x1f]|\bBearer\s|\bsk-[a-zA-Z0-9_-]{10,}|(?:password|secret|api[_-]?key|cookie|token)\s*[:=]/i.test(value)) {
    throw new ControlPlaneError("INVALID_LABEL");
  }
  return value.trim();
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new ControlPlaneError("INVALID_ID");
  }
  return value;
}

export function kind(value: unknown): TaskKind {
  if (![...SAFE_KINDS, ...RESTRICTED_KINDS].includes(value as TaskKind)) {
    throw new ControlPlaneError("INVALID_TASK_KIND");
  }
  return value as TaskKind;
}

export function isolatedDatabaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !/^\/bg_company_v2_(dev|test|staging)$/.test(url.pathname)) throw new Error();
    return value!;
  } catch {
    // Never include the URL: it may contain a password.
    throw new ControlPlaneError("ISOLATED_DATABASE_REQUIRED");
  }
}

export type Artifacts = { commitSha?: string; paths?: string[]; tests?: { passed: number; failed: number } };
export function artifacts(value: Artifacts = {}): Artifacts {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !["commitSha", "paths", "tests"].includes(key))) {
    throw new ControlPlaneError("INVALID_ARTIFACTS");
  }
  if (value.commitSha !== undefined && !/^[a-f\d]{40}$/i.test(value.commitSha)) throw new ControlPlaneError("INVALID_COMMIT");
  if (value.paths !== undefined && (!Array.isArray(value.paths) || value.paths.length > 100 || value.paths.some((p) =>
    typeof p !== "string" || p.length > 250 || !/^[\w./-]+$/.test(p) || p.startsWith("/") ||
    p.split("/").some((s) => s === ".." || !s) ||
    /(^|\/)(\.env(?:\.|$)|\.auth|\.ssh|credentials|secrets|cookies)|\.(pem|key|log)$/i.test(p)))) {
    throw new ControlPlaneError("INVALID_ARTIFACT_PATH");
  }
  if (value.tests !== undefined && (!value.tests || typeof value.tests !== "object" ||
      Object.keys(value.tests).some((key) => !["passed", "failed"].includes(key)) ||
      ![value.tests.passed, value.tests.failed].every((n) => Number.isSafeInteger(n) && n >= 0))) {
    throw new ControlPlaneError("INVALID_TEST_COUNTS");
  }
  return value;
}
