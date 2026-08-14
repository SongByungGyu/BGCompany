#!/usr/bin/env python3
import importlib.util
import json
import unittest
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parents[1]
SERVER_PATH = BRIDGE_DIR / "server.py"

spec = importlib.util.spec_from_file_location("hermes_bridge_server", SERVER_PATH)
bridge = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge)


class JsonParserTests(unittest.TestCase):
    def test_plain_json_parse(self) -> None:
        parsed, status = bridge.parse_jsonish_stdout('{"title":"??","content":"??"}')
        self.assertEqual(status, "json")
        self.assertEqual(parsed["title"], "??")

    def test_markdown_fenced_json_parse(self) -> None:
        parsed, status = bridge.parse_jsonish_stdout('```json\n{"title":"??"}\n```')
        self.assertEqual(status, "json")
        self.assertEqual(parsed["title"], "??")

    def test_embedded_json_parse(self) -> None:
        parsed, status = bridge.parse_jsonish_stdout('?????. {"summary":"??","content":"??"} ?????.')
        self.assertEqual(status, "json_extracted")
        self.assertEqual(parsed["summary"], "??")

    def test_invalid_text_falls_back(self) -> None:
        parsed, status = bridge.parse_jsonish_stdout('?? ??? ??')
        self.assertIsNone(parsed)
        self.assertEqual(status, "fallback_text")


