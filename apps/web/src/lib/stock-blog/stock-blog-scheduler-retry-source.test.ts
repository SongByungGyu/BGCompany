import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("./stock-blog-scheduler.ts", import.meta.url);
const pipelineSourceUrl = new URL("../content-pipeline/content-pipeline-service.ts", import.meta.url);
const naverDraftSourceUrl = new URL("../naver-drafts/naver-draft-jobs.ts", import.meta.url);
const naverAgentSourceUrl = new URL("../../../../../tools/naver-draft-agent/src/index.ts", import.meta.url);
const naverWriterSourceUrl = new URL("../../../../../tools/naver-draft-agent/src/naver-writer.ts", import.meta.url);

test("단계 실행권은 외부 호출 전에 timestamp CAS로 먼저 저장한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const claimStart = source.indexOf("async function claimSchedulerPhase");
  const cas = source.indexOf("where: { id, timestamp: current.timestamp }", claimStart);
  const referenceCall = source.indexOf("await collectStockBlogReferences", cas);
  const generationCall = source.indexOf("await startContentPipelineFromTrustedInput", cas);
  assert.ok(claimStart >= 0);
  assert.ok(cas > claimStart);
  assert.ok(referenceCall > cas);
  assert.ok(generationCall > cas);
  assert.match(source.slice(claimStart, referenceCall), /eventLog\.create/);
  assert.match(source.slice(claimStart, referenceCall), /isPrismaUniqueConflict/);
});

test("상태 기록도 CAS로 병합해 더 최신 lease와 checkpoint를 덮어쓰지 않는다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const writeStart = source.indexOf("async function persistSchedulerEvent");
  const writeEnd = source.indexOf("function eventPayload", writeStart);
  const implementation = source.slice(writeStart, writeEnd);
  assert.match(implementation, /where: \{ id, timestamp: previous\.timestamp \}/);
  assert.match(implementation, /previousPayload\.retryV2/);
  assert.match(implementation, /previousPayload\.retryCheckpoint/);
  assert.match(implementation, /JSON\.stringify\(currentRetry\.state\) !== JSON\.stringify\(input\.expectedRetryV2\)/);
  assert.doesNotMatch(implementation, /eventLog\.upsert/);
});

test("논리 일정키 전환 중에도 예전 UTC·로컬 시간키와 발행키를 함께 조회한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /buildStockBlogLogicalScheduleKey\(definition\.scheduleId, marketDate\)/);
  assert.match(source, /legacySchedulerEventIds\(definition, marketDate, config\.timezone\)/);
  assert.match(source, /publishKey: \{ in: \[publishKey, \.\.\.publishKeyAliases\] \}/);
});

test("중단 뒤에는 같은 operational attempt의 완성된 파이프라인을 먼저 찾는다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const pipelineSource = await readFile(pipelineSourceUrl, "utf8");
  const naverDraftSource = await readFile(naverDraftSourceUrl, "utf8");
  assert.match(source, /findContentPipelineByOperationalAttempt\(runKey, retryV2\.lease\.attempt\)/);
  assert.match(source, /findContentPipelineByOperationalAttempt\(legacyOperationalRunKey, legacyOperationalAttempt\)/);
  assert.match(source, /findContentPipelineByOperationalAttempt\(key, generationClaim\.attempt\)/);
  assert.match(source, /operationalAttempt: generationClaim\.attempt/);
  assert.match(pipelineSource, /operationalRunKey: data\.operationalRunKey/);
  assert.match(pipelineSource, /path: \["operationalRunKey"\], equals: runKey/);
  assert.match(pipelineSource, /path: \["operationalAttempt"\], equals: attempt/);
  assert.match(naverDraftSource, /where: \{ contentPipelineId: detail\.pipeline\.id, status: \{ in: activeStatuses \} \}/);
});

test("생성 checkpoint는 같은 실행에서 조립으로 이어지고 두 조립 경로 모두 예전 발행키를 인식한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const aliasPasses = source.match(/publishKeyAliases: config\.autoPublish && !holidaySearchReplacement && !dataFailureStudyFallback \? publishKeyAliases : \[\]/g) ?? [];
  assert.equal(aliasPasses.length, 2);
  assert.doesNotMatch(source, /STOCK_RETRY_V2_DRAFT_RESUME_REQUIRED/);
  assert.match(source, /generationClaim\.action === "completed"[\s\S]{0,300}return resumeDraftAssembly/);
  assert.match(source, /phase: "draft_assembly",[\s\S]{0,150}seedState: logicalExisting \? undefined : retryV2/);
  assert.match(source, /NAVER_DRAFT_DUPLICATE_CONTENT_BLOCKED:/);
  assert.match(source, /settleActivePhase\(false, !regenerateContent, regenerateContent && !needsReferenceRefresh, needsReferenceRefresh\)/);
});

