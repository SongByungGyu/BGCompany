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
LEGACY_TIMEOUT_MS = max(1000, int(os.environ.get("HERMES_BRIDGE_TIMEOUT_MS", "60000")))
AGENT_TIMEOUT_MS = {
    "content-planner": max(1000, int(os.environ.get("HERMES_PLANNER_TIMEOUT_MS", str(max(LEGACY_TIMEOUT_MS, 60000))))),
    "marketing-manager": max(1000, int(os.environ.get("HERMES_MARKETING_TIMEOUT_MS", str(max(LEGACY_TIMEOUT_MS, 60000))))),
    "content-writer": max(1000, int(os.environ.get("HERMES_WRITER_TIMEOUT_MS", str(max(LEGACY_TIMEOUT_MS, 120000))))),
    "qa-auditor": max(1000, int(os.environ.get("HERMES_QA_TIMEOUT_MS", str(max(LEGACY_TIMEOUT_MS, 90000))))),
}
MAX_STDOUT_BYTES = int(os.environ.get("HERMES_BRIDGE_MAX_STDOUT_BYTES", "200000"))
MAX_CONCURRENCY = max(1, int(os.environ.get("HERMES_BRIDGE_MAX_CONCURRENCY", "1")))
MAX_BODY_BYTES = int(os.environ.get("HERMES_BRIDGE_MAX_BODY_BYTES", "1048576"))
MAX_MEMORY_PERCENT = min(100.0, max(1.0, float(os.environ.get("HERMES_BRIDGE_MAX_MEMORY_PERCENT", "80"))))
HERMES_PROVIDER = os.environ.get("HERMES_BRIDGE_PROVIDER", "openai-api").strip()
HERMES_MODEL = os.environ.get("HERMES_BRIDGE_MODEL", "gpt-5.4-mini").strip()

ALLOWED_AGENT_IDS = {"content-planner", "marketing-manager", "content-writer", "qa-auditor"}
ALLOWED_TASK_TYPES = {"content_planning", "marketing_review", "content_writing", "qa_review"}
AGENT_TASK_TYPE_PAIRS = {
    "content-planner": "content_planning",
    "marketing-manager": "marketing_review",
    "content-writer": "content_writing",
    "qa-auditor": "qa_review",
}
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]{12,}", re.IGNORECASE),
]
UPSTREAM_ERROR_PATTERNS = [
    re.compile(r"(?:^|\n)\s*HTTP\s+[45]\d{2}\s*:", re.IGNORECASE),
    re.compile(r"(?:^|\n)\s*(?:API\s+error|Error)\s*:", re.IGNORECASE),
]

semaphore = threading.BoundedSemaphore(MAX_CONCURRENCY)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def timeout_for_agent(agent_id: str) -> int:
    return AGENT_TIMEOUT_MS.get(agent_id, LEGACY_TIMEOUT_MS)


def current_memory_usage_percent() -> float | None:
    try:
        current_path = "/sys/fs/cgroup/memory.current"
        maximum_path = "/sys/fs/cgroup/memory.max"
        if os.path.exists(current_path) and os.path.exists(maximum_path):
            with open(current_path, encoding="utf-8") as current_file:
                current = int(current_file.read().strip())
            with open(maximum_path, encoding="utf-8") as maximum_file:
                maximum_text = maximum_file.read().strip()
            if maximum_text != "max":
                maximum = int(maximum_text)
                if maximum > 0:
                    return round((current / maximum) * 100, 2)
    except (OSError, ValueError):
        pass

    try:
        memory: dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as meminfo:
            for line in meminfo:
                key, value = line.split(":", 1)
                memory[key] = int(value.strip().split()[0])
        total = memory.get("MemTotal", 0)
        available = memory.get("MemAvailable", 0)
        if total > 0:
            return round(((total - available) / total) * 100, 2)
    except (OSError, ValueError, IndexError):
        pass
    return None


def build_run_telemetry(
    *,
    agent_id: str,
    duration_ms: int,
    prompt_bytes: int,
    output_bytes: int,
    exit_code: int | None,
    timeout_limit_ms: int,
    memory_usage_percent: float | None,
) -> dict[str, Any]:
    return {
        "agentId": agent_id,
        "model": HERMES_MODEL,
        "durationMs": duration_ms,
        "promptBytes": prompt_bytes,
        "outputBytes": output_bytes,
        "exitCode": exit_code,
        "timeoutLimitMs": timeout_limit_ms,
        "memoryUsagePercentAtStart": memory_usage_percent,
    }


def log_run_telemetry(status: str, telemetry: dict[str, Any]) -> None:
    print(json.dumps({"event": "hermes_run", "status": status, **telemetry}, ensure_ascii=False), flush=True)


def mask_secrets(value: str) -> str:
    masked = value
    for pattern in SECRET_PATTERNS:
        masked = pattern.sub("[masked]", masked)
    return masked


def looks_like_upstream_error(stdout: str) -> bool:
    return any(pattern.search(stdout) for pattern in UPSTREAM_ERROR_PATTERNS)


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


def extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return None


def parse_jsonish_stdout(stdout: str) -> tuple[dict[str, Any] | None, str]:
    value = strip_code_fence(stdout)
    try:
        parsed = json.loads(value)
        return (parsed if isinstance(parsed, dict) else {"content": parsed}), "json"
    except json.JSONDecodeError:
        pass
    extracted = extract_first_json_object(value)
    if extracted:
        try:
            parsed = json.loads(extracted)
            return (parsed if isinstance(parsed, dict) else {"content": parsed}), "json_extracted"
        except json.JSONDecodeError:
            pass
    return None, "fallback_text"

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


def pick_string_list(record: dict[str, Any], *keys: str) -> list[str] | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, list):
            result = [item.strip() for item in value if isinstance(item, str) and item.strip()]
            if result:
                return result
        if isinstance(value, str) and value.strip():
            result = [item.strip() for item in re.split(r"[,\n]", value) if item.strip()]
            if result:
                return result
    return None


