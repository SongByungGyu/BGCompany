import { NextResponse } from "next/server";

const AGENT_API_KEY_HEADER = "x-bg-agent-key";
const INTERNAL_UI_ACTION_HEADER = "x-bg-ui-action";
const WORK_BOARD_AGENT_RUN_ACTION = "work-board-agent-run";

function unauthorizedAgentRequest() {
  return NextResponse.json(
    {
      ok: false,
      error: "UNAUTHORIZED_AGENT_REQUEST",
      message: "Missing or invalid agent API key",
    },
    { status: 401 },
  );
}

function getConfiguredAgentApiKey() {
  return process.env.AGENT_API_KEY?.trim() ?? "";
}

function hasValidAgentApiKey(request: Request) {
  const configuredKey = getConfiguredAgentApiKey();
  if (!configuredKey) return false;
  return request.headers.get(AGENT_API_KEY_HEADER) === configuredKey;
}

function isSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function isAllowedInternalUiAgentRun(request: Request) {
  return (
    request.headers.get(INTERNAL_UI_ACTION_HEADER) === WORK_BOARD_AGENT_RUN_ACTION &&
    isSameOriginBrowserRequest(request)
  );
}

export function validateAgentApiKey(
  request: Request,
  options: { allowInternalUiAgentRun?: boolean } = {},
): { ok: true } | { ok: false; response: NextResponse } {
  if (hasValidAgentApiKey(request)) return { ok: true };
  if (options.allowInternalUiAgentRun && isAllowedInternalUiAgentRun(request)) return { ok: true };
  return { ok: false, response: unauthorizedAgentRequest() };
}

export function assertAgentApiKey(request: Request): void {
  if (!hasValidAgentApiKey(request)) {
    throw new Error("Missing or invalid agent API key");
  }
}
