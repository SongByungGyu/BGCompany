"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createBGCompanyEventBus } from "@/features/events/event-bus";
import { appendTimelineEntry, reduceEmployeesByEvent } from "@/features/events/event-reducer";
import { createMockScenarioSteps, mockScenarioDefinitions, type MockScenarioDefinition } from "@/features/events/mock-scenarios";
import type { BGCompanyEvent, BGTimelineEntry } from "@/features/events/types";
import { useTimeline } from "@/features/timelines/useTimeline";
import type { TimelineRecord } from "@/features/timelines/api";
import { fetchEmployees, type EmployeeRecord } from "@/features/employees/api";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { WorkBoardView } from "@/features/work-board/WorkBoardView";
import { ApprovalInboxView } from "@/features/approvals/ApprovalInboxView";
import { ContentPipelineView } from "@/features/content-pipeline/ContentPipelineView";
import { OperationsWorkspaceView } from "@/features/operations/OperationsWorkspaceView";
import { PortfolioView } from "@/features/portfolio/PortfolioView";
import { fetchOperationsOverview } from "@/features/operations/api";
import type { DashboardEmployeeActivity, DashboardSummary, DashboardSummaryCard } from "@/lib/dashboard-summary/summary-types";
import type { OperationsOverview } from "@/lib/operations/operations-overview-types";

const OfficeCanvas = dynamic(
  () => import("@/components/office/3d/OfficeCanvas"),
  { ssr: false },
);

type View = "selected" | "unselected" | "approval" | "error" | "empty" | "loading";
type Tab = "summary" | "outputs" | "timeline";
type Group = "working" | "meeting" | "waiting" | "error" | "done" | "idle";
type EmployeeStatus = "대기 중" | "업무 중" | "조사 중" | "회의 중" | "검토 중" | "결과 대기" | "승인 대기" | "수정 중" | "보고 중" | "오류 대응 중" | "업무 완료" | "휴식 중" | "업무 종료";
type Employee = {
  id: string; name: string; initial: string; department: string; role: string; status: EmployeeStatus;
  group: Group; task: string; progress: number; started: string; model: string;
  cost: string; output: string; outputMeta: string; next: string; error?: string;
};
type PlaceholderWorkspaceConfig = {
  phase: string;
  description: string;
  status: string;
  current: string;
  next: string;
  owner: string;
  checkpoints: [string, string][];
};

declare global { interface Window { __bgSetView?: (view: View) => void } }

const initialEmployees: Employee[] = [
  { id:"ceo",name:"병규",initial:"병",department:"대표실",role:"대표",status:"대기 중",group:"idle",task:"회사 전체 운영 현황 확인",progress:0,started:"09:00",model:"Human Director",cost:"미집계",output:"대표 의사결정 보드",outputMeta:"실시간 동기화",next:"승인 및 운영 판단" },
  { id:"director",name:"루나",initial:"루",department:"대표실",role:"AI Director",status:"대기 중",group:"idle",task:"전체 회사 업무 현황 대기",progress:0,started:"09:00",model:"Claude Opus 4.6",cost:"미집계",output:"오전 경영 브리핑",outputMeta:"09:30 저장됨",next:"다음 경영 판단 대기" },
  { id:"content-planner",name:"미나",initial:"미",department:"콘텐츠팀",role:"콘텐츠 기획",status:"업무 중",group:"working",task:"주식시장 브리핑 기획",progress:68,started:"13:50",model:"Claude Opus 4.6",cost:"미집계",output:"기획안 v2",outputMeta:"14:21 저장됨",next:"제목 A/B안 생성" },
  { id:"marketing-manager",name:"카이",initial:"카",department:"콘텐츠팀",role:"마케팅 검토",status:"승인 대기",group:"waiting",task:"콘텐츠 제목·썸네일 검토",progress:100,started:"13:35",model:"Claude Opus 4.6",cost:"미집계",output:"마케팅 검토안",outputMeta:"승인 대기",next:"대표 승인 필요" },
  { id:"content-writer",name:"지아",initial:"지",department:"콘텐츠팀",role:"콘텐츠 작가",status:"업무 중",group:"working",task:"네이버 블로그 본문 작성",progress:47,started:"13:55",model:"GPT-5.4 mini",cost:"미집계",output:"게시용 본문 초안",outputMeta:"작성 중",next:"QA 검토 요청" },
  { id:"qa-auditor",name:"윤아",initial:"윤",department:"지식·감사",role:"QA 감사",status:"회의 중",group:"meeting",task:"콘텐츠 품질 기준 검토",progress:76,started:"13:20",model:"Claude Opus 4.6",cost:"미집계",output:"QA 체크리스트 v3",outputMeta:"14:05 저장됨",next:"품질 오차 보고" },
  { id:"finance-manager",name:"도윤",initial:"도",department:"재정팀",role:"재정 관리",status:"업무 중",group:"working",task:"운영비 정산 및 현금흐름 검토",progress:54,started:"13:42",model:"GPT-5.1",cost:"미집계",output:"주간 비용 요약",outputMeta:"14:18 저장됨",next:"비용 이상치 검토" },
  { id:"stock-monitor",name:"서준",initial:"서",department:"주식팀",role:"시장 분석",status:"조사 중",group:"waiting",task:"한국·미국 시장 데이터 모니터링",progress:42,started:"13:28",model:"Claude Sonnet 4.6",cost:"미집계",output:"시장 변동 리포트",outputMeta:"14:12 저장됨",next:"대표 보고 준비" },
  { id:"developer",name:"준범",initial:"준",department:"개발팀",role:"개발·서버",status:"오류 대응 중",group:"error",task:"배포 파이프라인 및 서버 점검",progress:30,started:"14:18",model:"GPT-5.1 Codex",cost:"미집계",output:"에러 로그 분석",outputMeta:"14:24 진행 중",next:"핫픽스 PR 생성",error:"빌드 단계 exit code 1 · 14:21 감지, 자동 재시도 1회 실패." },
  { id:"local-publisher",name:"Local Agent",initial:"N",department:"게시 운영",role:"네이버 게시 에이전트",status:"대기 중",group:"idle",task:"네이버 임시저장 작업 대기",progress:0,started:"상시",model:"Local Playwright",cost:"미집계",output:"Draft Job Queue",outputMeta:"연결 대기",next:"승인된 글 임시저장" },
];

