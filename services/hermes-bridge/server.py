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

목표:
- 실제 뉴스와 시장 데이터만 근거로 주식시장 브리핑 구조를 설계한다.
- 경쟁 블로그 문장은 복사하지 않고 구조 지표, 공통 패턴, 차별화 기회만 반영한다.
- 평균 길이와 소제목 수를 참고하되 BG Company의 실제 출처·기준일·체크리스트 강점을 우선한다.
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

역할:
- 제목 개선, 썸네일 문구, SEO 키워드, 도입부 hook, SNS/홍보 문구, 클릭 포인트를 제안한다.
- 마케팅 리스크와 개선 제안을 점검한다.
- 경쟁 글의 제목 길이·날짜 사용·도입부·소제목·이미지·체크리스트 패턴을 참고해 검색 친화적인 구조를 제안한다.
- 경쟁 글 문장과 표현은 복사하지 않고 BG Company의 실제 출처와 데이터 투명성으로 차별화한다.
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
- required body structure: {body_structure_json}

역할:
- 기획 의도와 마케팅 검토를 반영해 실제 게시 가능한 본문 초안을 작성한다.
- 제목, 메타 설명, 도입부, 본문 섹션, 결론, CTA를 분리한다.
- 과장 광고, 검증되지 않은 수치, 실제 운영으로 오해될 표현은 피한다.
- 경쟁 블로그의 평균 길이와 구조 패턴은 참고하되 문장·비유·체크리스트 항목을 복사하지 않는다.
- 모든 구체 수치와 일정은 제공된 시장 스냅샷 또는 실제 참고자료에서 확인되는 경우에만 사용한다.
- 참고자료 URL과 데이터 기준일을 독자가 확인할 수 있게 분리한다.
- fullDraft 상단에 "데이터 기준" 블록을 두고 한국 지수·수급, 미국 지수·환율·금리의 각 asOf 날짜와 원문 URL을 직접 적는다.
- 수급 값에는 market snapshot의 unit을 반드시 함께 적고, unit이 없으면 수치를 본문에 쓰지 않는다.
- 다음 주 일정은 각 항목의 날짜와 원문 URL을 함께 적는다. 발표 시각이 입력에 없으면 임의 생성하지 말고 "발표 시각은 원문 일정에서 확인"이라고 명시한다.
- "오늘", "오늘 장"처럼 기준일을 흐리는 표현을 쓰지 말고 "최근 거래일 기준", "이번 브리핑 기준"으로 바꾼다.
- 전망과 해석은 "가능성", "관찰 포인트", "확인 필요" 중심으로 쓰고 사실 문장과 분리한다.
- 실제 게시, 외부 발송, 결제, 승인 처리는 하지 않는다.

엄격한 출력 규칙:
- 반드시 JSON 객체만 출력한다.
- JSON 앞뒤 설명 문장, markdown, code fence를 절대 쓰지 않는다.
- 한국어로 작성한다.
- sections는 최소 6개 이상이며 각 항목은 서로 다른 heading과 body를 가진다.
- fullDraft는 공백 제외 2500자 이상 작성하고 같은 문장을 반복하지 않는다.
- fullDraft 또는 markdownDraft 중 하나 이상은 반드시 작성한다.

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
  "fullDraft": "게시 가능한 전체 초안",
  "markdownDraft": "Markdown 형식 초안",
  "usedSeoKeywords": ["키워드 1", "키워드 2"],
  "writingNotes": ["작성 메모 1"]
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
        for key in ("finalTitle", "metaDescription", "fullDraft", "markdownDraft", "usedSeoKeywords", "writingNotes")
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

역할:
- content-writer가 작성한 최종 초안을 기준으로 사실성, 과장 표현, 논리 흐름, 오탈자/문체, 광고성/허위 표현 리스크를 검토한다.
- 게시 전 반드시 수정해야 할 사항과 선택 개선 사항을 구분한다.
- 모르는 사실은 추측하지 말고 "추가 확인 필요"라고 표시한다.
- 데이터 기준 블록, 지표별 asOf, 수급 단위, 일정별 날짜·원문 URL을 확인한다.
- 일정 입력에 발표 시각이 없으면 "발표 시각은 원문 일정에서 확인"이라는 고지를 정답으로 인정하고, 존재하지 않는 시각 생성을 요구하지 않는다.
- 수치·URL·단위가 입력과 일치하고 강한 전망 표현이 완화되었으면 선택 개선 의견만으로 needs_revision을 주지 않는다.
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


