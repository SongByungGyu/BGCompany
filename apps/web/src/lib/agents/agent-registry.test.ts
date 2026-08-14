import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { agentRegistry } from "./agent-registry.ts";

const agentsDirectory = path.resolve(process.cwd(), "../..", "agents");

test("core agent registry includes every production content role and an explicit execution mode", () => {
  for (const agentId of ["stock-monitor", "content-planner", "marketing-manager", "content-writer", "qa-auditor", "director"]) {
    const agent = agentRegistry[agentId];
    assert.ok(agent, `${agentId} must be registered`);
    assert.ok(agent.execution.defaultMode, `${agentId} must declare a default execution mode`);
    assert.ok(agent.execution.availableModes.includes(agent.execution.defaultMode));
  }
  assert.equal(agentRegistry.developer.displayName, "하늘");
  assert.equal(agentRegistry["content-writer"].displayName, "지아");
});

test("every registered agent has a matching role document", () => {
  for (const agent of Object.values(agentRegistry)) {
    const rolePath = path.join(agentsDirectory, `${agent.agentId}.md`);
    assert.equal(existsSync(rolePath), true, `${agent.agentId} role document is missing`);
    const role = readFileSync(rolePath, "utf8");
    assert.match(role, new RegExp(`agent_id:\\s*${agent.agentId}`));
    assert.ok(role.includes(`display_name: ${agent.displayName}`), `${agent.agentId} display_name drifted`);
  }
});
