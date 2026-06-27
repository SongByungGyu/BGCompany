import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentMetadata } from "./agent-registry";
import type { AgentRoleDocument } from "./agent-context-types";

type Frontmatter = Record<string, string | string[]>;

function agentsDirectory() {
  const candidates = [
    resolve(process.cwd(), "agents"),
    resolve(process.cwd(), "../..", "agents"),
    resolve(process.cwd(), "..", "agents"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("agents directory not found");
  return found;
}

function parseFrontmatter(markdown: string) {
  if (!markdown.startsWith("---")) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: markdown };
  const raw = markdown.slice(3, end).trim().split("\n");
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;
  for (const line of raw) {
    if (line.trim().startsWith("- ") && currentKey) {
      const current = frontmatter[currentKey];
      const list = Array.isArray(current) ? current : [];
      list.push(line.trim().slice(2).trim());
      frontmatter[currentKey] = list;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    currentKey = key;
    frontmatter[key] = value.trim() ? value.trim() : [];
  }
  return { frontmatter, body: markdown.slice(end + 4).trim() };
}

function listValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringValue(value: string | string[] | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function section(body: string, title: string) {
  const pattern = new RegExp(`^# ${title}\\s*\\n([\\s\\S]*?)(?=^# |\\z)`, "m");
  const match = body.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function sectionList(body: string, title: string) {
  return section(body, title)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function loadAgentRoleDocument(agentId: string): AgentRoleDocument {
  const registry = getAgentMetadata(agentId);
  if (!registry) throw new Error(`agent is not registered: ${agentId}`);
  const filePath = join(agentsDirectory(), `${agentId}.md`);
  if (!existsSync(filePath)) throw new Error(`agent role document not found: ${agentId}`);
  const markdown = readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(markdown);
  const roleSummary = section(body, "역할");
  const approvalConditions = sectionList(body, "승인 필요 조건");
  const outputFormat = section(body, "결과물 형식");
  const reportingRules = section(body, "보고 규칙");
  return {
    agentId: stringValue(frontmatter.agent_id, registry.agentId),
    displayName: stringValue(frontmatter.display_name, registry.displayName),
    department: stringValue(frontmatter.department, registry.department),
    defaultSeat: stringValue(frontmatter.default_seat, registry.defaultSeat),
    manager: stringValue(frontmatter.manager),
    allowedEvents: listValue(frontmatter.allowed_events).length > 0 ? listValue(frontmatter.allowed_events) : registry.allowedEvents,
    forbiddenActions: listValue(frontmatter.forbidden_actions),
    roleDocument: body,
    roleSummary,
    approvalConditions,
    outputFormat,
    reportingRules,
  };
}
