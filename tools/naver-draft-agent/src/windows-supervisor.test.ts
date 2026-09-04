import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readWindowsScript(name: string) {
  return readFileSync(fileURLToPath(new URL(`../windows/${name}`, import.meta.url)), "utf8");
}

test("Windows supervisor keeps native stderr separate and writes a heartbeat", () => {
  const script = readWindowsScript("start-agent.ps1");

  assert.match(script, /Start-Process/);
  assert.match(script, /-RedirectStandardOutput/);
  assert.match(script, /-RedirectStandardError/);
  assert.match(script, /naver-draft-agent-heartbeat\.json/);
  assert.match(script, /NAVER_AGENT_SINGLETON_PORT/);
  assert.match(script, /BGCompany\.NaverDraftAgent/);
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

test("Windows runtime drift audit verifies the complete manifest and local tsx runtime", () => {
  const script = readWindowsScript("audit-runtime-drift.ps1");

  assert.match(script, /runtime-manifest\.json/);
  assert.match(script, /Get-FileHash/);
  assert.match(script, /Runtime SHA mismatch/);
  assert.match(script, /node_modules\\\.bin\\tsx\.cmd/);
  assert.match(script, /node_modules\/playwright\/package\.json/);
  assert.match(script, /Runtime aggregate SHA mismatch/);
});

test("reviewed installer refuses to interrupt publishing and scopes process cleanup", () => {
  const script = readWindowsScript("install-reviewed-agent.ps1");
  assert.match(script, /\$state\.publishing -eq \$true/);
  assert.match(script, /Heartbeat AgentRoot mismatch/);
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /CreationDate/);
  assert.match(script, /ConfirmLegacyNoPublishing/);
  assert.match(script, /"\.git"/);
  assert.match(script, /Recoverable backup retained/);
});

test("environment ACL hardening targets only exact env and env backup names", () => {
  const script = readWindowsScript("protect-env-acl.ps1");
  assert.match(script, /\^\\\.env/);
  assert.match(script, /Refusing ACL change outside AgentRoot/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
});

