#!/usr/bin/env python3
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("HERMES_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("HERMES_BRIDGE_PORT", "8787"))
BRIDGE_API_KEY = os.environ.get("BRIDGE_API_KEY") or os.environ.get("HERMES_BRIDGE_API_KEY") or ""
TIMEOUT_MS = int(os.environ.get("HERMES_BRIDGE_TIMEOUT_MS", "45000"))
MAX_STDOUT_BYTES = int(os.environ.get("HERMES_BRIDGE_MAX_STDOUT_BYTES", "200000"))
MAX_CONCURRENCY = max(1, int(os.environ.get("HERMES_BRIDGE_MAX_CONCURRENCY", "1")))
MAX_BODY_BYTES = int(os.environ.get("HERMES_BRIDGE_MAX_BODY_BYTES", "1048576"))

ALLOWED_AGENT_IDS = {"content-planner"}
ALLOWED_TASK_TYPES = {"content_planning"}
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]{12,}", re.IGNORECASE),
]

semaphore = threading.BoundedSemaphore(MAX_CONCURRENCY)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def mask_secrets(value: str) -> str:
    masked = value
    for pattern in SECRET_PATTERNS:
        masked = pattern.sub("[masked]", masked)
    return masked


def truncate_bytes(text: str, limit: int) -> tuple[str, bool]:
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= limit:
        return text, False
    truncated = encoded[:limit].decode("utf-8", errors="replace")
    return truncated + "\n...[truncated]", True


def strip_code_fence(text: str) -> str:
    value = text.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return value


def parse_jsonish_stdout(stdout: str) -> dict[str, Any] | None:
    value = strip_code_fence(stdout)
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {"content": parsed}
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", value, flags=re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else {"content": parsed}
        except json.JSONDecodeError:
            return None
    return None


