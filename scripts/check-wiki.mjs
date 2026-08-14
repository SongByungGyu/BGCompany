import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const wikiRoot = path.join(repositoryRoot, "docs", "wiki");

const lessonFields = [
  "id",
  "title",
  "status",
  "severity",
  "area",
  "first_seen",
  "last_seen",
  "owner",
  "fingerprint",
  "policy_version",
  "regression_test",
  "recurrence_count",
];
const lessonSections = ["현상", "영향", "근본 원인", "즉시 복구", "예방 규칙", "검증", "재발 기록", "관련 자료"];
const decisionFields = ["id", "title", "status", "date", "owner", "decision"];
const decisionSections = ["배경", "결정", "결과", "후속 작업"];
const allowedLessonStatuses = new Set(["observed", "contained", "prevented", "verified", "archived"]);
const allowedDecisionStatuses = new Set(["proposed", "accepted", "superseded", "rejected"]);
const errors = [];

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

function parseFrontMatter(filePath, source) {
  if (!source.startsWith("---\n")) {
    errors.push(`${relative(filePath)}: YAML front matter가 없습니다.`);
    return {};
  }
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) {
    errors.push(`${relative(filePath)}: YAML front matter가 닫히지 않았습니다.`);
    return {};
  }
  return Object.fromEntries(
    source.slice(4, end).split("\n").flatMap((line) => {
      const match = line.match(/^([a-z_]+):\s*(.+)$/);
      return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
    }),
  );
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function requireFields(filePath, metadata, fields) {
  for (const field of fields) {
    if (!metadata[field]) errors.push(`${relative(filePath)}: '${field}' 값이 필요합니다.`);
  }
}

function requireSections(filePath, source, sections) {
  for (const section of sections) {
    if (!source.includes(`## ${section}`)) errors.push(`${relative(filePath)}: '## ${section}' 섹션이 필요합니다.`);
  }
}

function validateLinks(filePath, source) {
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) errors.push(`${relative(filePath)}: 깨진 링크 '${match[1]}'`);
  }
}

if (!fs.existsSync(wikiRoot)) {
  console.error("docs/wiki 디렉터리가 없습니다.");
  process.exit(1);
}

const allWikiFiles = markdownFiles(wikiRoot);
const lessonFiles = markdownFiles(path.join(wikiRoot, "lessons")).filter((file) => path.basename(file) !== "README.md");
const decisionFiles = markdownFiles(path.join(wikiRoot, "decisions")).filter((file) => path.basename(file) !== "README.md");
const fingerprints = new Map();
const decisionIds = new Set();

for (const filePath of lessonFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  const metadata = parseFrontMatter(filePath, source);
  requireFields(filePath, metadata, lessonFields);
  requireSections(filePath, source, lessonSections);
  if (metadata.status && !allowedLessonStatuses.has(metadata.status)) {
    errors.push(`${relative(filePath)}: 알 수 없는 lesson status '${metadata.status}'`);
  }
  if (metadata.recurrence_count && !/^\d+$/.test(metadata.recurrence_count)) {
    errors.push(`${relative(filePath)}: recurrence_count는 0 이상의 정수여야 합니다.`);
  }
  if (metadata.fingerprint) {
    const previous = fingerprints.get(metadata.fingerprint);
    if (previous) errors.push(`${relative(filePath)}: fingerprint가 ${previous}와 중복됩니다.`);
    fingerprints.set(metadata.fingerprint, relative(filePath));
  }
}

for (const filePath of decisionFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  const metadata = parseFrontMatter(filePath, source);
  requireFields(filePath, metadata, decisionFields);
  requireSections(filePath, source, decisionSections);
  if (metadata.status && !allowedDecisionStatuses.has(metadata.status)) {
    errors.push(`${relative(filePath)}: 알 수 없는 decision status '${metadata.status}'`);
  }
  if (metadata.id && decisionIds.has(metadata.id)) errors.push(`${relative(filePath)}: decision id '${metadata.id}'가 중복됩니다.`);
  if (metadata.id) decisionIds.add(metadata.id);
}

for (const filePath of allWikiFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  if (!filePath.includes(`${path.sep}templates${path.sep}`)) validateLinks(filePath, source);
  if (/sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}/i.test(source)) {
    errors.push(`${relative(filePath)}: 비밀정보로 보이는 문자열이 있습니다.`);
  }
}

if (errors.length > 0) {
  console.error(`Wiki validation failed (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Wiki validation passed: ${lessonFiles.length} lesson(s), ${decisionFiles.length} decision(s), ${allWikiFiles.length} page(s).`);