const employeeProfileOverrides: Partial<Record<string, Pick<Employee, "name" | "initial" | "role">>> = {
  developer: { name: "준범", initial: "준", role: "개발·서버" },
};

const nav = [["⌂","대표실"],["◇","가상 오피스"],["▣","업무 보드"],["♙","승인함"],["✎","콘텐츠"],["▤","재정"],["⌁","주식"],["‹›","개발"],["□","지식관리"],["◉","감사·품질"],["▧","보고서"]];
const placeholderWorkspaces: Record<string, PlaceholderWorkspaceConfig> = {
  "재정": {
    phase: "운영 비용",
    description: "AI 사용 비용과 운영비, 월별 예산 이상치를 한 화면에서 확인하는 재정 관제 영역입니다.",
    status: "비용 데이터 연결 준비",
    current: "대표실 비용 KPI와 직원별 현재 비용을 사용 중입니다.",
    next: "일·주·월 비용 추이와 예산 경고를 연결합니다.",
    owner: "도윤 · 재정팀",
    checkpoints: [["비용 집계", "모델·직원·업무별 비용"], ["예산 경고", "한도 초과와 이상치 감지"], ["월간 요약", "운영비 추이와 전망"]],
  },
  "주식": {
    phase: "시장 데이터",
    description: "한국·미국 시장 데이터 수집부터 주식 블로그 일정과 발행 준비 상태까지 연결하는 화면입니다.",
    status: "수집 파이프라인 운영 중",
    current: "시장 데이터와 블로그 스케줄러가 백그라운드에서 동작 중입니다.",
    next: "MarketSnapshot 품질과 다음 실행 일정을 시각화합니다.",
    owner: "서준 · 주식팀",
    checkpoints: [["시장 스냅샷", "지수·환율·금리·수급"], ["작성 일정", "장전·마감·주간 브리핑"], ["발행 상태", "초안·검수·네이버 작업"]],
  },
  "개발": {
    phase: "서비스 운영",
    description: "배포 상태, 서비스 헬스, 오류 대응과 변경 이력을 모아보는 개발 관제 영역입니다.",
    status: "업무 보드 연동 중",
    current: "개발 직원 상태와 오류 업무는 가상 오피스·업무 보드에 반영됩니다.",
    next: "서비스별 헬스와 최근 배포 결과를 연결합니다.",
    owner: "준범 · 개발팀",
    checkpoints: [["서비스 헬스", "Web·Hermes·DB 상태"], ["배포 기록", "빌드·테스트·릴리스"], ["오류 대응", "원인·조치·복구 시간"]],
  },
  "지식관리": {
    phase: "운영 지식",
    description: "프롬프트, 운영 문서, 시장 참고자료와 반복 업무 기준을 버전별로 관리하는 영역입니다.",
    status: "정보 구조 설계 중",
    current: "콘텐츠 결과물과 직원 타임라인에 운영 지식이 분산되어 있습니다.",
    next: "문서 검색과 버전·출처 메타데이터를 연결합니다.",
    owner: "윤아 · 지식관리",
    checkpoints: [["문서 보관", "프롬프트·런북·보고서"], ["출처 관리", "링크·기준일·사용 범위"], ["변경 이력", "버전·승인·적용 상태"]],
  },
  "감사·품질": {
    phase: "품질 게이트",
    description: "콘텐츠 QA, 데이터 검증, 이미지 정책과 자동발행 차단 사유를 통합 점검하는 영역입니다.",
    status: "QA 데이터 연결 준비",
    current: "QA 업무와 승인 결과는 업무 보드·승인함에서 확인할 수 있습니다.",
    next: "품질 점수와 차단 사유, 재검수 이력을 연결합니다.",
    owner: "윤아 · QA 감사",
    checkpoints: [["콘텐츠 품질", "구조·가독성·중복 검사"], ["데이터 검증", "수치·출처·기준일 확인"], ["발행 차단", "이미지·세션·정책 오류"]],
  },
  "보고서": {
    phase: "경영 보고",
    description: "오늘의 작업, 비용, 승인과 오류를 일간·주간 보고서로 묶어 전달하는 영역입니다.",
    status: "대표실 브리핑 연동 준비",
    current: "대표실에서 rule-based 운영 요약을 제공하고 있습니다.",
    next: "기간별 보고서 생성과 승인·내보내기를 연결합니다.",
    owner: "루나 · AI Director",
    checkpoints: [["일간 보고", "오늘의 완료·대기·오류"], ["주간 추이", "비용·품질·생산성"], ["내보내기", "보고서 프롬프트·문서"]],
  },
};
const legend: [Group,string][] = [["working","업무 중"],["meeting","회의 중"],["waiting","승인 대기"],["error","오류 대응"],["done","업무 완료"],["idle","대기·휴식"]];
const SHOW_EMPLOYEE_MOVEMENT_DEV_PANEL = process.env.NODE_ENV === "development";
const SHOW_MOCK_EVENT_SCENARIO_PANEL = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SHOW_MOCK_EVENT_PANEL === "true";
const employeeStatusOptions: EmployeeStatus[] = ["대기 중","업무 중","조사 중","회의 중","검토 중","결과 대기","승인 대기","수정 중","보고 중","오류 대응 중","업무 완료","휴식 중","업무 종료"];
type MovementTestScenario = { label: string; steps: [string, EmployeeStatus][] };
const movementTestScenarios: MovementTestScenario[] = [
  { label: "전체 회의", steps: [["ceo","회의 중"],["director","회의 중"],["content-planner","회의 중"],["marketing-manager","회의 중"],["content-writer","회의 중"],["qa-auditor","회의 중"],["finance-manager","회의 중"],["stock-monitor","회의 중"],["developer","회의 중"]] },
  { label: "콘텐츠 회의", steps: [["content-planner","회의 중"],["qa-auditor","회의 중"],["finance-manager","회의 중"]] },
  { label: "승인 요청", steps: [["marketing-manager","승인 대기"],["director","보고 중"]] },
  { label: "오류 대응", steps: [["developer","오류 대응 중"],["finance-manager","조사 중"]] },
  { label: "휴식", steps: [["stock-monitor","휴식 중"],["content-planner","휴식 중"]] },
  { label: "업무 복귀", steps: [["ceo","대기 중"],["director","대기 중"],["content-planner","업무 중"],["marketing-manager","업무 중"],["content-writer","업무 중"],["qa-auditor","검토 중"],["finance-manager","업무 중"],["stock-monitor","조사 중"],["developer","업무 중"],["local-publisher","대기 중"]] },
];
function isEmployeeStatus(value: string): value is EmployeeStatus {
  return value in statusGroupMap;
}

