import json
import unittest
import server


class DegradedContextTests(unittest.TestCase):
    def snapshot(self):
        return {
            "status": "ready", "provider": "kis-fred", "dataQuality": "partial",
            "degradedMode": "kis_sector_unavailable", "degradedProviders": ["kis-sector"],
            "degradedReason": "국내 강세/약세 업종", "missingItems": ["국내 강세/약세 업종"],
            "disclosures": ["업종 자료 범위 고지"], "apiKey": "must-not-leak",
        }

    def test_compactor_keeps_availability_but_not_unknown_fields(self):
        snapshot = self.snapshot()
        for input_data in [{"marketSnapshot": snapshot}, {"referenceBundle": {"marketSnapshot": snapshot}}]:
            compact = server.compact_market_snapshot(input_data)
            for key in ["degradedMode", "degradedProviders", "degradedReason", "missingItems", "disclosures"]:
                self.assertEqual(compact[key], snapshot[key])
            self.assertNotIn("apiKey", compact)

    def test_actual_writer_and_qa_prompts_both_keep_sector_flag(self):
        payload = {"input": {"marketSnapshot": self.snapshot(), "editorialPolicyVersion": 8,
                   "qualityGateDiagnostics": {"editorialPolicyVersion": 8, "requiredEditorialQualityScore": 95}}}
        for prompt in [server.build_content_writer_prompt(payload), server.build_qa_audit_prompt(payload)]:
            self.assertRegex(prompt, r'"degradedMode"\s*:\s*"kis_sector_unavailable"')
            self.assertRegex(prompt, r'"degradedProviders"\s*:\s*\[\s*"kis-sector"')
            self.assertIn('"missingItems"', prompt)
            self.assertNotIn("must-not-leak", prompt)

    def test_multiple_degradations_are_not_reduced_to_one(self):
        snapshot = self.snapshot()
        snapshot.update(degradedMode="fred_unavailable", degradedProviders=["fred", "kis-sector"])
        compact = server.compact_market_snapshot({"marketSnapshot": snapshot})
        self.assertEqual(compact["degradedProviders"], ["fred", "kis-sector"])
        prompt = server.build_qa_audit_prompt({"input": {"marketSnapshot": snapshot}})
        self.assertIn("degradedProviders에 kis-sector", prompt)

    def test_absent_degradation_is_not_invented(self):
        compact = server.compact_market_snapshot({"marketSnapshot": {"status": "ready", "dataQuality": "verified"}})
        self.assertNotIn("degradedMode", compact)
        self.assertNotIn("degradedProviders", compact)


if __name__ == "__main__":
    unittest.main()
