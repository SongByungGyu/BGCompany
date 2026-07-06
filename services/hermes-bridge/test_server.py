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
            "markdownDraft": "# BG Company 구축기",
            "usedSeoKeywords": ["AI 개인회사", "Hermes"],
            "writingNotes": ["과장 표현 없음"],
        }, ensure_ascii=False)
        result = bridge.normalize_success(stdout, "", 1500, "content-writer")
        self.assertTrue(result["ok"])
        self.assertEqual(result["agentId"], "content-writer")
        self.assertEqual(result["finalTitle"], "BG Company 구축기")
        self.assertEqual(result["sections"][0], {"heading": "시작", "body": "본문입니다."})
        self.assertEqual(result["sections"][1], {"heading": "Section 2", "body": "문자열 섹션"})
        self.assertEqual(result["markdownDraft"], "# BG Company 구축기")
        self.assertEqual(result["usedSeoKeywords"], ["AI 개인회사", "Hermes"])
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


class UsageGuardrailContractTests(unittest.TestCase):
    def test_content_pipeline_requires_four_real_hermes_runs(self) -> None:
        service_source = (REPO_ROOT / "apps/web/src/lib/content-pipeline/content-pipeline-service.ts").read_text()
        self.assertIn("const HERMES_PIPELINE_REQUIRED_RUNS = 4", service_source)
        self.assertIn('if (runnerMode === "hermes") await assertHermesDailyRunAvailable(HERMES_PIPELINE_REQUIRED_RUNS);', service_source)

    def test_usage_summary_counts_only_real_hermes_agent_runs(self) -> None:
        usage_source = (REPO_ROOT / "apps/web/src/lib/hermes/hermes-usage.ts").read_text()
        self.assertIn('mode: "hermes"', usage_source)
        self.assertIn('triggerSource: "content-pipeline"', usage_source)
        self.assertNotIn('mode: "hermes-dry-run"', usage_source)


if __name__ == "__main__":
    unittest.main()