function mergeEmployeeRecords(currentEmployees: Employee[], records: EmployeeRecord[]) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  let changed = false;
  const mergedEmployees = currentEmployees.map((employee) => {
    const record = recordsById.get(employee.id);
    if (!record) return employee;
    const profileOverride = employeeProfileOverrides[employee.id];
    const status = isEmployeeStatus(record.status) ? record.status : employee.status;
    const nextEmployee = {
      ...employee,
      name: profileOverride?.name ?? (record.displayName || employee.name),
      initial: profileOverride?.initial ?? (record.initial || employee.initial),
      role: profileOverride?.role ?? employee.role,
      department: record.department || employee.department,
      status,
      group: statusGroupMap[status],
      model: record.model ?? employee.model,
      cost: "미집계",
    };
    if (
      nextEmployee.name === employee.name
      && nextEmployee.initial === employee.initial
      && nextEmployee.role === employee.role
      && nextEmployee.department === employee.department
      && nextEmployee.status === employee.status
      && nextEmployee.group === employee.group
      && nextEmployee.model === employee.model
      && nextEmployee.cost === employee.cost
    ) {
      return employee;
    }
    changed = true;
    return nextEmployee;
  });
  return changed ? mergedEmployees : currentEmployees;
}

const statusGroupMap: Record<EmployeeStatus, Group> = {
  "대기 중": "idle",
  "업무 중": "working",
  "조사 중": "waiting",
  "회의 중": "meeting",
  "검토 중": "working",
  "결과 대기": "waiting",
  "승인 대기": "waiting",
  "수정 중": "working",
  "보고 중": "working",
  "오류 대응 중": "error",
  "업무 완료": "done",
  "휴식 중": "idle",
  "업무 종료": "idle",
};