class NormalizeSuccessTests(unittest.TestCase):
    def test_content_planner_schema(self) -> None:
        stdout = json.dumps({
            "title": "BG Company ???",
            "summary": "??",
            "outline": ["??", {"title": "??"}],
            "draftDirection": "?? ?? ??",
            "content": "??",
            "seoKeywords": ["AI ??", "???"],
            "targetAudience": "1? ???",
            "tone": "??? ??",
            "thumbnailIdea": "??? ????",
            "cta": "?? ? ??",
        }, ensure_ascii=False)
        result = bridge.normalize_success(stdout, "", 1234, "content-planner")
        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "hermes-bridge")
        self.assertEqual(result["agentId"], "content-planner")
        self.assertEqual(result["parseStatus"], "json")
        self.assertEqual(result["title"], "BG Company ???")
        self.assertEqual(result["outline"], ["??", "??"])
        self.assertEqual(result["durationMs"], 1234)
        self.assertNotIn("reviewSummary", result)
        self.assertNotIn("recommendedTitle", result)

    def test_content_writer_schema(self) -> None:
        stdout = json.dumps({
            "finalTitle": "BG Company 구축기",
            "metaDescription": "AI 개인회사 구축 과정 요약",
            "introduction": "도입부입니다.",
            "sections": [{"heading": "시작", "body": "본문입니다."}, "문자열 섹션"],
            "conclusion": "마무리입니다.",
            "cta": "다음 편을 확인하세요.",
            "usedSeoKeywords": ["AI 개인회사", "Hermes"],
        }, ensure_ascii=False)
        result = bridge.normalize_success(stdout, "", 1500, "content-writer")
        self.assertTrue(result["ok"])
        self.assertEqual(result["agentId"], "content-writer")
        self.assertEqual(result["finalTitle"], "BG Company 구축기")
        self.assertEqual(result["sections"][0], {"heading": "시작", "body": "본문입니다."})
        self.assertEqual(result["sections"][1], {"heading": "Section 2", "body": "문자열 섹션"})
        self.assertEqual(result["fullDraft"], "도입부입니다.\n\n시작\n\n본문입니다.\n\nSection 2\n\n문자열 섹션\n\n마무리\n\n마무리입니다.\n\n다음 편을 확인하세요.")
        self.assertEqual(result["markdownDraft"], "도입부입니다.\n\n## 시작\n\n본문입니다.\n\n## Section 2\n\n문자열 섹션\n\n## 마무리\n\n마무리입니다.\n\n다음 편을 확인하세요.")
        self.assertEqual(result["usedSeoKeywords"], ["AI 개인회사", "Hermes"])
        self.assertNotIn("htmlDraft", result)
        self.assertNotIn("writingNotes", result)
        self.assertNotIn("reviewSummary", result)
        self.assertNotIn("qaSummary", result)

    def test_marketing_manager_schema(self) -> None:
        stdout = json.dumps({
            "reviewSummary": "??? ??? ?????.",
            "titleSuggestions": ["?? A", "?? B"],
            "recommendedTitle": "?? ??",
            "thumbnailCopy": "??? AI ??",
            "seoKeywords": "AI ???, ????",
            "introHook": "?? ?? ??? ????",
            "promotionCopy": {"short": "?? ??", "long": "? ??"},
            "clickPoints": ["??", "???"],
            "riskNotes": ["?? ??"],
            "improvementSuggestions": ["?? ?? ??"],
            "marketingScore": 87,
            "finalRecommendation": "approve",
            "reason": "?? ??",
        }, ensure_ascii=False)
        result = bridge.normalize_success(stdout, "", 2345, "marketing-manager")
        self.assertTrue(result["ok"])
        self.assertEqual(result["agentId"], "marketing-manager")
        self.assertEqual(result["reviewSummary"], "??? ??? ?????.")
        self.assertEqual(result["recommendedTitle"], "?? ??")
        self.assertEqual(result["seoKeywords"], ["AI ???", "????"])
        self.assertEqual(result["promotionCopy"], {"short": "?? ??", "long": "? ??"})
        self.assertEqual(result["marketingScore"], 87)
        self.assertNotIn("content", result)
        self.assertNotIn("draftDirection", result)

    def test_content_payload_does_not_become_marketing_payload(self) -> None:
        stdout = '{"title":"??? ??","summary":"??? ??","content":"??"}'
        result = bridge.normalize_success(stdout, "", 100, "content-planner")
        self.assertEqual(result["title"], "??? ??")
        self.assertNotIn("recommendedTitle", result)
        self.assertNotIn("reviewSummary", result)

    def test_marketing_payload_does_not_become_content_payload(self) -> None:
        stdout = '{"recommendedTitle":"?? ??","reviewSummary":"?? ??"}'
        result = bridge.normalize_success(stdout, "", 100, "marketing-manager")
        self.assertEqual(result["recommendedTitle"], "?? ??")
        self.assertNotIn("title", result)
        self.assertNotIn("content", result)

    def test_qa_auditor_schema(self) -> None:
        stdout = json.dumps({
            "qaSummary": "?? ????? ?? ??? ?????.",
            "factCheckNotes": ["?? ?? ?? ?? ??"],
            "qualityNotes": ["??? ?????"],
            "riskNotes": ["?? ?? ??"],
            "typoAndStyleNotes": ["?? ?? ??"],
            "requiredRevisions": ["?? ?? ?? ??"],
            "optionalSuggestions": ["??? ?? ??"],
            "publishReadiness": "needs_revision",
            "qaScore": 81,
            "finalRecommendation": "revise",
            "reason": "?? ?? ? ?? ??",
        }, ensure_ascii=False)
        result = bridge.normalize_success(stdout, "", 3456, "qa-auditor")
        self.assertTrue(result["ok"])
        self.assertEqual(result["agentId"], "qa-auditor")
        self.assertEqual(result["provider"], "hermes-bridge")
        self.assertEqual(result["qaSummary"], "?? ????? ?? ??? ?????.")
        self.assertEqual(result["factCheckNotes"], ["?? ?? ?? ?? ??"])
        self.assertEqual(result["publishReadiness"], "needs_revision")
        self.assertEqual(result["qaScore"], 81)
        self.assertEqual(result["finalRecommendation"], "revise")
        self.assertNotIn("recommendedTitle", result)
        self.assertNotIn("content", result)

    def test_qa_payload_does_not_become_content_or_marketing_payload(self) -> None:
        stdout = '{"qaSummary":"QA ??","finalRecommendation":"approve","publishReadiness":"ready"}'
        result = bridge.normalize_success(stdout, "", 100, "qa-auditor")
        self.assertEqual(result["qaSummary"], "QA ??")
        self.assertNotIn("title", result)
        self.assertNotIn("reviewSummary", result)

    def test_fallback_text_is_preserved(self) -> None:
        result = bridge.normalize_success("JSON? ?? Hermes ??", "", 300, "content-planner")
        self.assertEqual(result["parseStatus"], "fallback_text")
        self.assertEqual(result["content"], "JSON? ?? Hermes ??")
        self.assertIn("JSON? ?? Hermes ??", result["rawText"])