def short_text(value: Any, limit: int = 600) -> Any:
    if not isinstance(value, str):
        return value
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned if len(cleaned) <= limit else cleaned[:limit] + "…"


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def compact_market_snapshot(input_data: dict[str, Any]) -> dict[str, Any]:
    bundle = input_data.get("referenceBundle") if isinstance(input_data.get("referenceBundle"), dict) else {}
    source = input_data.get("marketSnapshot") if isinstance(input_data.get("marketSnapshot"), dict) else bundle.get("marketSnapshot")
    if not isinstance(source, dict):
        return {}
    return {
        key: source[key]
        for key in ("status", "provider", "dataQuality", "marketDate", "freshness", "korea", "us", "macro", "upcoming")
        if key in source
    }


def compact_reference_context(input_data: dict[str, Any]) -> list[dict[str, Any]]:
    bundle = input_data.get("referenceBundle") if isinstance(input_data.get("referenceBundle"), dict) else {}
    source = input_data.get("realReferences") if isinstance(input_data.get("realReferences"), list) else bundle.get("items")
    if not isinstance(source, list):
        return []
    result: list[dict[str, Any]] = []
    for item in source[:10]:
        if not isinstance(item, dict):
            continue
        compact = {
            key: short_text(item[key], 500)
            for key in ("title", "publisher", "publishedAt", "url", "summary", "usageNote", "reliability")
            if key in item
        }
        result.append(compact)
    return result


def compact_competitor_context(input_data: dict[str, Any]) -> dict[str, Any]:
    bundle = input_data.get("referenceBundle") if isinstance(input_data.get("referenceBundle"), dict) else {}
    source = input_data.get("competitorBlogReferences") if isinstance(input_data.get("competitorBlogReferences"), list) else bundle.get("competitorBlogReferences")
    analysis = input_data.get("competitorAnalysis") if isinstance(input_data.get("competitorAnalysis"), dict) else bundle.get("competitorAnalysis")
    if not isinstance(analysis, dict):
        analysis = {}
    examples: list[dict[str, Any]] = []
    if isinstance(source, list):
        for item in source[:5]:
            if not isinstance(item, dict):
                continue
            structure = item.get("structure") if isinstance(item.get("structure"), dict) else {}
            examples.append({
                "title": short_text(item.get("title"), 180),
                "blogName": short_text(item.get("blogName"), 80),
                "publishedAt": item.get("publishedAt"),
                "url": item.get("url"),
                "keywords": item.get("keywords"),
                "observedStructure": item.get("observedStructure"),
                "differentiationPoint": short_text(item.get("differentiationPoint"), 250),
                "structure": {
                    key: structure[key]
                    for key in (
                        "status", "titleLength", "bodyLength", "introLength", "paragraphCount", "headingCount",
                        "imageCount", "linkCount", "listItemCount", "tableCount", "hasDateInTitle", "hasChecklist",
                        "hasSourceSection", "hasDisclaimer", "hasCallToAction",
                    )
                    if key in structure
                },
            })
    summary = {
        key: analysis[key]
        for key in (
            "requestedCount", "analyzedCount", "failedCount", "averages", "commonPatterns",
            "differentiationOpportunities", "recommendedStructure", "copyrightPolicy",
        )
        if key in analysis
    }
    return {"summary": summary, "examples": examples}

def build_content_planner_prompt(payload: dict[str, Any]) -> str:
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    topic = str(input_data.get("topic") or "").strip()
    title = str(input_data.get("title") or "").strip()
    channel = str(input_data.get("channel") or "blog").strip()
    language = str(input_data.get("language") or "ko").strip()
    market_json = compact_json(compact_market_snapshot(input_data))
    references_json = compact_json(compact_reference_context(input_data))
    competitors_json = compact_json(compact_competitor_context(input_data))
    benchmark_guidelines_json = compact_json(input_data.get("editorialBenchmarkGuidelines") or [])
    return f"""
너는 BG Company의 content-planner AI 직원이다.
아래 입력을 바탕으로 {language} 언어의 {channel} 콘텐츠 기획안을 만든다.

입력:
- topic: {topic}
- title: {title}
- channel: {channel}
- verified market snapshot: {market_json}
- real reference summaries: {references_json}
- competitor structure benchmark: {competitors_json}
- accumulated safe editorial guidelines: {benchmark_guidelines_json}

목표:
- 실제 뉴스와 시장 데이터만 근거로 주식시장 브리핑 구조를 설계한다.
- 경쟁 블로그 문장은 복사하지 않고 구조 지표, 공통 패턴, 차별화 기회만 반영한다.
- 평균 길이와 소제목 수를 참고하되 BG Company의 실제 출처·기준일·체크리스트 강점을 우선한다.
- 누적 가이드는 이전 자사 글과 경쟁군의 구조 비교에서 안전하다고 판정된 항목만 반영하며 경쟁 글의 표현은 재사용하지 않는다.
- 마케팅 검토와 QA 검토가 이어질 수 있도록 제목, 구조, 메시지, 독자, SEO, 썸네일 방향을 명확히 준다.

엄격한 출력 규칙:
- 반드시 JSON 객체만 출력한다.
- JSON 앞뒤 설명 문장, markdown, code fence를 절대 쓰지 않는다.
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.
- 비용을 고려해 장황한 원고 대신 운영 UI에 표시 가능한 분량으로 작성한다.
- outline은 최소 6개 이상 작성한다.
- content는 짧지만 바로 초안으로 확장 가능한 한국어 문단으로 작성한다.

출력 JSON schema:
{{
  "title": "최종 제목",
  "summary": "콘텐츠 요약",
  "outline": ["섹션 1", "섹션 2", "섹션 3", "섹션 4"],
  "draftDirection": "초안 작성 방향",
  "content": "실제 블로그 초안 또는 상세 기획안",
  "seoKeywords": ["키워드 1", "키워드 2", "키워드 3"],
  "targetAudience": "대상 독자",
  "tone": "문체/톤",
  "thumbnailIdea": "썸네일 아이디어",
  "cta": "마무리 행동 유도 문구"
}}
""".strip()


