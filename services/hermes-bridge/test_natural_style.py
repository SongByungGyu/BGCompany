import unittest
import server


class NaturalStylePromptTests(unittest.TestCase):
    def test_writer_has_no_fixed_headings_or_bullet_floor(self):
        prompt = server.build_content_writer_prompt({"input": {
            "editorialPolicyVersion": 8,
            "bodyStructure": ["내용에 맞는 제목", "함께 확인한 기사"],
            "referenceBundle": {"contentType": "KOREA_DAILY_PREVIEW"},
        }})
        self.assertIn("소제목은 내용에 맞게 2~5개", prompt)
        self.assertNotIn("heading을 한 글자도 바꾸지", prompt)
        self.assertNotIn('불릿은 최소 5개', prompt)
        self.assertNotIn('정확히 4문장이어야', prompt)
        self.assertIn('투자 판단과 책임', prompt)

    def test_qa_accepts_topic_headings_and_keeps_quality_target(self):
        prompt = server.build_qa_audit_prompt({"input": {
            "qualityGateDiagnostics": {"editorialPolicyVersion": 8, "requiredEditorialQualityScore": 95},
        }})
        self.assertIn('의미 반복·문단 리듬·번역투', prompt)
        self.assertNotIn('section heading 6개 이상', prompt)
        self.assertNotIn('번호가 붙은 "BG Market Note 판단" 섹션이 있는지', prompt)
        self.assertIn('95점 이상', prompt)


if __name__ == '__main__':
    unittest.main()
