#!/usr/bin/env node

const BASE_URL = process.env.BG_COMPANY_BASE_URL ?? "http://localhost:3000";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

const command = process.argv[2];
const employeeId = process.argv[3];
const value = process.argv[4];

function usage() {
  console.log(`Usage:
  node scripts/send-agent-event.mjs employee-status <employeeId> <status>
  node scripts/send-agent-event.mjs error <employeeId> [taskId]
  node scripts/send-agent-event.mjs output <employeeId> [taskId]

Examples:
  node scripts/send-agent-event.mjs employee-status content-planner "회의 중"
  node scripts/send-agent-event.mjs error developer
  node scripts/send-agent-event.mjs output content-planner task-content-draft

Environment:
  BG_COMPANY_BASE_URL=http://localhost:3000
  AGENT_API_KEY=dev-secret`);
}

function buildEvent() {
  if (command === "employee-status") {
    if (!employeeId || !value) throw new Error("employee-status requires <employeeId> and <status>");
    return {
      source: "manual",
      eventType: "EmployeeStatusChanged",
      employeeId,
      payload: {
        status: value,
        summary: `Manual status change: ${employeeId} → ${value}`,
      },
    };
  }

  if (command === "error") {
    if (!employeeId) throw new Error("error requires <employeeId>");
    return {
      source: "manual",
      eventType: "ErrorOccurred",
      employeeId,
      taskId: value ?? "task-dev-pipeline",
      payload: {
        summary: `Manual error event for ${employeeId}`,
        error: "Manual agent event test error",
      },
    };
  }

  if (command === "output") {
    if (!employeeId) throw new Error("output requires <employeeId>");
    return {
      source: "manual",
      eventType: "OutputGenerated",
      employeeId,
      taskId: value ?? "task-content-draft",
      payload: {
        summary: `Manual output event for ${employeeId}`,
        outputTitle: "Manual agent event output",
      },
    };
  }

  throw new Error(`Unknown command: ${command ?? "(empty)"}`);
}

async function main() {
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

  if (!AGENT_API_KEY) {
    throw new Error("AGENT_API_KEY is required for POST /api/agent-events");
  }

  const body = buildEvent();
  const response = await fetch(`${BASE_URL}/api/agent-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bg-agent-key": AGENT_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(`POST /api/agent-events failed: ${response.status}`);
    console.error(data);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  usage();
  process.exit(1);
});
