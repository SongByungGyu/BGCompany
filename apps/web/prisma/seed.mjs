import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function loadRootEnv() {
  const envPath = path.resolve(import.meta.dirname, "../../..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadRootEnv();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const employees = [
  { id: "content-planner", displayName: "미나", initial: "미", department: "콘텐츠팀", role: "AI 에이전트", status: "업무 중", currentTaskId: "task-content-draft", currentLocation: "content-seat-01", model: "Claude Opus 4.6", currentCost: "0.82" },
  { id: "finance-manager", displayName: "도윤", initial: "도", department: "재정팀", role: "AI 에이전트", status: "업무 중", currentTaskId: "task-cost-review", currentLocation: "finance-seat-01", model: "GPT-5.1", currentCost: "0.58" },
  { id: "stock-monitor", displayName: "서준", initial: "서", department: "주식팀", role: "AI 에이전트", status: "조사 중", currentTaskId: "task-stock-watch", currentLocation: "stock-seat-01", model: "Claude Sonnet 4.6", currentCost: "0.37" },
  { id: "developer", displayName: "하늘", initial: "하", department: "개발팀", role: "AI 에이전트", status: "오류 대응 중", currentTaskId: "task-dev-pipeline", currentLocation: "error-response-point", model: "GPT-5.1 Codex", currentCost: "0.46" },
  { id: "qa-auditor", displayName: "윤아", initial: "윤", department: "지식·감사", role: "AI 에이전트", status: "회의 중", currentTaskId: "task-qa-check", currentLocation: "meeting-seat-01", model: "Claude Opus 4.6", currentCost: "0.69" },
  { id: "marketing-manager", displayName: "카이", initial: "카", department: "콘텐츠팀", role: "AI 에이전트", status: "승인 대기", currentTaskId: "task-thumbnail-approval", currentLocation: "approval-wait-point", model: "Claude Opus 4.6", currentCost: "0.61" },
  { id: "director", displayName: "루나", initial: "루", department: "대표실", role: "대표 AI", status: "대기 중", currentTaskId: null, currentLocation: "director-seat", model: "Claude Opus 4.6", currentCost: "0.74" },
];

const tasks = [
  { id: "task-content-draft", title: "블로그 포스트 「6월 루틴 정리」 초안 작성", description: "BG Company 운영 기록을 외부 콘텐츠로 정리", department: "콘텐츠팀", assignedEmployeeId: "content-planner", status: "진행 중", progress: 68, startedAt: new Date("2026-06-26T13:50:00+09:00"), model: "Claude Opus 4.6", cost: "0.82", currentStep: "본문 초안 구조 다듬기", recentOutput: "초안 v2 · 1,240자", nextAction: "제목 A/B안 생성" },
  { id: "task-thumbnail-approval", title: "유튜브 썸네일 3종 검수 요청", description: "콘텐츠 업로드 전 썸네일 후보 검수", department: "콘텐츠팀", assignedEmployeeId: "marketing-manager", status: "승인 대기", progress: 100, startedAt: new Date("2026-06-26T13:35:00+09:00"), model: "Claude Opus 4.6", cost: "0.61", currentStep: "대표 승인 대기", recentOutput: "썸네일 3종", nextAction: "대표 승인 필요" },
  { id: "task-dev-pipeline", title: "배포 파이프라인 빌드 오류 수정", description: "Phase 1-A 웹 앱 배포 가능 상태 복구", department: "개발팀", assignedEmployeeId: "developer", status: "오류", progress: 30, startedAt: new Date("2026-06-26T14:18:00+09:00"), model: "GPT-5.1 Codex", cost: "0.46", currentStep: "빌드 실패 로그 원인 분석", recentOutput: "에러 로그 분석", nextAction: "핫픽스 PR 생성", error: "빌드 단계 exit code 1 · 자동 재시도 1회 실패" },
  { id: "task-cost-review", title: "6월 운영비 정산 및 현금흐름 검토", description: "AI 비용과 운영비 정리", department: "재정팀", assignedEmployeeId: "finance-manager", status: "진행 중", progress: 54, startedAt: new Date("2026-06-26T13:42:00+09:00"), model: "GPT-5.1", cost: "0.58", currentStep: "비용 이상치 검토", recentOutput: "주간 비용 요약", nextAction: "비용 이상치 검토" },
  { id: "task-stock-watch", title: "관심 종목 장중 변동 모니터링", description: "시장 변동성 추적 및 대표 보고 신호 선별", department: "주식팀", assignedEmployeeId: "stock-monitor", status: "진행 중", progress: 42, startedAt: new Date("2026-06-26T13:28:00+09:00"), model: "Claude Sonnet 4.6", cost: "0.37", currentStep: "변동성 이벤트 조사", recentOutput: "변동성 감지 리포트", nextAction: "대표 보고 준비" },
  { id: "task-qa-check", title: "Phase 1-A 품질 기준 검토", description: "가상 오피스 UI와 동선 기능 점검", department: "지식·감사", assignedEmployeeId: "qa-auditor", status: "진행 중", progress: 76, startedAt: new Date("2026-06-26T13:20:00+09:00"), model: "Claude Opus 4.6", cost: "0.69", currentStep: "디자인 오차 보고", recentOutput: "QA 체크리스트 v3", nextAction: "디자인 오차 보고" },
];

const approvals = [
  { id: "approval-thumbnail", title: "유튜브 썸네일 3종 최종안 승인", requestedByEmployeeId: "marketing-manager", taskId: "task-thumbnail-approval", approvalType: "콘텐츠", riskLevel: "보통", estimatedCost: "0.61", status: "승인 대기", reason: "다음 콘텐츠 업로드 전 대표 최종 검수 필요", plannedAction: "승인된 썸네일을 콘텐츠 캘린더에 등록", expectedResult: "오늘 18:00 업로드 준비 완료" },
  { id: "approval-budget", title: "AI 모델 사용량 증액 승인", requestedByEmployeeId: "finance-manager", taskId: "task-cost-review", approvalType: "비용", riskLevel: "낮음", estimatedCost: "12.40", status: "승인 대기", reason: "콘텐츠 회의 이후 결과물 생성량 증가 예상", plannedAction: "오늘 잔여 예산 한도 내 모델 호출량 상향", expectedResult: "업무 지연 없이 콘텐츠 초안 생성 지속" },
  { id: "approval-hotfix", title: "배포 파이프라인 핫픽스 적용 승인", requestedByEmployeeId: "developer", taskId: "task-dev-pipeline", approvalType: "오류", riskLevel: "높음", estimatedCost: "0.46", status: "보류", reason: "빌드 오류 원인 패치 후 재배포 필요", plannedAction: "핫픽스 브랜치 검증 후 배포 파이프라인 재실행", expectedResult: "프로덕션 빌드 정상화" },
];

async function main() {
  for (const employee of employees) {
    await prisma.employee.upsert({ where: { id: employee.id }, update: employee, create: employee });
  }
  for (const task of tasks) {
    await prisma.task.upsert({ where: { id: task.id }, update: task, create: task });
  }
  for (const approval of approvals) {
    await prisma.approvalRequest.upsert({ where: { id: approval.id }, update: approval, create: approval });
  }
  const event = await prisma.eventLog.upsert({
    where: { id: "event-seed-system-ready" },
    update: {},
    create: {
      id: "event-seed-system-ready",
      type: "SystemSeeded",
      timestamp: new Date(),
      payload: { source: "prisma-seed" },
      summary: "초기 BG Company 운영 데이터가 seed 되었습니다.",
    },
  });
  await prisma.timeline.upsert({
    where: { id: "timeline-seed-system-ready" },
    update: {},
    create: {
      id: "timeline-seed-system-ready",
      targetType: "system",
      targetId: "bg-company",
      eventId: event.id,
      title: "초기 데이터 준비",
      description: "직원, 업무, 승인 요청 초기 데이터가 PostgreSQL에 저장되었습니다.",
      timestamp: event.timestamp,
    },
  });
}

main()
  .then(async () => {
    console.log("Seed completed");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