def build_marketing_review_prompt(payload: dict[str, Any]) -> str:
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    topic = str(input_data.get("topic") or "").strip()
    title = str(input_data.get("title") or "").strip()
    channel = str(input_data.get("channel") or "blog").strip()
    language = str(input_data.get("language") or "ko").strip()
    planner_source = input_data.get("plannerResult") if isinstance(input_data.get("plannerResult"), dict) else {}
    planner_result = {
        key: planner_source[key]
        for key in ("title", "summary", "outline", "draftDirection", "seoKeywords", "targetAudience", "tone")
        if key in planner_source
    }
    planner_json = compact_json(planner_result)
    competitors_json = compact_json(compact_competitor_context(input_data))
    differentiation_json = compact_json(input_data.get("differentiationPoints") or [])
    benchmark_guidelines_json = compact_json(input_data.get("editorialBenchmarkGuidelines") or [])
    return f"""
너는 BG Company의 marketing-manager AI 직원이다.
content-planner가 만든 결과를 바탕으로 {language} 언어의 {channel} 콘텐츠 마케팅 검토안을 작성한다.

입력:
- topic: {topic}
- original title: {title}
- channel: {channel}
- content-planner result:
{planner_json}
- competitor structure benchmark: {competitors_json}
- differentiation opportunities: {differentiation_json}
- accumulated safe editorial guidelines: {benchmark_guidelines_json}

역할:
- 제목 개선, 썸네일 문구, SEO 키워드, 도입부 hook, SNS/홍보 문구, 클릭 포인트를 제안한다.
- 마케팅 리스크와 개선 제안을 점검한다.
- 경쟁 글의 제목 길이·날짜 사용·도입부·소제목·이미지·체크리스트 패턴을 참고해 검색 친화적인 구조를 제안한다.
- 경쟁 글 문장과 표현은 복사하지 않고 BG Company의 실제 출처와 데이터 투명성으로 차별화한다.
- 누적 가이드 중 검색성·가독성·출처 투명성에 관한 항목만 제목과 도입부 개선에 사용한다.
- 과장 광고, 허위 주장, 실제보다 큰 성과 표현은 피한다.
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.

엄격한 출력 규칙:
- 반드시 JSON 객체만 출력한다.
- JSON 앞뒤 설명 문장, markdown, code fence를 절대 쓰지 않는다.
- 한국어로 작성한다.
- marketingScore는 0부터 100 사이 숫자다.
- finalRecommendation은 approve 또는 revise 중 하나다.

출력 JSON schema:
{{
  "reviewSummary": "마케팅 검토 요약",
  "titleSuggestions": ["제목 후보 1", "제목 후보 2", "제목 후보 3"],
  "recommendedTitle": "추천 제목",
  "thumbnailCopy": "썸네일 문구",
  "seoKeywords": ["키워드 1", "키워드 2", "키워드 3"],
  "introHook": "도입부 hook",
  "promotionCopy": {{ "short": "짧은 홍보 문구", "long": "긴 홍보 문구" }},
  "clickPoints": ["클릭 포인트 1", "클릭 포인트 2"],
  "riskNotes": ["주의사항 1"],
  "improvementSuggestions": ["개선 제안 1", "개선 제안 2"],
  "marketingScore": 80,
  "finalRecommendation": "approve",
  "reason": "판단 이유"
}}
""".strip()


