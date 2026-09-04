import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readWindowsScript(name: string) {
  return readFileSync(fileURLToPath(new URL(`../windows/${name}`, import.meta.url)), "utf8");
}

test("Windows supervisor runs the reviewed absolute Node worker and continuously verifies its listener", () => {
  const script = readWindowsScript("start-agent.ps1");

  assert.match(script, /Start-Process/);
  assert.match(script, /-FilePath \$nodeExecutable/);
  assert.match(script, /\$agentEntry/);
  assert.match(script, /-RedirectStandardOutput/);
  assert.match(script, /-RedirectStandardError/);
  assert.match(script, /naver-draft-agent-heartbeat\.json/);
  assert.match(script, /NAVER_AGENT_SINGLETON_PORT/);
  assert.match(script, /Global\\BGCompany\.NaverDraftAgent/);
  assert.match(script, /AbandonedMutexException/);
  assert.match(script, /agentRoot = \$resolvedAgentRoot/);
  assert.match(script, /buildSha = \$agentBuildSha/);
  assert.match(script, /Heartbeat write warning/);
  assert.match(script, /Get-SingletonListenerState/);
  assert.match(script, /CommandLine/);
  assert.match(script, /singleton_port_conflict/);
  assert.match(script, /while \(-not \$agentProcess\.HasExited\)/);
  assert.doesNotMatch(script, /2>&1\s*\|/);
  assert.doesNotMatch(script, /\*>>/);
});

test("Windows startup task has logon and daily recovery triggers without duplicate supervisors", () => {
  const script = readWindowsScript("register-startup-task.ps1");

  assert.match(script, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(script, /New-ScheduledTaskTrigger -Daily -At "06:00"/);
  assert.match(script, /-StartWhenAvailable/);
  assert.match(script, /-WakeToRun/);
  assert.match(script, /-MultipleInstances IgnoreNew/);
  assert.match(script, /\[switch\]\$ValidateOnly/);
  assert.match(script, /audit-runtime-drift\.ps1/);
  assert.ok(
    script.indexOf("if ($ValidateOnly)") < script.indexOf("New-ScheduledTaskAction"),
    "validation-only mode must return before accessing or mutating Task Scheduler",
  );
});

test("Windows runtime drift audit verifies the complete manifest and exact Node runtime", () => {
  const script = readWindowsScript("audit-runtime-drift.ps1");

  assert.match(script, /runtime-manifest\.json/);
  assert.match(script, /schemaVersion -ne 2/);
  assert.match(script, /Get-FileHash/);
  assert.match(script, /Runtime SHA mismatch/);
  assert.match(script, /manifest\.nodeExecutable/);
  assert.match(script, /nodeExecutableSha256/);
  assert.match(script, /node_modules\\\.bin\\tsx\.cmd/);
  assert.match(script, /node_modules\/playwright\/package\.json/);
  assert.match(script, /Runtime aggregate SHA mismatch/);
});

test("reviewed installer quiesces, verifies the database, captures exact processes, and fully rolls back", () => {
  const script = readWindowsScript("install-reviewed-agent.ps1");
  assert.match(script, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$InstallRoot/);
  assert.match(script, /runtime-status/);
  assert.match(script, /publishingCount -ne 0/);
  assert.match(script, /activeAgentJobCount -ne 0/);
  assert.match(script, /deployment_hold/);
  assert.match(script, /Wait-ForDeploymentHold/);
  assert.match(script, /Assert-FreshIdentityRecord/);
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /CreationStamp/);
  assert.match(script, /Test-SameProcessInstance/);
  assert.match(script, /ConfirmLegacyNoPublishing/);
  assert.match(script, /Wait-ForReviewedAgentHealth/);
  assert.match(script, /NodeExecutable/);
  assert.match(script, /RuntimeSha256/);
  assert.match(script, /"\.git"/);
  assert.match(script, /Export-ScheduledTask/);
  assert.match(script, /Register-ScheduledTask -TaskName \$TaskName -Xml \$taskXml/);
  assert.match(script, /\.failed-/);
  assert.match(script, /ACL-protected recoverable backup retained/);
  assert.ok(
    script.indexOf("$captured = @(Get-CapturedAgentProcesses") <
      script.indexOf("Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop"),
    "exact process instances must be captured before the task is stopped",
  );
  assert.match(script, /A live agent is not owned by the running managed task/);
  assert.match(script, /A live agent appeared outside the running managed task during preflight/);
  assert.ok(
    script.indexOf("& $sourceAcl -AgentRoot $backup") <
      script.indexOf("Remove-Item -LiteralPath $activeHold -Force"),
    "the active deployment hold must be the final fallible commit operation",
  );
  assert.ok(
    script.indexOf("Set-DeploymentHold -Path $rollbackHold") <
      script.indexOf("Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue"),
    "rollback must restore the deployment hold before stopping the active worker",
  );
  assert.ok(
    script.indexOf("& $sourceAcl -AgentRoot $installFull", script.indexOf("} catch {")) <
      script.indexOf("Remove-Item -LiteralPath $restoredHold -Force"),
    "rollback must harden the restored runtime before releasing its temporary hold",
  );
  assert.match(script, /\$rollbackErrors\.Count -eq 0-and|\$rollbackErrors\.Count -eq 0/);
});

test("environment ACL hardening protects the complete runtime including profile and backups", () => {
  const script = readWindowsScript("protect-env-acl.ps1");
  assert.match(script, /Refusing ACL change outside AgentRoot/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /Get-ChildItem -LiteralPath \$resolvedAgentRoot -Force -Recurse/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /S-1-5-18/);
  assert.match(script, /S-1-5-32-544/);
  assert.doesNotMatch(script, /Authenticated Users/);
});