class ErrorResponseTests(unittest.TestCase):
    def test_error_response_shape_and_secret_masking(self) -> None:
        status, body = bridge.error_response(
            "HERMES_BRIDGE_EXECUTION_FAILED",
            "bad key sk-thisShouldBeMasked1234567890 Bearer abcdefghijklmnop",
            502,
            agent_id="marketing-manager",
            raw={"exitCode": 1},
        )
        self.assertEqual(status, 502)
        self.assertFalse(body["ok"])
        self.assertEqual(body["provider"], "hermes-bridge")
        self.assertEqual(body["agentId"], "marketing-manager")
        self.assertEqual(body["errorCode"], "HERMES_BRIDGE_EXECUTION_FAILED")
        self.assertNotIn("sk-thisShouldBeMasked", body["errorMessage"])
        self.assertNotIn("Bearer abcdef", body["errorMessage"])
        self.assertEqual(body["raw"], {"exitCode": 1})

    def test_timeout_error_shape(self) -> None:
        status, body = bridge.error_response(
            "HERMES_BRIDGE_TIMEOUT",
            "Hermes command timed out after 45000ms.",
            504,
            agent_id="content-planner",
            raw={"durationMs": 45001},
        )
        self.assertEqual(status, 504)
        self.assertEqual(body["agentId"], "content-planner")
        self.assertEqual(body["raw"]["durationMs"], 45001)


class AllowlistTests(unittest.TestCase):
    def test_allowed_agent_task_pairs(self) -> None:
        self.assertTrue(bridge.is_agent_task_allowed("content-planner", "content_planning"))
        self.assertTrue(bridge.is_agent_task_allowed("marketing-manager", "marketing_review"))
        self.assertTrue(bridge.is_agent_task_allowed("content-writer", "content_writing"))
        self.assertTrue(bridge.is_agent_task_allowed("qa-auditor", "qa_review"))

    def test_rejects_crossed_or_unknown_agent_task_pairs(self) -> None:
        self.assertFalse(bridge.is_agent_task_allowed("content-planner", "marketing_review"))
        self.assertFalse(bridge.is_agent_task_allowed("marketing-manager", "content_planning"))
        self.assertFalse(bridge.is_agent_task_allowed("content-writer", "qa_review"))
        self.assertFalse(bridge.is_agent_task_allowed("qa-auditor", "marketing_review"))
        self.assertFalse(bridge.is_agent_task_allowed("director", "approval"))
        self.assertFalse(bridge.is_agent_task_allowed("unknown", "content_planning"))


class RuntimeGuardrailTests(unittest.TestCase):
    def test_writer_timeout_is_longer_than_planner_timeout(self) -> None:
        self.assertGreaterEqual(bridge.timeout_for_agent("content-writer"), 120000)
        self.assertGreaterEqual(bridge.timeout_for_agent("qa-auditor"), 90000)
        self.assertGreaterEqual(bridge.timeout_for_agent("content-planner"), 60000)

    def test_memory_usage_is_bounded_when_available(self) -> None:
        usage = bridge.current_memory_usage_percent()
        if usage is not None:
            self.assertGreaterEqual(usage, 0)
            self.assertLessEqual(usage, 100)

    def test_telemetry_contains_only_nonsecret_run_metrics(self) -> None:
        telemetry = bridge.build_run_telemetry(
            agent_id="content-writer",
            duration_ms=1234,
            prompt_bytes=4567,
            output_bytes=2345,
            exit_code=0,
            timeout_limit_ms=120000,
            memory_usage_percent=42.5,
        )
        self.assertEqual(telemetry["agentId"], "content-writer")
        self.assertEqual(telemetry["timeoutLimitMs"], 120000)
        self.assertEqual(telemetry["memoryUsagePercentAtStart"], 42.5)
        self.assertNotIn("prompt", telemetry)
        self.assertNotIn("stdout", telemetry)
        self.assertNotIn("apiKey", telemetry)