export default function Home() {
  const [view,setView] = useState<View>("selected");
  const [selected,setSelected] = useState(0);
  const [tab,setTab] = useState<Tab>("summary");
  const [activeNav,setActiveNav] = useState("가상 오피스");
  const [dashboardSummary,setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardSummaryLoading,setDashboardSummaryLoading] = useState(false);
  const [dashboardSummaryError,setDashboardSummaryError] = useState<string | null>(null);
  const [financeSummary,setFinanceSummary] = useState<OperationsOverview["finance"] | null>(null);
  const [clock,setClock] = useState("");
  const [employees,setEmployees] = useState(initialEmployees);
  const [eventLog,setEventLog] = useState<BGCompanyEvent[]>([]);
  const [timelineByEmployeeId,setTimelineByEmployeeId] = useState<Record<string, BGTimelineEntry[]>>({});
  const eventBusRef = useRef(createBGCompanyEventBus());
  const scenarioTimerIdsRef = useRef<number[]>([]);
  const employeeRefreshWarningRef = useRef(false);
  const [devEmployeeId,setDevEmployeeId] = useState(initialEmployees[0].id);
  const [devStatus,setDevStatus] = useState<EmployeeStatus>("회의 중");
  const refreshDashboardSummary = useCallback(async () => {
    setDashboardSummaryLoading(true);
    setDashboardSummaryError(null);
    try {
      const response = await fetch("/api/dashboard-summary", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const summary = await response.json() as DashboardSummary;
      setDashboardSummary(summary);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : "요약 정보를 불러오지 못했습니다.";
      setDashboardSummaryError(message);
      return null;
    } finally {
      setDashboardSummaryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (activeNav !== "대표실") return undefined;
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!cancelled) await refreshDashboardSummary();
    });
    const intervalId = window.setInterval(() => {
      void refreshDashboardSummary();
    }, DB_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeNav, refreshDashboardSummary]);
  const refreshFinanceSummary = useCallback(async () => {
    try {
      const overview = await fetchOperationsOverview();
      setFinanceSummary(overview.finance);
      return overview.finance;
    } catch (error) {
      console.warn("[BG Company] failed to refresh official finance summary", error);
      return null;
    }
  }, []);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshFinanceSummary(), 0);
    const intervalId = window.setInterval(() => void refreshFinanceSummary(), 300_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [refreshFinanceSummary]);
  const selectIndexById = useCallback((employeeId: string) => {
    const index = employees.findIndex((employee) => employee.id === employeeId);
    if (index >= 0) setSelected(index);
  }, [employees]);
  const setDemoView = useCallback((next: View) => {
    setView(next);
    setTab("summary");
    if(next==="selected") setSelected(0);
    if(next==="approval") selectIndexById("marketing-manager");
    if(next==="error") selectIndexById("developer");
  }, [selectIndexById]);
  useEffect(()=>{ const tick=()=>setClock(new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())); tick(); const id=setInterval(tick,1000); return()=>clearInterval(id)},[]);
  useEffect(()=>{ const id=window.setTimeout(()=>{ const viewParam=new URLSearchParams(window.location.search).get("view"); if(viewParam==="work-board") setActiveNav("업무 보드"); if(viewParam==="approvals") setActiveNav("승인함"); },0); return()=>window.clearTimeout(id); },[]);
  useEffect(()=>{ window.__bgSetView=setDemoView; return()=>{delete window.__bgSetView}},[setDemoView]);
  useEffect(()=>()=>{scenarioTimerIdsRef.current.forEach((timerId)=>window.clearTimeout(timerId));},[]);
  const refreshEmployeesFromDb = useCallback(async () => {
    try {
      const records = await fetchEmployees();
      employeeRefreshWarningRef.current = false;
      if (records.length > 0) setEmployees((currentEmployees) => mergeEmployeeRecords(currentEmployees, records));
      return records;
    } catch (error: unknown) {
      if (!employeeRefreshWarningRef.current) {
        employeeRefreshWarningRef.current = true;
        console.warn("[BG Company] failed to refresh employees from DB", error);
      }
      return [];
    }
  }, []);
  useEffect(() => {
    if (activeNav !== "가상 오피스") return undefined;
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!cancelled) await refreshEmployeesFromDb();
    });
    const intervalId = window.setInterval(() => {
      void refreshEmployeesFromDb();
    }, DB_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeNav, refreshEmployeesFromDb]);
  const current=employees[selected], approvals=employees.filter(e=>e.status==="승인 대기").length, errors=employees.filter(e=>e.group==="error").length, working=employees.filter(e=>["working","meeting"].includes(e.group)).length;
  const financeValue = useCallback((value: number | null) => {
    if (financeSummary?.providerStatus === "setup_required") return "키 연결 필요";
    if (financeSummary?.providerStatus === "forbidden") return "권한 확인";
    if (financeSummary?.providerStatus && financeSummary.providerStatus !== "connected") return "조회 지연";
    if (value === null || value === undefined) return "—";
    return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
  }, [financeSummary]);
  const kpis=useMemo(()=>[["업무 중",String(working),""],["진행 중 업무","12",""],["승인 대기",String(approvals),"waiting"],["오류",String(errors),"error"],["오늘 OpenAI",financeValue(financeSummary?.costs.todayUsd ?? null),financeSummary?.providerStatus === "connected" ? "" : "waiting"],["이번 달 실비",financeValue(financeSummary?.costs.monthUsd ?? null),financeSummary?.providerStatus === "forbidden" ? "error" : financeSummary?.providerStatus === "connected" ? "" : "waiting"]],[approvals,errors,financeSummary,financeValue,working]);
  const choose=useCallback((i:number)=>{ if(selected===i&&view!=="unselected"){setView("unselected");return} setSelected(i);setTab("summary");setView(employees[i].status==="승인 대기"?"approval":employees[i].group==="error"?"error":"selected"); },[employees,selected,view]);
  const chooseEmployeeById = useCallback((employeeId: string) => {
    const index = employees.findIndex((employee) => employee.id === employeeId);
    if (index >= 0) choose(index);
  }, [choose, employees]);
  const focusEmployeeByEvent = useCallback((employeeId: string, status: EmployeeStatus) => {
    const index = employees.findIndex((employee) => employee.id === employeeId);
    if (index < 0) return;
    setSelected(index);
    setTab("summary");
    const group = statusGroupMap[status];
    setView(status==="승인 대기"?"approval":group==="error"?"error":"selected");
  }, [employees]);
  const publishBGEvent = useCallback(async (event: BGCompanyEvent, focus = true, persist = true) => {
    eventBusRef.current.publish(event);
    const payload = event.payload as Record<string, unknown>;
    if (persist) {
      await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          employeeId: event.employeeId,
          taskId: event.taskId,
          approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
          payload,
          summary: typeof payload.reason === "string" ? payload.reason : typeof payload.title === "string" ? payload.title : event.type,
        }),
      }).catch((error: unknown) => console.warn("[BG Company] failed to persist event", error));
    }
    setEventLog(eventBusRef.current.getLog());
    const status = typeof payload.status === "string" ? payload.status as EmployeeStatus : undefined;
    const payloadNextStatus = typeof payload.nextStatus === "string" ? payload.nextStatus as EmployeeStatus : undefined;
    const nextStatus = event.type === "MeetingStarted" ? "회의 중" : event.type === "ApprovalRequested" ? "승인 대기" : event.type === "ErrorOccurred" ? "오류 대응 중" : event.type === "TaskStarted" ? "업무 중" : event.type === "ErrorResolved" ? payloadNextStatus ?? "업무 중" : event.type === "MeetingEnded" ? payloadNextStatus ?? "업무 중" : event.type === "ApprovalResolved" ? payload.approved ? "업무 완료" : "수정 중" : event.type === "OutputGenerated" ? payloadNextStatus ?? "결과 대기" : status;
    setEmployees((currentEmployees)=> {
      setTimelineByEmployeeId((timeline)=>appendTimelineEntry(timeline, event, currentEmployees));
      return reduceEmployeesByEvent(currentEmployees, event);
    });
    if (focus && event.employeeId && nextStatus) focusEmployeeByEvent(event.employeeId, nextStatus);
  }, [focusEmployeeByEvent]);
  const resetMockEvents = useCallback(() => {
    scenarioTimerIdsRef.current.forEach((timerId)=>window.clearTimeout(timerId));
    scenarioTimerIdsRef.current = [];
    eventBusRef.current.clear();
    setEventLog([]);
    setTimelineByEmployeeId({});
    setEmployees(initialEmployees);
    setSelected(0);
    setTab("summary");
    setView("selected");
  }, []);
  const runMockScenario = useCallback((scenarioId: MockScenarioDefinition["id"]) => {
    scenarioTimerIdsRef.current.forEach((timerId)=>window.clearTimeout(timerId));
    scenarioTimerIdsRef.current = createMockScenarioSteps(scenarioId).map(({delayMs,event})=>window.setTimeout(()=>publishBGEvent({...event,timestamp:new Date().toISOString()}),delayMs));
  }, [publishBGEvent]);
  const updateEmployeeStatus = useCallback((employeeId: string, status: EmployeeStatus, focus = true) => {
    const group = statusGroupMap[status];
    setEmployees(list=>list.map(employee=>employee.id===employeeId?{...employee,status,group,next:status==="업무 완료"?"다음 업무 대기":status==="오류 대응 중"?"오류 원인 분석 및 핫픽스 준비":status==="승인 대기"?"대표 승인 필요":employee.next}:employee));
    if (focus) {
      const index = employees.findIndex((employee) => employee.id === employeeId);
      if (index >= 0) {
        setSelected(index);
        setTab("summary");
        setView(status==="승인 대기"?"approval":group==="error"?"error":"selected");
      }
    }
  }, [employees]);
  const runMovementScenario = (steps = movementTestScenarios[0].steps) => steps.forEach(([employeeId,status])=>updateEmployeeStatus(employeeId,status,false));
  const resolve=(approved:boolean)=>{ setEmployees(list=>list.map((e,i)=>i===selected?{...e,status:approved?"업무 완료":"수정 중",group:approved?"done":"working",next:approved?"게시 일정 등록":"수정안 재제출"}:e));setView("selected"); };
  const logout=async()=>{ await fetch("/api/auth/logout",{method:"POST"}).catch(()=>undefined); window.location.href="/login"; };

  return <main className="control-room">
    <header className="top-bar"><div className="brand"><b>✦</b><strong>BG Company</strong><span>가상 회사 관제</span></div><div className="clock"><i/>{clock}</div><div className="kpis">{kpis.map(([label,value,kind])=><button key={label} className={kind} disabled={!kind||value==="0"} onClick={()=>kind==="error"?(setActiveNav("가상 오피스"),setDemoView("error")):kind==="waiting"?setActiveNav("승인함"):null}><span>{label}</span><strong>{value}</strong></button>)}<button className="gear">⚙</button><button className="logout-button" onClick={logout}>로그아웃</button>{view==="loading"&&<i className="kpi-loading"/>}</div></header>
    <div className="workspace">
      <nav className="left-nav">{nav.map(([icon,label])=><button key={label} className={activeNav===label?"active":""} onClick={()=>setActiveNav(label)}><b>{icon}</b><span>{label}</span>{label==="승인함"&&approvals>0&&<i>{approvals}</i>}</button>)}</nav>
      {activeNav==="대표실" ? (
        <DashboardWorkspace summary={dashboardSummary} isLoading={dashboardSummaryLoading} error={dashboardSummaryError} onRefresh={refreshDashboardSummary}/>
      ) : activeNav==="가상 오피스" ? (
        <>
          <section className="stage">
            <div className="viewport">
              <OfficeViewportStatusBar/>
              <div className="office-canvas-wrap">
                <div className="controls"><button>⌕</button><button>⛶</button><button>◇</button></div>
                {view==="error"&&<div className="toast"><span>⚠</span><strong>개발·서버실 · 준범 — 배포 파이프라인 오류 대응 중</strong><button onClick={()=>setDemoView("error")}>상세 보기</button></div>}
                <ViewportState
                  employees={employees}
                  onSelectEmployee={chooseEmployeeById}
                  selectedEmployeeId={view === "unselected" ? null : current?.id ?? null}
                  view={view}
                />
                {SHOW_MOCK_EVENT_SCENARIO_PANEL ? (
                  <MockEventScenarioPanel
                    eventCount={eventLog.length}
                    onReset={resetMockEvents}
                    onRunScenario={runMockScenario}
                  />
                ) : null}
                {SHOW_EMPLOYEE_MOVEMENT_DEV_PANEL ? (
                  <EmployeeMovementDevPanel
                    employees={employees}
                    employeeId={devEmployeeId}
                    onChangeEmployee={setDevEmployeeId}
                    onChangeStatus={setDevStatus}
                    onRunScenario={runMovementScenario}
                    onApply={()=>updateEmployeeStatus(devEmployeeId,devStatus)}
                    scenarios={movementTestScenarios}
                    status={devStatus}
                  />
                ) : null}
              </div>
              <EmployeeDock view={view} employees={view==="empty"?[]:employees} selected={selected} choose={choose}/>
            </div>
          </section>
          <Panel view={view} employee={current} tab={tab} setTab={setTab} close={()=>setView("unselected")} resolve={resolve} timelineEntries={timelineByEmployeeId[current?.id] ?? []} timelineRefreshKey={eventLog.length}/>
        </>
      ) : activeNav==="업무 보드" ? (
        <WorkBoardView employees={employees} eventLog={eventLog} onPublishEvent={publishBGEvent}/>
      ) : activeNav==="승인함" ? (
        <ApprovalInboxView employees={employees} eventLog={eventLog} onPublishEvent={publishBGEvent}/>
      ) : activeNav==="콘텐츠" ? (
        <ContentPipelineView/>
      ) : activeNav==="보고서" ? (
        <OperationsWorkspaceView scope="report"/>
      ) : activeNav==="개발" ? (
        <OperationsWorkspaceView scope="development"/>
      ) : activeNav==="재정" ? (
        <OperationsWorkspaceView scope="finance"/>
      ) : activeNav==="주식" ? (
        <PortfolioView/>
      ) : (
        <PlaceholderWorkspace label={activeNav}/>
      )}
    </div>
  </main>
}