def pick_string(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def pick_outline(record: dict[str, Any]) -> list[str] | None:
    value = record.get("outline") or record.get("sections") or record.get("headings")
    if not isinstance(value, list):
        return None
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append(item.strip())
        elif isinstance(item, dict) and isinstance(item.get("title"), str) and item["title"].strip():
            result.append(item["title"].strip())
    return result or None


def build_prompt(payload: dict[str, Any]) -> str:
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    topic = str(input_data.get("topic") or "").strip()
    title = str(input_data.get("title") or "").strip()
    channel = str(input_data.get("channel") or "blog").strip()
    language = str(input_data.get("language") or "ko").strip()
    return f"""
너는 BG Company의 content-planner AI 직원이다.
아래 입력을 바탕으로 {language} 언어의 콘텐츠 기획 결과를 만든다.

입력:
- topic: {topic}
- title: {title}
- channel: {channel}

규칙:
- 반드시 JSON 객체만 출력한다.
- markdown 코드블록을 쓰지 않는다.
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.
- 마케팅 검토와 QA 검토가 이어질 수 있도록 기획 결과만 만든다.
- 너무 길게 쓰지 말고 운영 UI에 표시 가능한 분량으로 작성한다.

출력 JSON schema:
{{
  "title": "콘텐츠 제목",
  "summary": "한두 문장 요약",
  "outline": ["섹션 1", "섹션 2", "섹션 3", "섹션 4"],
  "draftDirection": "초안 작성 방향",
  "content": "짧은 콘텐츠 초안 또는 도입부"
}}
""".strip()


def normalize_success(stdout: str, stderr: str, duration_ms: int) -> dict[str, Any]:
    stdout = mask_secrets(stdout)
    stderr = mask_secrets(stderr)
    parsed = parse_jsonish_stdout(stdout) or {}
    raw_stdout, stdout_truncated = truncate_bytes(stdout, MAX_STDOUT_BYTES)
    raw_stderr, stderr_truncated = truncate_bytes(stderr, MAX_STDOUT_BYTES)
    return {
        "ok": True,
        "provider": "hermes-bridge",
        "agentId": "content-planner",
        "title": pick_string(parsed, "title", "outputTitle", "headline"),
        "summary": pick_string(parsed, "summary", "outputSummary", "description"),
        "outline": pick_outline(parsed),
        "draftDirection": pick_string(parsed, "draftDirection", "direction", "strategy"),
        "content": pick_string(parsed, "content", "body", "draft", "article") or stdout.strip(),
        "durationMs": duration_ms,
        "raw": {
            "exitCode": 0,
            "stdoutPreview": raw_stdout,
            "stderrPreview": raw_stderr,
            "stdoutTruncated": stdout_truncated,
            "stderrTruncated": stderr_truncated,
        },
    }


def error_response(code: str, message: str, status: int, *, raw: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    return status, {
        "ok": False,
        "provider": "hermes-bridge",
        "agentId": "content-planner",
        "errorCode": code,
        "errorMessage": mask_secrets(message),
        "raw": raw or {},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "BGCompanyHermesBridge/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{now_iso()}] {self.address_string()} {fmt % args}", flush=True)

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] != "/health":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        self.send_json(200, {
            "ok": True,
            "service": "hermes-bridge",
            "time": now_iso(),
            "configured": {
                "bridgeApiKey": bool(BRIDGE_API_KEY),
                "maxConcurrency": MAX_CONCURRENCY,
                "timeoutMs": TIMEOUT_MS,
            },
        })

    def read_body_json(self) -> tuple[dict[str, Any] | None, str | None]:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            return None, "request body is required"
        if content_length > MAX_BODY_BYTES:
            return None, "request body is too large"
        raw = self.rfile.read(content_length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None, "request body must be valid JSON"
        if not isinstance(parsed, dict):
            return None, "request body must be a JSON object"
        return parsed, None

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/run":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        if not BRIDGE_API_KEY:
            status, body = error_response("HERMES_BRIDGE_NOT_CONFIGURED", "BRIDGE_API_KEY is not configured.", 503)
            self.send_json(status, body)
            return
        if self.headers.get("x-bridge-api-key", "") != BRIDGE_API_KEY:
            status, body = error_response("HERMES_BRIDGE_UNAUTHORIZED", "Invalid bridge API key.", 401)
            self.send_json(status, body)
            return
        payload, body_error = self.read_body_json()
        if body_error or payload is None:
            status, body = error_response("HERMES_BRIDGE_INVALID_REQUEST", body_error or "Invalid request body.", 400)
            self.send_json(status, body)
            return
        if payload.get("agentId") not in ALLOWED_AGENT_IDS or payload.get("taskType") not in ALLOWED_TASK_TYPES:
            status, body = error_response(
                "HERMES_BRIDGE_AGENT_NOT_ALLOWED",
                "Only content-planner content_planning runs are allowed by this bridge.",
                403,
                raw={"agentId": payload.get("agentId"), "taskType": payload.get("taskType")},
            )
            self.send_json(status, body)
            return
        if not semaphore.acquire(blocking=False):
            status, body = error_response("HERMES_BRIDGE_BUSY", "Hermes bridge concurrency limit reached.", 429)
            self.send_json(status, body)
            return

        started = time.monotonic()
        try:
            completed = subprocess.run(
                ["hermes", "-z", build_prompt(payload)],
                text=True,
                capture_output=True,
                timeout=TIMEOUT_MS / 1000,
                check=False,
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            stdout = completed.stdout or ""
            stderr = completed.stderr or ""
            if len(stdout.encode("utf-8", errors="replace")) > MAX_STDOUT_BYTES:
                status, body = error_response(
                    "HERMES_BRIDGE_STDOUT_TOO_LARGE",
                    f"Hermes stdout exceeded {MAX_STDOUT_BYTES} bytes.",
                    502,
                    raw={"durationMs": duration_ms},
                )
                self.send_json(status, body)
                return
            if completed.returncode != 0:
                status, body = error_response(
                    "HERMES_BRIDGE_EXECUTION_FAILED",
                    stderr.strip() or stdout.strip() or f"Hermes exited with code {completed.returncode}.",
                    502,
                    raw={
                        "exitCode": completed.returncode,
                        "stdoutPreview": truncate_bytes(mask_secrets(stdout), MAX_STDOUT_BYTES)[0],
                        "stderrPreview": truncate_bytes(mask_secrets(stderr), MAX_STDOUT_BYTES)[0],
                        "durationMs": duration_ms,
                    },
                )
                self.send_json(status, body)
                return
            self.send_json(200, normalize_success(stdout, stderr, duration_ms))
        except subprocess.TimeoutExpired:
            duration_ms = int((time.monotonic() - started) * 1000)
            status, body = error_response(
                "HERMES_BRIDGE_TIMEOUT",
                f"Hermes command timed out after {TIMEOUT_MS}ms.",
                504,
                raw={"durationMs": duration_ms},
            )
            self.send_json(status, body)
        except Exception as exc:
            status, body = error_response("HERMES_BRIDGE_INTERNAL_ERROR", str(exc), 500)
            self.send_json(status, body)
        finally:
            semaphore.release()


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Hermes bridge listening on {HOST}:{PORT}", flush=True)
    httpd.serve_forever()