class VerifiedSchedulePromptTests(unittest.TestCase):
    def test_next_week_writer_prompt_uses_natural_blog_editorial_contract(self) -> None:
        prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "다음 주 증시 일정",
                "title": "주요 일정",
                "channel": "blog",
                "language": "ko",
                "referenceBundle": {"contentType": "NEXT_WEEK_MARKET_PREVIEW"},
                "marketSnapshot": {
                    "upcoming": [{
                        "date": "2026-07-19",
                        "event": "FOMC Press Release",
                        "url": "https://www.federalreserve.gov/newsevents/calendar.htm",
                    }],
                },
            },
        })
        self.assertIn("개인 투자자가 운영하는 네이버 주식 블로그의 전문 에디터", prompt)
        self.assertIn('URL은 마지막 "함께 확인한 기사"', prompt)
        self.assertIn("공백 포함 2,000~3,200자", prompt)
        self.assertIn("2,300~2,900자를 목표", prompt)
        self.assertIn("실제 활용한 기사 3개만", prompt)
        self.assertNotIn('첫 번째 sections 항목의 heading은 반드시 "데이터 기준"', prompt)

    def test_non_preview_writer_keeps_immutable_schedule_policy(self) -> None:
        prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "한국 증시 장전 브리핑",
                "title": "장전 브리핑",
                "channel": "blog",
                "language": "ko",
                "referenceBundle": {"contentType": "KOREA_DAILY_PREVIEW"},
                "bodyStructure": [
                    "1. 30초 요약",
                    "2. 오늘 시장 핵심 숫자",
                    "3. 오늘의 핵심 변수 2가지",
                    "4. 상승·하락 조건별 시나리오",
                    "5. 오늘의 초보자 설명",
                    "6. 오늘 볼 것 3가지",
                    "7. BG Market Note 판단",
                    "함께 확인한 기사",
                ],
            },
        })
        self.assertIn("upcoming 날짜·이벤트명은 변경할 수 없는 원문 값", prompt)
        self.assertIn("하루 앞뒤로 옮기지 말고", prompt)
        self.assertIn("내용 있는 문단 블록을 10개 이상", prompt)
        self.assertIn('"- " 불릿은 최소 5개', prompt)
        self.assertIn("introduction 첫 3문장 안에서", prompt)
        self.assertIn("usedSeoKeywords는 같은 뜻을 반복하지 않는 구체 검색어 5~8개", prompt)
        self.assertIn('"- 판단:", "- 상방 조건:", "- 하방 조건:", "- 다음 확인:"', prompt)
        self.assertIn('"볼 것 3가지"는 정확히 세 줄', prompt)
        self.assertNotIn("개인 투자자 체크리스트는 4~6개", prompt)
        self.assertNotIn("독자가 댓글로 답하기 쉬운 구체 질문", prompt)
        self.assertIn("독자용 데이터 범위 고지이므로 삭제하거나", prompt)
        self.assertNotIn('첫 번째 sections 항목의 heading은 반드시 "데이터 기준"', prompt)

    def test_planner_and_marketing_prompts_enforce_search_intent_titles(self) -> None:
        payload = {
            "input": {
                "topic": "한국 증시 장전 브리핑",
                "title": "26/07/29 한국 증시 장전 브리핑",
                "channel": "blog",
                "language": "ko",
            },
        }
        planner_prompt = bridge.build_content_planner_prompt(payload)
        marketing_prompt = bridge.build_marketing_review_prompt(payload)

        self.assertIn("primary search intent", planner_prompt)
        self.assertIn("제목은 날짜로 시작하지 않는다", planner_prompt)
        self.assertIn("seoKeywords는 뜻이 겹치지 않는 구체 검색어 5~8개", planner_prompt)
        self.assertIn("recommendedTitle은 날짜가 아니라 핵심 검색어로 시작", marketing_prompt)
        self.assertIn('"7월 29일" 형식으로 제목 끝', marketing_prompt)
        self.assertIn("최근 발행 제목과 다른 검색 질문", marketing_prompt)

    def test_writer_schema_lists_every_required_section(self) -> None:
        headings = [
            "1. 최근 시장은 어땠을까",
            "2. 한국 증시 흐름과 전망",
            "3. 미국 증시와 글로벌 변수",
            "4. 금리·환율·핵심 일정",
            "5. 눈여겨볼 기회와 위험",
            "6. 개인 투자자가 확인할 것",
            "함께 확인한 기사",
        ]
        prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "한국 증시 장마감 브리핑",
                "title": "장마감 브리핑",
                "channel": "blog",
                "language": "ko",
                "referenceBundle": {"contentType": "KOREA_DAILY_CLOSE"},
                "bodyStructure": headings,
            },
        })

        for heading in headings:
            self.assertIn(f'"heading": "{heading}"', prompt)
        self.assertIn("sections 배열 길이는 정확히 7개", prompt)
        self.assertIn("지정 투자 유의문구는 cta에 정확히 한 번", prompt)
        self.assertIn("서로 다른 시장의 순매수를 한 문장으로 합쳐", prompt)
        self.assertIn("수급 금액은 원본 단위 환산 오류를 막기 위해", prompt)
        self.assertIn("한국투자증권·FRED 최근 거래일 자료 기준", prompt)
        self.assertIn('"6,516.27으로"가 아니라 "6,516.27로"', prompt)

    def test_daily_writer_reserves_room_for_server_injected_schedule(self) -> None:
        prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "오늘 코스피 전망",
                "title": "오늘 코스피 전망",
                "channel": "blog",
                "referenceBundle": {
                    "contentType": "KOREA_DAILY_PREVIEW",
                    "marketSnapshot": {
                        "upcoming": [{
                            "date": "2026-08-14",
                            "event": "Advance Monthly Sales for Retail and Food Services",
                            "market": "US",
                            "url": "https://example.com/schedule",
                        }],
                    },
                },
                "bodyStructure": ["1. 30초 요약", "5. 오늘의 초보자 설명", "함께 확인한 기사"],
            },
        })

        self.assertIn("공백 포함 1,800~2,300자", prompt)
        self.assertIn("1,900~2,100자를 목표", prompt)
        self.assertIn("한 개념, 한 문단, 문장부호로 끝나는 정확히 4문장", prompt)

    def test_investment_study_uses_weekly_length_policy_in_writer_and_qa(self) -> None:
        input_data = {
            "topic": "코스피 대형주 쏠림장",
            "title": "코스피는 오르는데 내 종목은 왜 안 오를까?",
            "channel": "blog",
            "referenceBundle": {"contentType": "INVESTMENT_STUDY"},
            "qualityGateDiagnostics": {
                "editorialPolicyVersion": 7,
                "requiredEditorialQualityScore": 95,
            },
        }

        writer_prompt = bridge.build_content_writer_prompt({"input": input_data})
        qa_prompt = bridge.build_qa_audit_prompt({"input": input_data})

        self.assertIn("공백 포함 2,000~3,200자", writer_prompt)
        self.assertIn("공백 포함 2,000~3,200자", qa_prompt)

    def test_qa_prompt_receives_server_schedule_validation(self) -> None:
        prompt = bridge.build_qa_audit_prompt({
            "input": {
                "topic": "다음 주 증시 일정",
                "title": "주요 일정",
                "channel": "blog",
                "language": "ko",
                "referenceBundle": {"contentType": "NEXT_WEEK_MARKET_PREVIEW"},
                "writerResult": {
                    "fullDraft": "검증된 주요 일정",
                    "verifiedSchedule": {"immutable": True, "events": []},
                    "scheduleValidation": {"ok": True, "checkedEventCount": 1, "issues": []},
                },
            },
        })
        self.assertIn('"scheduleValidation"', prompt)
        self.assertIn("URL을 공개 본문에 쓰라고 요구하지 않는다", prompt)
        self.assertIn("실제 활용한 신뢰 가능한 기사 정확히 3개", prompt)
        self.assertIn("지정된 투자 유의 문구가 cta에 정확히 한 번", prompt)
        self.assertIn("finalTitle이 날짜나 포괄적인", prompt)
        self.assertIn("usedSeoKeywords가 중복 없는 5~8개", prompt)
        self.assertIn("내부 수집·분석 과정 노출로 판정하거나 삭제를 요구하지 않는다", prompt)
        self.assertIn("참여 유도 문구가 없는지", prompt)

    def test_benchmark_guidelines_and_ninety_point_target_are_enforced(self) -> None:
        guidelines = ["본문은 소제목 6개 이상으로 구성합니다."]
        writer_prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "다음 주 증시 일정",
                "title": "주요 일정",
                "channel": "blog",
                "referenceBundle": {"contentType": "NEXT_WEEK_MARKET_PREVIEW"},
                "editorialBenchmarkGuidelines": guidelines,
            },
        })
        qa_prompt = bridge.build_qa_audit_prompt({
            "input": {
                "topic": "다음 주 증시 일정",
                "title": "주요 일정",
                "channel": "blog",
                "referenceBundle": {"contentType": "NEXT_WEEK_MARKET_PREVIEW"},
                "editorialBenchmarkGuidelines": guidelines,
                "qualityGateDiagnostics": {
                    "editorialPolicyVersion": 2,
                    "requiredEditorialQualityScore": 95,
                    "requiredChecklistItemCount": 3,
                },
            },
        })

        self.assertIn("소제목 6개 이상", writer_prompt)
        self.assertIn("required editorial quality score: 95/100", qa_prompt)
        self.assertIn("qaScore가 95점 미만이면", qa_prompt)
        self.assertIn("requiredRevisions가 비어 있고", qa_prompt)
        self.assertIn('"qaScore": 97', qa_prompt)
        self.assertIn("확인 항목이 정확히 3개", qa_prompt)
        self.assertNotIn("체크리스트가 4~6개", qa_prompt)
        self.assertIn("provider가 kis-fred", qa_prompt)