function OfficeViewportStatusBar(){ return <div className="office-viewport-status-bar"><strong>상태 범례</strong><div>{legend.map(([group,label])=><span key={group}><i className={`dot ${group}`}/>{label}</span>)}</div></div> }
function formatDashboardActivityTime(value:string){ return new Intl.DateTimeFormat("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value)); }
function DashboardActivityList({title,eyebrow,items,emptyText}:{title:string;eyebrow:string;items:DashboardEmployeeActivity[];emptyText:string}){
  return <section className="dashboard-activity-section"><header><div><span>{eyebrow}</span><h2>{title}</h2></div><b>{items.length}건</b></header><div className="dashboard-activity-list">{items.length>0?items.map((item)=><article key={item.id} className={item.severity}><div className="dashboard-activity-head"><strong>{item.employeeName} <span>({item.taskTitle})</span></strong><b>{item.statusLabel}</b></div><p>{item.detail}</p><footer><span>{item.employeeRole ?? "역할 미지정"} · {item.source}{item.mode?` · ${item.mode}`:""}</span><time>{formatDashboardActivityTime(item.occurredAt)}</time></footer></article>):<p className="dashboard-activity-empty">{emptyText}</p>}</div></section>
}
function DashboardWorkspace({summary,isLoading,error,onRefresh}:{summary:DashboardSummary | null;isLoading:boolean;error:string | null;onRefresh:()=>Promise<DashboardSummary | null>}){
  const cards = summary?.cards ?? [];
  const activeWork = summary?.activeWork ?? [];
  const recentAgentActivity = summary?.recentAgentActivity ?? [];
  return <><section className="stage"><div className="feature-shell dashboard-summary-shell"><header className="dashboard-summary-hero"><div><span>PHASE 1-S</span><h1>오늘의 운영 브리핑</h1><p>{summary?.briefing ?? "업무·승인·Hermes·네이버 임시저장 상태를 rule-based 요약으로 불러오는 중입니다."}</p></div><button onClick={()=>void onRefresh()} disabled={isLoading}>{isLoading?"새로고침 중":"요약 새로고침"}</button></header>{error?<div className="dashboard-summary-error">요약 조회 실패 · {error}</div>:null}<section className="dashboard-briefing-card"><label>대표실 한 줄 판단</label><strong>{summary?.headline ?? "운영 상태를 확인하고 있습니다."}</strong><p>{summary?`생성 시각 ${new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(summary.generatedAt))}`:"DB 상태를 읽는 중입니다."}</p></section><div className="dashboard-summary-grid">{cards.map((card)=><DashboardSummaryCardView key={card.id} card={card}/>)}</div><div className="dashboard-agent-columns"><DashboardActivityList eyebrow="현재 Task" title="직원별 진행 업무" items={activeWork} emptyText="현재 진행 중인 실제 업무가 없습니다."/><DashboardActivityList eyebrow="최근 AgentRun" title="에이전트가 수행한 작업" items={recentAgentActivity} emptyText="최근 에이전트 실행 기록이 없습니다."/></div><section className="dashboard-schedule"><h2>주식 블로그 운영 일정</h2><div>{summary?.stockBlogSchedule.map((item)=><article key={item.contentType}><strong>{item.scheduledTimeKst}</strong><div><b>{item.label}</b><span>{item.cadence} · {item.objective}</span></div></article>) ?? <p>일정을 불러오는 중입니다.</p>}</div></section></div></section><aside className="panel feature-detail-panel"><div className="feature-panel-tabs"><strong>대표실 요약</strong><span>실제 DB</span></div><div className="panel-body"><div className="feature-card"><label>직원 활동</label><strong>진행 업무 {activeWork.length}건</strong><p>최근 AgentRun {recentAgentActivity.length}건을 이름과 업무 단위로 표시합니다.</p></div><div className="feature-card"><label>다음 행동</label>{summary?.nextActions.map((action)=><p key={action}>• {action}</p>) ?? <p>요약 데이터를 불러오면 다음 행동이 표시됩니다.</p>}</div><div className="feature-card muted"><label>정책</label><p>이 요약은 LLM을 호출하지 않고 실제 Task·AgentRun DB 기록만 읽습니다. 화면 조회 비용은 발생하지 않습니다.</p></div></div></aside></>
}
function DashboardSummaryCardView({card}:{card:DashboardSummaryCard}){ return <article className={`dashboard-summary-card ${card.severity}`}><label>{card.title}</label><strong>{card.value}</strong><p>{card.description}</p>{card.actionLabel?<span>{card.actionLabel}</span>:null}</article> }
function PlaceholderWorkspace({label}:{label:string}){
  const workspace = placeholderWorkspaces[label] ?? {
    phase: "준비 단계",
    description: `${label} 운영 화면을 준비하고 있습니다.`,
    status: "연결 항목 검토 중",
    current: "공통 관제 UI와 직원 상태를 사용할 수 있습니다.",
    next: "실제 데이터 연결 후 상세 화면을 제공합니다.",
    owner: "BG Company",
    checkpoints: [["데이터 연결", "실제 운영 데이터"], ["상태 표시", "진행·승인·오류"], ["상세 패널", "결과와 다음 행동"]] as [string,string][],
  };
  return <>
    <section className="stage">
      <div className="feature-shell placeholder-workspace">
        <header className="feature-hero placeholder-hero">
          <div><span>{workspace.phase}</span><h1>{label}</h1><p>{workspace.description}</p></div>
          <div className="placeholder-status"><i/><strong>{workspace.status}</strong></div>
        </header>
        <div className="placeholder-overview-grid">
          <article><label>현재 연결</label><strong>사용 가능한 운영 정보</strong><p>{workspace.current}</p></article>
          <article><label>다음 단계</label><strong>우선 구현 항목</strong><p>{workspace.next}</p></article>
          <article><label>담당 직원</label><strong>{workspace.owner}</strong><p>가상 오피스와 업무 보드의 직원 상태를 기준으로 연결합니다.</p></article>
        </div>
        <section className="placeholder-checkpoints">
          <header><div><span>연결 설계</span><h2>{label}에서 확인하게 될 정보</h2></div><b>3개 모듈</b></header>
          <div>{workspace.checkpoints.map(([title,description],index)=><article key={title}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{title}</strong><p>{description}</p></div></article>)}</div>
        </section>
      </div>
    </section>
    <aside className="panel feature-detail-panel placeholder-detail-panel">
      <div className="feature-panel-tabs"><strong>{label} 요약</strong><span>준비 단계</span></div>
      <div className="panel-body">
        <div className="feature-card"><label>운영 목적</label><strong>{workspace.description}</strong></div>
        <div className="feature-card muted"><label>연결 원칙</label><p>실제 DB·API 데이터가 확인된 항목만 표시하고, 준비되지 않은 기능은 실행 가능한 것처럼 보이지 않게 구분합니다.</p></div>
        <div className="feature-card"><label>다음 행동</label><strong>{workspace.next}</strong></div>
      </div>
    </aside>
  </>;
}
function MockEventScenarioPanel({eventCount,onReset,onRunScenario}:{eventCount:number;onReset:()=>void;onRunScenario:(scenarioId:MockScenarioDefinition["id"])=>void}){ return <div className="mock-event-scenario-panel"><strong>Mock 이벤트</strong>{mockScenarioDefinitions.map((scenario)=><button key={scenario.id} onClick={()=>onRunScenario(scenario.id)}>{scenario.label}</button>)}<button onClick={onReset}>전체 리셋</button><span>{eventCount} events</span></div> }
function EmployeeMovementDevPanel({
  employees,
  employeeId,
  onApply,
  onChangeEmployee,
  onChangeStatus,
  onRunScenario,
  scenarios,
  status,
}: {
  employees: Employee[];
  employeeId: string;
  onApply: () => void;
  onChangeEmployee: (employeeId: string) => void;
  onChangeStatus: (status: EmployeeStatus) => void;
  onRunScenario: (steps?: [string, EmployeeStatus][]) => void;
  scenarios: MovementTestScenario[];
  status: EmployeeStatus;
}){ return <div className="employee-movement-dev-panel"><strong>이동 테스트</strong><select value={employeeId} onChange={(event)=>onChangeEmployee(event.target.value)}>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><select value={status} onChange={(event)=>onChangeStatus(event.target.value as EmployeeStatus)}>{employeeStatusOptions.map(option=><option key={option} value={option}>{option}</option>)}</select><button onClick={onApply}>이동</button>{scenarios.map((scenario)=><button key={scenario.label} onClick={()=>onRunScenario(scenario.steps)}>{scenario.label}</button>)}</div> }
function ViewportState({
  employees,
  onSelectEmployee,
  selectedEmployeeId,
  view,
}: {
  employees: Employee[];
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployeeId: string | null;
  view: View;
}){ if(view==="empty") return <div className="view-center empty"><b>▱</b><strong>아직 활동 중인 직원이 없습니다</strong><p>직원을 채용하면 이곳에서 함께 일하는 모습을 볼 수 있습니다</p></div>; if(view==="loading") return <div className="view-center loading"><i/><span>가상 오피스를 불러오는 중...</span></div>; return <OfficeCanvas employees={employees} onSelectEmployee={onSelectEmployee} selectedEmployeeId={selectedEmployeeId}/> }
function EmployeeDock({view,employees,selected,choose}:{view:View;employees:Employee[];selected:number;choose:(i:number)=>void}){ return <div className="employee-dock-bar"><header><div><strong>사무실 직원</strong><span>클릭하면 우측에 상세가 열립니다</span></div><span>총 {employees.length}명 · 업무 중 {employees.filter(e=>["working","meeting"].includes(e.group)).length}</span></header>{view==="loading"?<div className="dock-skeleton">{[1,2,3,4,5].map(i=><i key={i}/>)}</div>:employees.length===0?<div className="dock-empty">표시할 직원이 없습니다</div>:<div className="dock-list">{employees.map((e,i)=><button key={e.id} className={selected===i&&view!=="unselected"?"selected":""} onClick={()=>choose(i)}><Avatar e={e} small/><span><strong>{e.name}</strong><small className={e.group}>{e.status}</small></span></button>)}</div>}</div> }
function Panel({view,employee,tab,setTab,close,resolve,timelineEntries,timelineRefreshKey}:{view:View;employee?:Employee;tab:Tab;setTab:(t:Tab)=>void;close:()=>void;resolve:(a:boolean)=>void;timelineEntries:BGTimelineEntry[];timelineRefreshKey:number}){ const employeeTimeline=useTimeline(employee&&view!=="empty"&&view!=="unselected"&&view!=="loading"?"employee":undefined,employee?.id,{ polling: tab==="timeline" }); const refreshEmployeeTimeline=employeeTimeline.refresh; useEffect(()=>{ if(!employee?.id||view==="empty"||view==="unselected"||view==="loading") return; Promise.resolve().then(()=>refreshEmployeeTimeline()); },[employee?.id,timelineRefreshKey,view,refreshEmployeeTimeline]); if(view==="loading") return <aside className="panel skeleton"><i/><div><b/><span><i/><i/></span></div><i/><i className="tall"/><section><i/><i/></section><i/></aside>; if(view==="empty"||view==="unselected"||!employee) return <aside className="panel no-selection"><div><b>♙</b><strong>{view==="empty"?"선택할 직원이 없습니다":"직원을 선택하세요"}</strong><p>{view==="empty"?"직원이 채용되면 이곳에서 상세 정보를 확인할 수 있습니다.":"하단 직원 도크에서 직원을 클릭하면 현재 업무와 상세 정보가 여기에 표시됩니다."}</p></div></aside>; return <aside className="panel"><div className="tabs">{(["summary","outputs","timeline"] as Tab[]).map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t==="summary"?"요약":t==="outputs"?"결과물":"타임라인"}</button>)}<button className="close" onClick={close}>×</button></div><div className="panel-body"><div className="profile"><Avatar e={employee}/><div><h2>{employee.name}</h2><p>{employee.department} · {employee.role}</p></div></div><span className={`badge ${employee.group}`}><i className={`dot ${employee.group}`}/>{employee.status}</span>{tab==="summary"?<Summary e={employee} view={view} resolve={resolve}/>:tab==="outputs"?<Outputs e={employee}/>:<Timeline e={employee} entries={timelineEntries} dbTimeline={employeeTimeline.timeline} isLoading={employeeTimeline.isLoading} error={employeeTimeline.error}/>}</div></aside> }
function Summary({e,view,resolve}:{e:Employee;view:View;resolve:(a:boolean)=>void}){ return <div className="panel-stack">{view==="error"&&e.error&&<div className="error-banner"><span>⚠</span><div><strong>오류가 발생했습니다</strong><p>{e.error}</p></div></div>}<section className="task"><label>현재 업무</label><strong>{e.task}</strong><div><span><i className={e.group} style={{width:`${e.progress}%`}}/></span><b>{e.progress}%</b></div></section><div className="metrics"><Metric label="시작 시각" value={e.started}/><Metric label="현재 비용" value={e.cost}/><Metric label="사용 중인 모델" value={`• ${e.model}`} wide/></div><section className="output"><b>▯</b><div><label>최근 결과물</label><strong>{e.output}</strong><small>{e.outputMeta}</small></div></section>{view==="approval"&&e.status==="승인 대기"&&<section className="approval"><label>대표 승인 요청</label><div><button onClick={()=>resolve(true)}>승인</button><button onClick={()=>resolve(false)}>반려</button></div></section>}<section className="next"><div><label>다음 행동</label><strong>{e.next}</strong></div><span>→</span></section></div> }
function Metric({label,value,wide}:{label:string;value:string;wide?:boolean}){return <div className={`metric ${wide?"wide":""}`}><label>{label}</label><strong>{value}</strong></div>}
function Outputs({e}:{e:Employee}){return <div className="output-list">{[[e.output,e.outputMeta],["업무 진행 메모",`${e.started} 작성`],["참고 자료 묶음","파일 4개"]].map(([a,b])=><article key={a}><b>▯</b><div><strong>{a}</strong><small>{b}</small></div></article>)}</div>}
function timelineGroup(title:string, fallback:Group){ if(title.includes("Error")||title.includes("오류")) return "error"; if(title.includes("Approval")||title.includes("승인")) return "waiting"; if(title.includes("Meeting")||title.includes("회의")) return "meeting"; if(title.includes("완료")||title.includes("Resolved")) return "done"; return fallback; }
function eventPayloadText(entry:TimelineRecord,key:string){ const value=entry.event?.payload?.[key]; return typeof value==="string"?value:undefined; }
function Timeline({e,entries,dbTimeline,isLoading,error}:{e:Employee;entries:BGTimelineEntry[];dbTimeline:TimelineRecord[];isLoading:boolean;error:string|null}){const fallback:[[string,string,string],[string,string,string],[string,string,string],[string,string,string]]=[[e.started,"업무를 시작했습니다","done"],["14:02","초기 자료 분석을 마쳤습니다","done"],["14:18",e.task,e.group],["다음",e.next,"idle"]]; if(isLoading) return <div className="timeline"><article><i className="idle"/><time>DB</time><p>직원 타임라인을 불러오는 중입니다.</p></article></div>; if(dbTimeline.length>0) return <div className="timeline">{dbTimeline.map((entry)=><article key={entry.id}><i className={timelineGroup(entry.title,e.group)}/><time>{new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(entry.timestamp))}</time><p><strong>{entry.title}</strong> · {entry.description??eventPayloadText(entry,"title")??eventPayloadText(entry,"reason")??"DB timeline 기록"}{entry.event?.taskId?` · task:${entry.event.taskId}`:""}{entry.event?.approvalId?` · approval:${entry.event.approvalId}`:""}</p></article>)}</div>; if(entries.length>0) return <div className="timeline">{error?<article><i className="error"/><time>DB</time><p>DB timeline 조회 실패 · local fallback 표시 · {error}</p></article>:null}{entries.map((entry)=><article key={entry.id}><i className={entry.group}/><time>{new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(entry.timestamp))}</time><p><strong>{entry.eventType}</strong> · {entry.description}{entry.taskTitle?` · ${entry.taskTitle}`:""}</p></article>)}</div>; return <div className="timeline">{error?<article><i className="error"/><time>DB</time><p>DB timeline 조회 실패 · {error}</p></article>:fallback.map(([a,b,c])=><article key={`${a}${b}`}><i className={c}/><time>{a}</time><p>{b}</p></article>)}</div>}
function Avatar({e,small}:{e:Employee;small?:boolean}){return <b className={`avatar ${small?"small":""}`} data-dept={e.department} data-employee={e.id}><span>{e.initial}</span><i className={`dot ${e.group}`}/></b>}