def normalize_content_writer_success(stdout: str, stderr: str, duration_ms: int, agent_id: str) -> dict[str, Any]:
    common, parsed, raw_stdout = normalize_common(stdout, stderr, duration_ms, agent_id)
    full_draft = pick_string(parsed, "fullDraft", "draft", "content", "article", "body") or raw_stdout.strip()
    return {
        **common,
        "finalTitle": pick_string(parsed, "finalTitle", "title", "headline"),
        "metaDescription": pick_string(parsed, "metaDescription", "description", "summary"),
        "introduction": pick_string(parsed, "introduction", "intro", "opening"),
        "sections": pick_writer_sections(parsed),
        "conclusion": pick_string(parsed, "conclusion", "closing"),
        "cta": pick_string(parsed, "cta", "callToAction", "action"),
        "fullDraft": full_draft,
        "markdownDraft": pick_string(parsed, "markdownDraft", "markdown", "fullDraft"),
        "htmlDraft": pick_string(parsed, "htmlDraft", "html"),
        "usedSeoKeywords": pick_string_list(parsed, "usedSeoKeywords", "seoKeywords", "keywords"),
        "writingNotes": pick_string_list(parsed, "writingNotes", "notes", "memo"),
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
                "timeoutMs": TIMEOUT_MS,
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

        started = time.monotonic()
        try:
            completed = subprocess.run(
                ["hermes", "--provider", HERMES_PROVIDER, "-m", HERMES_MODEL, "-z", build_prompt(payload)],
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
                    agent_id=agent_id,
                    raw={"durationMs": duration_ms},
                )
                self.send_json(status, body)
                return
            if completed.returncode != 0:
                status, body = error_response(
                    "HERMES_BRIDGE_EXECUTION_FAILED",
                    stderr.strip() or stdout.strip() or f"Hermes exited with code {completed.returncode}.",
                    502,
                    agent_id=agent_id,
                    raw={
                        "exitCode": completed.returncode,
                        "stdoutPreview": truncate_bytes(mask_secrets(stdout), MAX_STDOUT_BYTES)[0],
                        "stderrPreview": truncate_bytes(mask_secrets(stderr), MAX_STDOUT_BYTES)[0],
                        "durationMs": duration_ms,
                    },
                )
                self.send_json(status, body)
                return
            if looks_like_upstream_error(stdout):
                status, body = error_response(
                    "HERMES_BRIDGE_UPSTREAM_ERROR",
                    stdout.strip() or "Hermes provider returned an error response.",
                    502,
                    agent_id=agent_id,
                    raw={
                        "exitCode": completed.returncode,
                        "stdoutPreview": truncate_bytes(mask_secrets(stdout), MAX_STDOUT_BYTES)[0],
                        "stderrPreview": truncate_bytes(mask_secrets(stderr), MAX_STDOUT_BYTES)[0],
                        "durationMs": duration_ms,
                    },
                )
                self.send_json(status, body)
                return
            self.send_json(200, normalize_success(stdout, stderr, duration_ms, agent_id))
        except subprocess.TimeoutExpired:
            duration_ms = int((time.monotonic() - started) * 1000)
            status, body = error_response(
                "HERMES_BRIDGE_TIMEOUT",
                f"Hermes command timed out after {TIMEOUT_MS}ms.",
                504,
                agent_id=agent_id,
                raw={"durationMs": duration_ms},
            )
            self.send_json(status, body)
        except Exception as exc:
            status, body = error_response("HERMES_BRIDGE_INTERNAL_ERROR", str(exc), 500, agent_id=agent_id or "unknown")
            self.send_json(status, body)
        finally:
            semaphore.release()


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Hermes bridge listening on {HOST}:{PORT}", flush=True)
    httpd.serve_forever()