class UsageGuardrailContractTests(unittest.TestCase):
    def test_content_pipeline_reserves_up_to_eight_real_hermes_runs(self) -> None:
        service_source = (REPO_ROOT / "apps/web/src/lib/content-pipeline/content-pipeline-service.ts").read_text()
        self.assertIn("const HERMES_PIPELINE_REQUIRED_RUNS = STOCK_BLOG_MAX_HERMES_RUNS", service_source)
        self.assertIn('if (runnerMode === "hermes") await assertHermesDailyRunAvailable(HERMES_PIPELINE_REQUIRED_RUNS);', service_source)

    def test_writer_revision_prompt_contains_previous_draft_and_qa_feedback(self) -> None:
        prompt = bridge.build_content_writer_prompt({
            "input": {
                "topic": "Korea market preview",
                "title": "Morning preview",
                "channel": "blog",
                "revisionAttempt": 2,
                "previousWriterResult": {
                    "finalTitle": "Previous title",
                    "sections": [{"heading": "Market", "body": "US indices were mixed."}],
                },
                "qaRevisionFeedback": {
                    "qaScore": 88,
                    "requiredRevisions": ["Correct the US index direction."],
                },
            },
        })
        self.assertIn("automatic revision attempt: 2/3", prompt)
        self.assertIn("Previous title", prompt)
        self.assertIn("Correct the US index direction.", prompt)
        self.assertIn("previous writer result", prompt)
        self.assertIn("QA revision feedback", prompt)

    def test_usage_summary_counts_only_real_hermes_agent_runs(self) -> None:
        usage_source = (REPO_ROOT / "apps/web/src/lib/hermes/hermes-usage.ts").read_text()
        self.assertIn('mode: "hermes"', usage_source)
        self.assertIn('triggerSource: "content-pipeline"', usage_source)
        self.assertNotIn('mode: "hermes-dry-run"', usage_source)