def build_content_writer_prompt(payload: dict[str, Any]) -> str:
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    topic = str(input_data.get("topic") or "").strip()
    title = str(input_data.get("title") or "").strip()
    channel = str(input_data.get("channel") or "blog").strip()
    language = str(input_data.get("language") or "ko").strip()
    planner_source = input_data.get("plannerResult") if isinstance(input_data.get("plannerResult"), dict) else {}
    marketing_source = input_data.get("marketingResult") if isinstance(input_data.get("marketingResult"), dict) else {}
    planner_result = {
        key: planner_source[key]
        for key in ("title", "summary", "outline", "draftDirection", "seoKeywords", "targetAudience", "tone")
        if key in planner_source
    }
    marketing_result = {
        key: marketing_source[key]
        for key in ("reviewSummary", "recommendedTitle", "seoKeywords", "introHook", "riskNotes", "improvementSuggestions")
        if key in marketing_source
    }
    planner_json = compact_json(planner_result)
    marketing_json = compact_json(marketing_result)
    market_json = compact_json(compact_market_snapshot(input_data))
    references_json = compact_json(compact_reference_context(input_data))
    competitors_json = compact_json(compact_competitor_context(input_data))
    body_structure_json = compact_json(input_data.get("bodyStructure") or [])
    benchmark_guidelines_json = compact_json(input_data.get("editorialBenchmarkGuidelines") or [])
    reference_bundle = input_data.get("referenceBundle") if isinstance(input_data.get("referenceBundle"), dict) else {}
    next_week_preview = (
        reference_bundle.get("contentType") == "NEXT_WEEK_MARKET_PREVIEW"
        or "다음 주" in f"{topic} {title}"
        or "다음주" in f"{topic} {title}"
    )
    writer_policy = """
- 개인 투자자가 운영하는 네이버 주식 블로그의 전문 에디터처럼, 꾸준히 시장을 본 사람이 독자에게 설명하는 자연스러운 존댓말로 쓴다.
- 최근 움직임 → 데이터와 기사에 근거한 이유 → 다음 주 영향 → 투자자가 확인할 항목의 흐름으로 연결하고 수치·기사를 나열하는 보고서체를 피한다.
- 근거가 부족한 해석은 "가능성이 있습니다", "주의해서 볼 필요가 있습니다", "시장의 반응을 확인해야 합니다", "변동성이 커질 수 있습니다"처럼 조건부로 표현한다.
- 입력 ReferenceBundle과 verified market snapshot에서 확인되지 않은 일정·수치·기사 내용은 만들지 않는다. 수급 단위가 불확실하거나 값이 비정상적이면 숫자를 쓰지 말고 외국인·기관·개인의 방향성만 설명한다.
- 본문에는 API 주소, 원문 데이터 URL, JSON 필드명, asOf, 데이터 수집 과정, 내부 분석 과정, "AI 활용 설정", "사진 설명을 입력하세요", "제목과 짧은 설명을 바탕으로 재구성했습니다", 기계적인 "시장 영향" 항목명을 쓰지 않는다.
- 별도의 "데이터 기준" 블록을 만들지 않고 시장 데이터의 의미를 자연스러운 문장에 녹인다.
- 신뢰할 수 있고 전망과 직접 관련된 뉴스 기사 정확히 3개만 선택해 핵심 내용을 본문 문장에 재서술한다. 기사 제목·설명을 복사하지 않는다.
- URL은 마지막 "함께 확인한 기사" 섹션의 기사 3개에만 각각 1개씩 표시한다. 일정·시장 데이터·본문 중간에는 URL을 쓰지 않는다.
- sections는 다음 순서와 heading을 지킨다: "1. 지난주 시장은 어땠을까", "2. 다음 주 한국 증시 전망", "3. 다음 주 미국 증시 전망", "4. 다음 주 핵심 일정", "5. 이번 주에 눈여겨볼 기회와 위험", "6. 개인 투자자가 확인할 것", "함께 확인한 기사".
- 지난주 섹션은 투자심리, 수급, 환율·금리, 강약 업종, 민감 재료를 3~5개 자연스러운 문단으로 설명한다.
- 한국 전망은 경제지표·정책·수급·원달러 환율·반도체 대형주·코스닥 성장주를 상승 조건과 하락 위험으로 나누어 연결한다.
- 미국 전망은 실적 시즌·대형 기술주 가이던스·2년물과 10년물 금리·달러·연준 기대·글로벌 일정·성장주와 경기민감주의 상대 흐름을 해석한다.
- 핵심 일정은 검증된 일정만 날짜별로 간단히 쓰고 각 일정이 중요한 이유를 한 문장으로 덧붙인다. 일정을 억지로 채우지 않는다.
- 기회와 위험은 각각 2~3개이며 각 항목을 2~3문장으로 설명한다. 개인 투자자 체크리스트는 4~6개로 제한한다.
- conclusion은 앞 문장을 반복하지 말고 한국 GDP·원달러 환율·기업 실적·국채금리처럼 다음 주 핵심 변수를 구체적으로 다시 연결한다.
- cta에는 "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다."를 정확히 한 번만 쓴다.
- 전체 공개 본문은 공백 포함 약 2,000~3,000자로 작성하고, 한 문단은 2~4문장으로 구성한다. 같은 어미와 "관찰됐습니다", "확인했습니다", "전망입니다"를 연속 반복하지 않는다.
- "함께 확인한 기사"는 정확히 다음 형식으로 작성한다: 번호. 기사 제목 – 언론사, 발행일 다음 줄에 원문 링크. 이 섹션에는 실제 활용한 기사 3개만 둔다.
""".strip() if next_week_preview else """
- 모든 구체 수치와 일정은 제공된 시장 스냅샷 또는 실제 참고자료에서 확인되는 경우에만 사용한다.
- 참고자료 URL과 데이터 기준일을 독자가 확인할 수 있게 분리한다.
- 첫 번째 sections 항목의 heading은 반드시 "데이터 기준"으로 작성하고, body에 한국 지수·수급, 미국 지수·환율·금리의 각 asOf 날짜와 원문 URL을 직접 적는다.
- 수급 값에는 market snapshot의 unit을 반드시 함께 적고, unit이 없으면 수치를 본문에 쓰지 않는다.
- 다음 주 일정은 각 항목의 날짜와 원문 URL을 함께 적는다. 발표 시각이 입력에 없으면 임의 생성하지 말고 "발표 시각은 원문 일정에서 확인"이라고 명시한다.
- verified market snapshot의 upcoming 날짜·이벤트명·URL은 변경할 수 없는 원문 값이다. 요일이나 관행을 근거로 날짜를 보정하거나 하루 앞뒤로 옮기지 말고 입력값을 정확히 복사한다.
- market snapshot의 strongSectors·weakSectors에는 순수 업종 외 지수·테마·상품이 섞일 수 있으므로 모두를 "섹터"로 단정하지 말고 "시장 강약 항목"으로 표현하고 포함 범위를 고지한다.
- "오늘", "오늘 장"처럼 기준일을 흐리는 표현을 쓰지 말고 "최근 거래일 기준", "이번 브리핑 기준"으로 바꾼다.
- 전망과 해석은 "가능성", "관찰 포인트", "확인 필요" 중심으로 쓰고 사실 문장과 분리한다.
""".strip()
    strict_writer_rules = """
- sections는 위에서 지정한 7개 heading을 정확한 순서로 가진다.
- introduction, sections의 body, conclusion, cta를 합친 공개 본문은 공백 포함 약 2,000~3,000자다.
- "함께 확인한 기사" 외부의 URL은 0개이고, 해당 섹션에는 서로 다른 실제 기사 URL이 정확히 3개다.
""".strip() if next_week_preview else """
- sections는 최소 6개 이상이며 각 항목은 서로 다른 heading과 body를 가진다.
- introduction, sections의 body, conclusion을 합친 본문은 공백 제외 2500자 이상이 되도록 작성하고 같은 문장을 반복하지 않는다.
""".strip()
    return f"""
너는 BG Company의 content-writer AI 직원이다.
content-planner의 기획안과 marketing-manager의 검토안을 바탕으로 {language} 언어의 {channel} 게시용 본문 초안을 작성한다.

입력:
- topic: {topic}
- original title: {title}
- channel: {channel}
- content-planner result:
{planner_json}
- marketing-manager result:
{marketing_json}
- verified market snapshot: {market_json}
- real reference summaries: {references_json}
- competitor structure benchmark: {competitors_json}
- accumulated safe editorial guidelines: {benchmark_guidelines_json}
- required body structure: {body_structure_json}

역할:
- 기획 의도와 마케팅 검토를 반영해 실제 게시 가능한 본문 초안을 작성한다.
- 제목, 메타 설명, 도입부, 본문 섹션, 결론, CTA를 분리한다.
- 과장 광고, 검증되지 않은 수치, 실제 운영으로 오해될 표현은 피한다.
- 경쟁 블로그의 평균 길이와 구조 패턴은 참고하되 문장·비유·체크리스트 항목을 복사하지 않는다.
- 누적 가이드는 현재 검증 데이터와 충돌하지 않는 범위에서만 반영하고, 사실 판단보다 문단·소제목·이미지·체크리스트 구조에만 사용한다.
{writer_policy}
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.

엄격한 출력 규칙:
- 반드시 JSON 객체만 출력한다.
- JSON 앞뒤 설명 문장, markdown, code fence를 절대 쓰지 않는다.
- 한국어로 작성한다.
{strict_writer_rules}
- fullDraft, markdownDraft, htmlDraft는 출력하지 않는다. 서버가 sections를 기준으로 파생 본문을 조립한다.

출력 JSON schema:
{{
  "finalTitle": "최종 게시 제목",
  "metaDescription": "검색/공유용 메타 설명",
  "introduction": "도입부 문단",
  "sections": [
    {{ "heading": "섹션 제목 1", "body": "섹션 본문 1" }},
    {{ "heading": "섹션 제목 2", "body": "섹션 본문 2" }},
    {{ "heading": "섹션 제목 3", "body": "섹션 본문 3" }}
  ],
  "conclusion": "마무리 문단",
  "cta": "행동 유도 문구",
  "usedSeoKeywords": ["키워드 1", "키워드 2"]
}}
""".strip()