test("checkpoint가 사라진 참고자료 갱신은 DB claim CAS 안에서 전환한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const claimStart = source.indexOf("async function claimSchedulerPhase");
  const claimEnd = source.indexOf("async function settleSchedulerPhase", claimStart);
  const implementation = source.slice(claimStart, claimEnd);
  assert.match(implementation, /forceReferenceRefresh/);
  assert.match(implementation, /requestStockBlogRetryV2ReferenceRefresh/);
  assert.match(implementation, /checkpoint = \{\}/);
  assert.match(source, /forceReferenceRefresh: retryV2\.completed\.reference_preflight/);
  assert.doesNotMatch(source, /completed: \{ \.\.\.retryV2\.completed, reference_preflight: false \}/);
});

test("드래프트 참고자료 오류는 조립 시도를 되돌리고 참고자료부터 다시 수집한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const matches = source.match(/reason\.startsWith\("NAVER_DRAFT_NEEDS_REFERENCE:"\)/g) ?? [];
  assert.equal(matches.length, 4);
  assert.match(source, /requestReferenceRefresh/);
  assert.match(source, /STOCK_REFERENCE_PREFLIGHT_BLOCKED: \$\{reason\}/);
});

test("수동 복구는 본문 생성 claim에만 두 번의 추가 상한을 전달한다", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const overrides = source.match(/maxAttempts: options\.manualRecovery \? STOCK_BLOG_MANUAL_RECOVERY_GENERATION_LIMIT : undefined/g) ?? [];
  assert.equal(overrides.length, 2);
});

test("이미지 발행 조건은 생성 품질 게이트와 네이버 사전검증이 같은 공용 검사를 쓴다", async () => {
  const qualitySource = await readFile(new URL("./quality-gate.ts", import.meta.url), "utf8");
  const naverDraftSource = await readFile(naverDraftSourceUrl, "utf8");
  assert.match(qualitySource, /export function inspectStockBlogImagePublishReadiness/);
  assert.match(qualitySource, /reasons\.push\(\.\.\.imagePublishReadinessReasons\)/);
  assert.match(naverDraftSource, /inspectStockBlogImagePublishReadiness\(pipeline\)/);
  assert.doesNotMatch(naverDraftSource, /if \(pipeline\.imageStatus !== "generated"\)/);
});

test("발행 회로가 열려도 파이프라인과 큐 조립은 진행하고 실제 publish 단계에서만 차단한다", async () => {
  const schedulerSource = await readFile(sourceUrl, "utf8");
  const naverDraftSource = await readFile(naverDraftSourceUrl, "utf8");
  const naverAgentSource = await readFile(naverAgentSourceUrl, "utf8");
  const naverWriterSource = await readFile(naverWriterSourceUrl, "utf8");
  const runStart = schedulerSource.indexOf("async function runOneSchedule");
  const logicalLookup = schedulerSource.indexOf("const logicalExisting", runStart);
  assert.doesNotMatch(schedulerSource.slice(runStart, logicalLookup), /getPublishCircuitBreaker/);

  const createStart = naverDraftSource.indexOf("export async function createNaverDraftJobFromPipeline");
  const createEnd = naverDraftSource.indexOf("export async function cancelNaverDraftJob", createStart);
  const createImplementation = naverDraftSource.slice(createStart, createEnd);
  assert.doesNotMatch(createImplementation, /getPublishCircuitBreaker/);
  assert.match(createImplementation, /publishKey: \{ in: acceptedPublishKeys \}/);
  assert.match(createImplementation, /acceptedPublishKeys\.includes\(existing\.publishKey \?\? ""\)/);
  assert.match(naverDraftSource, /autoPublishLeaseBlocked \? \{ allowPublish: false \} : \{\}/);
  assert.match(naverDraftSource, /status: "publish_ready" as const,[\s\S]{0,150}NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE/);
  assert.match(naverAgentSource, /status === "publish_ready" && errorCode === "NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE"/);
  assert.match(naverWriterSource, /gateStillWaiting[\s\S]{0,150}\? "publish_ready"/);
});