class OperationalLearningPromptTests(unittest.TestCase):
    def test_approved_lesson_is_injected_as_a_safety_constraint(self) -> None:
        payload = {
            "input": {
                "topic": "오늘 코스피 전망",
                "title": "오늘 코스피 전망",
                "channel": "blog",
                "approvedLessons": [{
                    "lessonId": "lesson-1",
                    "fingerprint": "stock-blog:quality-gate:editorial-quality-gate-blocked",
                    "title": "품질 게이트 반복 차단 개선",
                    "instruction": "품질 게이트를 완화하지 말고 차단 사유를 구조화한다.",
                    "policyVersion": "learning-policy-v1",
                }],
            },
        }

        for prompt_builder in (
            bridge.build_content_planner_prompt,
            bridge.build_marketing_review_prompt,
            bridge.build_content_writer_prompt,
            bridge.build_qa_audit_prompt,
        ):
            prompt = prompt_builder(payload)
            self.assertIn("stock-blog:quality-gate:editorial-quality-gate-blocked", prompt)
            self.assertIn("품질 게이트를 완화하지 말고", prompt)
            self.assertIn("교훈을 시장 사실이나 새로운 출처로 취급하지 않는다", prompt)
            self.assertIn("하드 안전 규칙을 우선", prompt)

    def test_only_five_approved_lessons_are_compacted(self) -> None:
        lessons = [
            {"lessonId": f"lesson-{index}", "fingerprint": f"a:b:{index}", "instruction": f"rule-{index}"}
            for index in range(7)
        ]
        compacted = bridge.compact_approved_lessons({"approvedLessons": lessons})
        self.assertEqual(len(compacted), 5)
        self.assertEqual(compacted[-1]["lessonId"], "lesson-4")


if __name__ == "__main__":
    unittest.main()