def build_qa_audit_prompt(payload: dict[str, Any]) -> str:
    input_data = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    topic = str(input_data.get("topic") or "").strip()
    title = str(input_data.get("title") or "").strip()
    channel = str(input_data.get("channel") or "blog").strip()
    language = str(input_data.get("language") or "ko").strip()
    planner_source = input_data.get("plannerResult") if isinstance(input_data.get("plannerResult"), dict) else {}
    marketing_source = input_data.get("marketingResult") if isinstance(input_data.get("marketingResult"), dict) else {}
    writer_source = input_data.get("writerResult") if isinstance(input_data.get("writerResult"), dict) else {}
    reference_source = input_data.get("realReferences") if isinstance(input_data.get("realReferences"), list) else []
    market_snapshot_source = compact_market_snapshot(input_data)
    planner_result = {key: planner_source[key] for key in ("title", "summary", "outline") if key in planner_source}
    marketing_result = {
        key: marketing_source[key]
        for key in ("reviewSummary", "recommendedTitle", "riskNotes", "improvementSuggestions")
        if key in marketing_source
    }
    writer_result = {
        key: writer_source[key]
        for key in ("finalTitle", "metaDescription", "fullDraft", "markdownDraft", "usedSeoKeywords", "writingNotes", "verifiedSchedule", "scheduleValidation")
        if key in writer_source
    }
    if writer_result.get("fullDraft"):
        writer_result.pop("markdownDraft", None)
    real_references = [
        {
            key: item[key]
            for key in ("title", "publisher", "publishedAt", "url", "summary")
            if key in item
        }
        for item in reference_source[:10]
        if isinstance(item, dict)
    ]
    market_snapshot = {
        key: market_snapshot_source[key]
        for key in ("status", "provider", "dataQuality", "marketDate", "freshness", "korea", "us", "macro", "upcoming")
        if key in market_snapshot_source
    }
    planner_json = json.dumps(planner_result, ensure_ascii=False, indent=2)
    marketing_json = json.dumps(marketing_result, ensure_ascii=False, indent=2)
    writer_json = json.dumps(writer_result, ensure_ascii=False, indent=2)
    references_json = json.dumps(real_references, ensure_ascii=False, indent=2)
    market_snapshot_json = json.dumps(market_snapshot, ensure_ascii=False, indent=2)
    benchmark_guidelines_json = compact_json(input_data.get("editorialBenchmarkGuidelines") or [])
    quality_diagnostics = input_data.get("qualityGateDiagnostics") if isinstance(input_data.get("qualityGateDiagnostics"), dict) else {}
    quality_target = int(quality_diagnostics.get("requiredEditorialQualityScore") or 90)
    reference_bundle = input_data.get("referenceBundle") if isinstance(input_data.get("referenceBundle"), dict) else {}
    next_week_preview = (
        reference_bundle.get("contentType") == "NEXT_WEEK_MARKET_PREVIEW"
        or "다음 주" in f"{topic} {title}"
        or "다음주" in f"{topic} {title}"
    )
    qa_policy = """
- 글이 최근 움직임 → 근거에 기반한 이유 → 다음 주 영향 → 투자자 확인사항의 흐름으로 자연스럽게 이어지는지 확인한다.
- 공개 본문이 공백 포함 약 2,000~3,000자이고 지정된 7개 section heading, 4~6개 개인 투자자 체크리스트, 기회·위험 각각 2~3개를 갖췄는지 확인한다.
- "함께 확인한 기사"에 실제 활용한 신뢰 가능한 기사 정확히 3개와 서로 다른 원문 링크 3개만 있고, 링크가 본문 중간·일정·시장 데이터 문단에 노출되지 않았는지 확인한다.
- API 주소, JSON 필드명, asOf, 데이터 수집·내부 분석 과정, AI 설정, 이미지 설명 문구, 기계적인 "시장 영향" 항목명이 노출되면 필수 수정으로 판정한다.
- 수급 단위가 불확실하거나 비정상적인 값은 숫자 대신 방향성으로 설명했는지, 확인되지 않은 일정·수치·기사를 만들지 않았는지 검사한다.
- 검증 일정의 날짜와 이벤트가 scheduleValidation으로 대조되었다면 URL을 공개 본문에 쓰라고 요구하지 않는다. 숨은 verifiedSchedule의 URL은 검증 메타데이터일 뿐 공개 문구가 아니다.
- conclusion이 한국 GDP·원달러 환율·기업 실적·국채금리 등 구체 변수를 다시 연결하고, 지정된 투자 유의 문구가 cta에 정확히 한 번만 있는지 확인한다.
- 기사 제목·설명을 그대로 복사하거나 경쟁 글 문장·비유·체크리스트를 베끼지 않았는지 확인한다.
""".strip() if next_week_preview else """
- 데이터 기준 블록, 지표별 asOf, 수급 단위, 일정별 날짜·원문 URL을 확인한다.
- 일정 입력에 발표 시각이 없으면 "발표 시각은 원문 일정에서 확인"이라는 고지를 정답으로 인정하고, 존재하지 않는 시각 생성을 요구하지 않는다.
- scheduleValidation.ok가 true이면 서버가 market snapshot의 upcoming으로 일정 블록을 재조립하고 날짜·이벤트명·URL을 코드로 대조한 결과다. 이 고정 블록의 날짜를 요일 추론이나 일반적인 발표 관행으로 다시 보정하지 않는다.
- 고정 일정 블록에 검증 범위와 누락 시장 고지가 있으면 입력 데이터의 범위를 정확히 밝힌 것으로 인정한다. 검증되지 않은 한국 일정을 임의로 추가하라고 요구하지 않는다.
- strongSectors·weakSectors를 "시장 강약 항목"으로 표시하고 지수·테마·상품 포함 가능성을 고지했다면 섹터 오분류로 판단하지 않는다.
- 수치·URL·단위가 입력과 일치하고 강한 전망 표현이 완화되었으면 선택 개선 의견만으로 needs_revision을 주지 않는다.
""".strip()
    return f"""
너는 BG Company의 qa-auditor AI 직원이다.
content-planner, marketing-manager, content-writer가 만든 결과를 바탕으로 {language} 언어의 {channel} 콘텐츠 게시 전 QA/감사 검토를 수행한다.

입력:
- topic: {topic}
- original title: {title}
- channel: {channel}
- content-planner result:
{planner_json}
- marketing-manager result:
{marketing_json}
- content-writer result:
{writer_json}
- verified market snapshot:
{market_snapshot_json}
- real reference summaries:
{references_json}
- accumulated safe editorial guidelines:
{benchmark_guidelines_json}
- required editorial quality score: {quality_target}/100

역할:
- content-writer가 작성한 최종 초안을 기준으로 사실성, 과장 표현, 논리 흐름, 오탈자/문체, 광고성/허위 표현 리스크를 검토한다.
- 게시 전 반드시 수정해야 할 사항과 선택 개선 사항을 구분한다.
- 모르는 사실은 추측하지 말고 "추가 확인 필요"라고 표시한다.
- qaScore가 {quality_target}점 미만이면 publishReadiness=ready 또는 finalRecommendation=approve로 판정하지 않는다.
- 누적 가이드는 가독성 비교에만 사용하고 경쟁 글의 문장·표현·고유한 구성을 재현하라고 요구하지 않는다.
{qa_policy}
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.

엄격한 출력 규칙:
- 반드시 JSON 객체만 출력한다.
- JSON 앞뒤 설명 문장, markdown, code fence를 절대 쓰지 않는다.
- 한국어로 작성한다.
- qaScore는 0부터 100 사이 숫자다.
- publishReadiness는 ready, needs_revision, blocked 중 하나다.
- finalRecommendation은 approve, revise, block 중 하나다.

출력 JSON schema:
{{
  "qaSummary": "QA 검토 요약",
  "factCheckNotes": ["사실성 검토 1"],
  "qualityNotes": ["품질 검토 1"],
  "riskNotes": ["리스크 1"],
  "typoAndStyleNotes": ["문장/스타일 개선 1"],
  "requiredRevisions": ["필수 수정 1"],
  "optionalSuggestions": ["선택 개선 1"],
  "publishReadiness": "needs_revision",
  "qaScore": 88,
  "finalRecommendation": "revise",
  "reason": "최종 판단 이유"
}}
""".strip()


