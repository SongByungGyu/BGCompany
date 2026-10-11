import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bg_v2_audit",Path(__file__).with_name("bg-v2-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditSafetyTests(unittest.TestCase):
    def test_cron_records_schedule_and_digest_without_embedded_key(self):
        jobs = audit.cron_metadata('*/10 * * * * AGENT_API_KEY=private-value run-stock-blog-scheduler-tick.sh')
        self.assertEqual(jobs["known_jobs"][0]["schedule"],'*/10 * * * *')
        self.assertNotIn('private-value',str(jobs))

    def test_environment_assignments_and_unknown_commands_are_not_printed(self):
        jobs = audit.cron_metadata('KEY=private-stock-blog-scheduler\n* * * * * unknown private-value')
        self.assertEqual(jobs["known_jobs"],[])
        self.assertEqual(jobs["other_lines_count"],2)
        self.assertNotIn('private-value',str(jobs))

    def test_failed_commands_do_not_expose_stderr_or_stdout(self):
        with patch.object(audit.shutil,'which',return_value='/bin/tool'),patch.object(audit.subprocess,'run',
            return_value=subprocess.CompletedProcess(['tool'],1,stdout='private-stdout',stderr='private-stderr')):
            result = audit.run(['tool'])
        self.assertEqual(result,{"verified":False,"reason":"command_failed","exit_code":1})


if __name__ == '__main__':
    unittest.main()