def build_prompt(payload: dict[str, Any]) -> str:
    agent_id = payload.get("agentId")
    if agent_id == "marketing-manager":
        return build_marketing_review_prompt(payload)
    if agent_id == "content-writer":
        return build_content_writer_prompt(payload)
    if agent_id == "qa-auditor":
        return build_qa_audit_prompt(payload)
    return build_content_planner_prompt(payload)


def is_agent_task_allowed(agent_id: str, task_type: str) -> bool:
    return AGENT_TASK_TYPE_PAIRS.get(agent_id) == task_type


def normalize_common(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> tuple[dict[str, Any], dict[str, Any], str]:
    stdout = mask_secrets(stdout)
    stderr = mask_secrets(stderr)
    parsed, parse_status = parse_jsonish_stdout(stdout)
    parsed = parsed or {}
    raw_stdout, stdout_truncated = truncate_bytes(stdout, MAX_STDOUT_BYTES)
    raw_stderr, stderr_truncated = truncate_bytes(stderr, MAX_STDOUT_BYTES)
    common = {
        "ok": True,
        "provider": "hermes-bridge",
        "agentId": agent_id,
        "parseStatus": parse_status,
        "rawText": raw_stdout,
        "durationMs": duration_ms,
        "raw": {
            "exitCode": 0,
            "stdoutPreview": raw_stdout,
            "stderrPreview": raw_stderr,
            "stdoutTruncated": stdout_truncated,
            "stderrTruncated": stderr_truncated,
            "parseStatus": parse_status,
        },
    }
    return common, parsed, raw_stdout


def normalize_content_planner_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    common, parsed, raw_stdout = normalize_common(stdout, stderr, duration_ms, agent_id)
    content = pick_string(parsed, "content", "body", "draft", "article") or raw_stdout.strip()
    return {
        **common,
        "title": pick_string(parsed, "title", "outputTitle", "headline"),
        "summary": pick_string(parsed, "summary", "outputSummary", "description"),
        "outline": pick_outline(parsed),
        "draftDirection": pick_string(parsed, "draftDirection", "direction", "strategy"),
        "content": content,
        "seoKeywords": pick_string_list(parsed, "seoKeywords", "keywords", "seo"),
        "targetAudience": pick_string(parsed, "targetAudience", "audience", "reader"),
        "tone": pick_string(parsed, "tone", "voice", "style"),
        "thumbnailIdea": pick_string(parsed, "thumbnailIdea", "thumbnail", "visualIdea"),
        "cta": pick_string(parsed, "cta", "callToAction", "action"),
    }


def normalize_marketing_manager_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    common, parsed, raw_stdout = normalize_common(stdout, stderr, duration_ms, agent_id)
    promotion_copy = parsed.get("promotionCopy") if isinstance(parsed.get("promotionCopy"), dict) else None
    if promotion_copy is not None:
        promotion_copy = {
            "short": pick_string(promotion_copy, "short"),
            "long": pick_string(promotion_copy, "long"),
        }
    return {
        **common,
        "reviewSummary": pick_string(parsed, "reviewSummary", "summary", "outputSummary") or raw_stdout.strip(),
        "titleSuggestions": pick_string_list(parsed, "titleSuggestions", "titles", "headlineSuggestions"),
        "recommendedTitle": pick_string(parsed, "recommendedTitle", "bestTitle"),
        "thumbnailCopy": pick_string(parsed, "thumbnailCopy", "thumbnail", "thumbnailText"),
        "seoKeywords": pick_string_list(parsed, "seoKeywords", "keywords", "seo"),
        "introHook": pick_string(parsed, "introHook", "hook", "opening"),
        "promotionCopy": promotion_copy,
        "clickPoints": pick_string_list(parsed, "clickPoints", "sellingPoints", "appealPoints"),
        "riskNotes": pick_string_list(parsed, "riskNotes", "risks", "risk"),
        "improvementSuggestions": pick_string_list(parsed, "improvementSuggestions", "suggestions", "improvements"),
        "marketingScore": parsed.get("marketingScore") if isinstance(parsed.get("marketingScore"), (int, float)) else None,
        "finalRecommendation": parsed.get("finalRecommendation") if parsed.get("finalRecommendation") in ("approve", "revise") else None,
        "reason": pick_string(parsed, "reason", "recommendationReason"),
    }


def pick_writer_sections(record: dict[str, Any]) -> list[dict[str, str]] | None:
    value = record.get("sections") or record.get("bodySections")
    if not isinstance(value, list):
        return None
    result: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append({"heading": f"Section {len(result) + 1}", "body": item.strip()})
        elif isinstance(item, dict):
            heading = pick_string(item, "heading", "title", "name") or f"Section {len(result) + 1}"
            body = pick_string(item, "body", "content", "text", "draft")
            if body:
                result.append({"heading": heading, "body": body})
    return result or None


def assemble_writer_drafts(
    introduction: str | None,
    sections: list[dict[str, str]] | None,
    conclusion: str | None,
    cta: str | None,
) -> tuple[str | None, str | None]:
    if not sections:
        return None, None

    plain_parts: list[str] = []
    markdown_parts: list[str] = []
    if introduction:
        plain_parts.append(introduction)
        markdown_parts.append(introduction)
    for section in sections:
        heading = section.get("heading", "").strip()
        body = section.get("body", "").strip()
        if heading:
            plain_parts.append(heading)
            markdown_parts.append(f"## {heading}")
        if body:
            plain_parts.append(body)
            markdown_parts.append(body)
    if conclusion:
        plain_parts.extend(["마무리", conclusion])
        markdown_parts.extend(["## 마무리", conclusion])
    if cta:
        plain_parts.append(cta)
        markdown_parts.append(cta)
    return "\n\n".join(plain_parts), "\n\n".join(markdown_parts)


def normalize_content_writer_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    common, parsed, raw_stdout = normalize_common(stdout, stderr, duration_ms, agent_id)
    introduction = pick_string(parsed, "introduction", "intro", "opening")
    sections = pick_writer_sections(parsed)
    conclusion = pick_string(parsed, "conclusion", "closing")
    cta = pick_string(parsed, "cta", "callToAction", "action")
    full_draft, markdown_draft = assemble_writer_drafts(introduction, sections, conclusion, cta)
    if not full_draft:
        full_draft = pick_string(parsed, "fullDraft", "draft", "content", "article", "body") or raw_stdout.strip()
    if not markdown_draft:
        markdown_draft = pick_string(parsed, "markdownDraft", "markdown", "fullDraft") or full_draft
    return {
        **common,
        "finalTitle": pick_string(parsed, "finalTitle", "title", "headline"),
        "metaDescription": pick_string(parsed, "metaDescription", "description", "summary"),
        "introduction": introduction,
        "sections": sections,
        "conclusion": conclusion,
        "cta": cta,
        "fullDraft": full_draft,
        "markdownDraft": markdown_draft,
        "usedSeoKeywords": pick_string_list(parsed, "usedSeoKeywords", "seoKeywords", "keywords"),
    }


def normalize_qa_auditor_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    common, parsed, raw_stdout = normalize_common(stdout, stderr, duration_ms, agent_id)
    publish_readiness = parsed.get("publishReadiness")
    final_recommendation = parsed.get("finalRecommendation")
    return {
        **common,
        "qaSummary": pick_string(parsed, "qaSummary", "summary", "reviewSummary") or raw_stdout.strip(),
        "factCheckNotes": pick_string_list(parsed, "factCheckNotes", "factChecks", "facts"),
        "qualityNotes": pick_string_list(parsed, "qualityNotes", "quality", "qualityIssues"),
        "riskNotes": pick_string_list(parsed, "riskNotes", "risks", "risk"),
        "typoAndStyleNotes": pick_string_list(parsed, "typoAndStyleNotes", "styleNotes", "typos"),
        "requiredRevisions": pick_string_list(parsed, "requiredRevisions", "requiredFixes", "mustFix"),
        "optionalSuggestions": pick_string_list(parsed, "optionalSuggestions", "suggestions", "optionalImprovements"),
        "publishReadiness": publish_readiness if publish_readiness in ("ready", "needs_revision", "blocked") else None,
        "qaScore": parsed.get("qaScore") if isinstance(parsed.get("qaScore"), (int, float)) else None,
        "finalRecommendation": final_recommendation if final_recommendation in ("approve", "revise", "block") else None,
        "reason": pick_string(parsed, "reason", "recommendationReason", "finalReason"),
    }


def normalize_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    if agent_id == "marketing-manager":
        return normalize_marketing_manager_success(stdout, stderr, duration_ms, agent_id)
    if agent_id == "content-writer":
        return normalize_content_writer_success(stdout, stderr, duration_ms, agent_id)
    if agent_id == "qa-auditor":
        return normalize_qa_auditor_success(stdout, stderr, duration_ms, agent_id)
    return normalize_content_planner_success(stdout, stderr, duration_ms, agent_id)

def error_response(code: str, message: str, status: int, *, agent_id: str = "content-planner", raw: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    return status, {
        "ok": False,
        "provider": "hermes-bridge",
        "agentId": agent_id,
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
                "timeoutMs": LEGACY_TIMEOUT_MS,
                "agentTimeoutMs": AGENT_TIMEOUT_MS,
                "maxMemoryPercent": MAX_MEMORY_PERCENT,
                "memoryUsagePercent": current_memory_usage_percent(),
                "provider": HERMES_PROVIDER,
                "model": HERMES_MODEL,
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
        agent_id = str(payload.get("agentId") or "")
        task_type = str(payload.get("taskType") or "")
        if not is_agent_task_allowed(agent_id, task_type):
            status, body = error_response(
                "HERMES_BRIDGE_AGENT_NOT_ALLOWED",
                "Only content-planner/content_planning, marketing-manager/marketing_review, content-writer/content_writing, and qa-auditor/qa_review runs are allowed by this bridge.",
                403,
                agent_id=agent_id or "unknown",
                raw={"agentId": payload.get("agentId"), "taskType": payload.get("taskType")},
            )
            self.send_json(status, body)
            return
        if not semaphore.acquire(blocking=False):
            status, body = error_response("HERMES_BRIDGE_BUSY", "Hermes bridge concurrency limit reached.", 429, agent_id=agent_id)
            self.send_json(status, body)
            return

        timeout_ms = timeout_for_agent(agent_id)
        memory_usage_percent = current_memory_usage_percent()
        if memory_usage_percent is not None and memory_usage_percent >= MAX_MEMORY_PERCENT:
            telemetry = build_run_telemetry(
                agent_id=agent_id,
                duration_ms=0,
                prompt_bytes=0,
                output_bytes=0,
                exit_code=None,
                timeout_limit_ms=timeout_ms,
                memory_usage_percent=memory_usage_percent,
            )
            log_run_telemetry("memory_blocked", telemetry)
            status, body = error_response(
                "HERMES_BRIDGE_MEMORY_PRESSURE",
                f"Hermes run blocked because memory usage is {memory_usage_percent:.2f}% (limit {MAX_MEMORY_PERCENT:.2f}%).",
                503,
                agent_id=agent_id,
                raw=telemetry,
            )
            self.send_json(status, body)
            semaphore.release()
            return

        prompt = ""
        prompt_bytes = 0
        started = time.monotonic()
        try:
            prompt = build_prompt(payload)
            prompt_bytes = len(prompt.encode("utf-8", errors="replace"))
            completed = subprocess.run(
                ["hermes", "--provider", HERMES_PROVIDER, "-m", HERMES_MODEL, "-z", prompt],
                text=True,
                capture_output=True,
                timeout=timeout_ms / 1000,
                check=False,
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            stdout = completed.stdout or ""
            stderr = completed.stderr or ""
            output_bytes = len(stdout.encode("utf-8", errors="replace"))
            telemetry = build_run_telemetry(
                agent_id=agent_id,
                duration_ms=duration_ms,
                prompt_bytes=prompt_bytes,
                output_bytes=output_bytes,
                exit_code=completed.returncode,
                timeout_limit_ms=timeout_ms,
                memory_usage_percent=memory_usage_percent,
            )
            if output_bytes > MAX_STDOUT_BYTES:
                log_run_telemetry("stdout_too_large", telemetry)
                status, body = error_response(
                    "HERMES_BRIDGE_STDOUT_TOO_LARGE",
                    f"Hermes stdout exceeded {MAX_STDOUT_BYTES} bytes.",
                    502,
                    agent_id=agent_id,
                    raw=telemetry,
                )
                self.send_json(status, body)
                return
            if completed.returncode != 0:
                log_run_telemetry("execution_failed", telemetry)
                status, body = error_response(
                    "HERMES_BRIDGE_EXECUTION_FAILED",
                    stderr.strip() or stdout.strip() or f"Hermes exited with code {completed.returncode}.",
                    502,
                    agent_id=agent_id,
                    raw={
                        "exitCode": completed.returncode,
                        "stdoutPreview": truncate_bytes(mask_secrets(stdout), MAX_STDOUT_BYTES)[0],
                        "stderrPreview": truncate_bytes(mask_secrets(stderr), MAX_STDOUT_BYTES)[0],
                        **telemetry,
                    },
                )
                self.send_json(status, body)
                return
            if looks_like_upstream_error(stdout):
                log_run_telemetry("upstream_error", telemetry)
                status, body = error_response(
                    "HERMES_BRIDGE_UPSTREAM_ERROR",
                    stdout.strip() or "Hermes provider returned an error response.",
                    502,
                    agent_id=agent_id,
                    raw={
                        "exitCode": completed.returncode,
                        "stdoutPreview": truncate_bytes(mask_secrets(stdout), MAX_STDOUT_BYTES)[0],
                        "stderrPreview": truncate_bytes(mask_secrets(stderr), MAX_STDOUT_BYTES)[0],
                        **telemetry,
                    },
                )
                self.send_json(status, body)
                return
            normalized = normalize_success(stdout, stderr, duration_ms, agent_id)
            normalized["telemetry"] = telemetry
            if isinstance(normalized.get("raw"), dict):
                normalized["raw"].update(telemetry)
            log_run_telemetry("succeeded", telemetry)
            self.send_json(200, normalized)
        except subprocess.TimeoutExpired:
            duration_ms = int((time.monotonic() - started) * 1000)
            telemetry = build_run_telemetry(
                agent_id=agent_id,
                duration_ms=duration_ms,
                prompt_bytes=prompt_bytes,
                output_bytes=0,
                exit_code=None,
                timeout_limit_ms=timeout_ms,
                memory_usage_percent=memory_usage_percent,
            )
            log_run_telemetry("timed_out", telemetry)
            status, body = error_response(
                "HERMES_BRIDGE_TIMEOUT",
                f"Hermes command timed out after {timeout_ms}ms.",
                504,
                agent_id=agent_id,
                raw=telemetry,
            )
            self.send_json(status, body)
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            telemetry = build_run_telemetry(
                agent_id=agent_id,
                duration_ms=duration_ms,
                prompt_bytes=prompt_bytes,
                output_bytes=0,
                exit_code=None,
                timeout_limit_ms=timeout_ms,
                memory_usage_percent=memory_usage_percent,
            )
            log_run_telemetry("internal_error", telemetry)
            status, body = error_response("HERMES_BRIDGE_INTERNAL_ERROR", str(exc), 500, agent_id=agent_id or "unknown", raw=telemetry)
            self.send_json(status, body)
        finally:
            semaphore.release()


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Hermes bridge listening on {HOST}:{PORT}", flush=True)
    httpd.serve_forever()
