"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createBGCompanyEventBus } from "@/features/events/event-bus";
import { appendTimelineEntry, reduceEmployeesByEvent } from "@/features/events/event-reducer";
import { createMockScenarioSteps, mockScenarioDefinitions, type MockScenarioDefinition } from "@/features/events/mock-scenarios";
import type { BGCompanyEvent, BGTimelineEntry } from "@/features/events/types";
import { WorkBoardView } from "@/features/work-board/WorkBoardView";
import { ApprovalInboxView } from "@/features/approvals/ApprovalInboxView";

const OfficeCanvas = dynamic(
  () => import("@/components/office/3d/OfficeCanvas"),
  { ssr: false },
);

type View = "selected" | "unselected" | "approval" | "error" | "empty" | "loading";
type Tab = "summary" | "outputs" | "timeline";
type Group = "working" | "meeting" | "waiting" | "error" | "done" | "idle";
type EmployeeStatus = "대기 중" | "업무 중" | "조사 중" | "회의 중" | "검토 중" | "결과 대기" | "승인 대기" | "수정 중" | "보고 중" | "오류 대응 중" | "업무 완료" | "휴식 중" | "업무 종료";
type Employee = {
  id: string; name: string; initial: string; department: string; status: EmployeeStatus;
  group: Group; task: string; progress: number; started: string; model: string;
  cost: string; output: string; outputMeta: string; next: string; error?: string;
};

declare global { interface Window { __bgSetView?: (view: View) => void } }

const initialEmployees: Employee[] = [
  { id:"content-planner",name:"미나",initial:"미",department:"콘텐츠팀",status:"업무 중",group:"working",task:"블로그 포스트 「6월 루틴 정리」 초안 작성",progress:68,started:"13:50",model:"Claude Opus 4.6",cost:"$0.82",output:"초안 v2 · 1,240자",outputMeta:"14:21 저장됨",next:"제목 A/B안 생성" },
  { id:"finance-manager",name:"도윤",initial:"도",department:"재정팀",status:"업무 중",group:"working",task:"6월 운영비 정산 및 현금흐름 검토",progress:54,started:"13:42",model:"GPT-5.1",cost:"$0.58",output:"주간 비용 요약",outputMeta:"14:18 저장됨",next:"비용 이상치 검토" },
  { id:"stock-monitor",name:"서준",initial:"서",department:"주식팀",status:"조사 중",group:"waiting",task:"관심 종목 장중 변동 모니터링",progress:42,started:"13:28",model:"Claude Sonnet 4.6",cost:"$0.37",output:"변동성 감지 리포트",outputMeta:"14:12 저장됨",next:"대표 보고 준비" },
  { id:"developer",name:"하늘",initial:"하",department:"개발팀",status:"오류 대응 중",group:"error",task:"배포 파이프라인 빌드 오류 수정",progress:30,started:"14:18",model:"GPT-5.1 Codex",cost:"$0.46",output:"에러 로그 분석",outputMeta:"14:24 진행 중",next:"핫픽스 PR 생성",error:"빌드 단계 exit code 1 · 14:21 감지, 자동 재시도 1회 실패." },
  { id:"qa-auditor",name:"윤아",initial:"윤",department:"지식·감사",status:"회의 중",group:"meeting",task:"Phase 1-A 품질 기준 검토",progress:76,started:"13:20",model:"Claude Opus 4.6",cost:"$0.69",output:"QA 체크리스트 v3",outputMeta:"14:05 저장됨",next:"디자인 오차 보고" },
  { id:"marketing-manager",name:"카이",initial:"카",department:"콘텐츠팀",status:"승인 대기",group:"waiting",task:"유튜브 썸네일 3종 검수 요청",progress:100,started:"13:35",model:"Claude Opus 4.6",cost:"$0.61",output:"썸네일 3종",outputMeta:"승인 대기",next:"대표 승인 필요" },
  { id:"director",name:"루나",initial:"루",department:"대표실",status:"대기 중",group:"idle",task:"전체 회사 업무 현황 대기",progress:0,started:"09:00",model:"Claude Opus 4.6",cost:"$0.74",output:"오전 경영 브리핑",outputMeta:"09:30 저장됨",next:"다음 경영 판단 대기" },
];

const nav = [["⌂","대표실"],["◇","가상 오피스"],["▣","업무 보드"],["♙","승인함"],["✎","콘텐츠"],["▤","재정"],["⌁","주식"],["‹›","개발"],["□","지식관리"],["◉","감사·품질"],["▧","보고서"]];
const legend: [Group,string][] = [["working","업무 중"],["meeting","회의 중"],["waiting","승인 대기"],["error","오류 대응"],["done","업무 완료"],["idle","대기·휴식"]];
const SHOW_EMPLOYEE_MOVEMENT_DEV_PANEL = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SHOW_MOVEMENT_TEST_PANEL === "true";
const SHOW_MOCK_EVENT_SCENARIO_PANEL = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SHOW_MOCK_EVENT_PANEL === "true";
const employeeStatusOptions: EmployeeStatus[] = ["대기 중","업무 중","조사 중","회의 중","검토 중","결과 대기","승인 대기","수정 중","보고 중","오류 대응 중","업무 완료","휴식 중","업무 종료"];
type MovementTestScenario = { label: string; steps: [string, EmployeeStatus][] };
const movementTestScenarios: MovementTestScenario[] = [
  { label: "콘텐츠 회의", steps: [["content-planner","회의 중"],["qa-auditor","회의 중"],["finance-manager","회의 중"]] },
  { label: "승인 요청", steps: [["marketing-manager","승인 대기"],["director","보고 중"]] },
  { label: "오류 대응", steps: [["developer","오류 대응 중"],["finance-manager","조사 중"]] },
  { label: "휴식", steps: [["stock-monitor","휴식 중"],["content-planner","휴식 중"]] },
];
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
  const [clock,setClock] = useState("");
  const [employees,setEmployees] = useState(initialEmployees);
  const [eventLog,setEventLog] = useState<BGCompanyEvent[]>([]);
  const [timelineByEmployeeId,setTimelineByEmployeeId] = useState<Record<string, BGTimelineEntry[]>>({});
  const eventBusRef = useRef(createBGCompanyEventBus());
  const scenarioTimerIdsRef = useRef<number[]>([]);
  const [devEmployeeId,setDevEmployeeId] = useState(initialEmployees[0].id);
  const [devStatus,setDevStatus] = useState<EmployeeStatus>("회의 중");
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
  const current=employees[selected], approvals=employees.filter(e=>e.status==="승인 대기").length, errors=employees.filter(e=>e.group==="error").length, working=employees.filter(e=>["working","meeting"].includes(e.group)).length;
  const kpis=useMemo(()=>[["업무 중",String(working),""],["진행 중 업무","12",""],["승인 대기",String(approvals),"waiting"],["오류",String(errors),"error"],["오늘 AI 비용","$4.20",""],["이번 달","$86.40",""]],[approvals,errors,working]);
  const choose=(i:number)=>{ if(selected===i&&view!=="unselected"){setView("unselected");return} setSelected(i);setTab("summary");setView(employees[i].status==="승인 대기"?"approval":employees[i].group==="error"?"error":"selected"); };
  const chooseEmployeeById = (employeeId: string) => {
    const index = employees.findIndex((employee) => employee.id === employeeId);
    if (index >= 0) choose(index);
  };
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

  return <main className="control-room">
    <header className="top-bar"><div className="brand"><b>✦</b><strong>BG Company</strong><span>가상 회사 관제</span></div><div className="clock"><i/>{clock}</div><div className="kpis">{kpis.map(([label,value,kind])=><button key={label} className={kind} disabled={!kind||value==="0"} onClick={()=>kind==="error"?(setActiveNav("가상 오피스"),setDemoView("error")):kind==="waiting"?setActiveNav("승인함"):null}><span>{label}</span><strong>{value}</strong></button>)}<button className="gear">⚙</button>{view==="loading"&&<i className="kpi-loading"/>}</div></header>
    <div className="workspace">
      <nav className="left-nav">{nav.map(([icon,label])=><button key={label} className={activeNav===label?"active":""} onClick={()=>setActiveNav(label)}><b>{icon}</b><span>{label}</span>{label==="승인함"&&approvals>0&&<i>{approvals}</i>}</button>)}</nav>
      {activeNav==="가상 오피스" ? (
        <>
          <section className="stage">
            <div className="viewport">
              <OfficeViewportStatusBar/>
              <div className="office-canvas-wrap">
                <div className="controls"><button>⌕</button><button>⛶</button><button>◇</button></div>
                {view==="error"&&<div className="toast"><span>⚠</span><strong>개발팀 · 하늘 — 배포 파이프라인 오류 대응 중</strong><button onClick={()=>setDemoView("error")}>상세 보기</button></div>}
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
          <Panel view={view} employee={current} tab={tab} setTab={setTab} close={()=>setView("unselected")} resolve={resolve} timelineEntries={timelineByEmployeeId[current?.id] ?? []}/>
        </>
      ) : activeNav==="업무 보드" ? (
        <WorkBoardView employees={employees} eventLog={eventLog} onPublishEvent={publishBGEvent}/>
      ) : activeNav==="승인함" ? (
        <ApprovalInboxView employees={employees} eventLog={eventLog} onPublishEvent={publishBGEvent}/>
      ) : (
        <PlaceholderWorkspace label={activeNav}/>
      )}
    </div>
  </main>
}

function OfficeViewportStatusBar(){ return <div className="office-viewport-status-bar"><strong>상태 범례</strong><div>{legend.map(([group,label])=><span key={group}><i className={`dot ${group}`}/>{label}</span>)}</div></div> }
function PlaceholderWorkspace({label}:{label:string}){ return <><section className="stage"><div className="feature-shell placeholder-feature"><strong>{label}</strong><p>이 메뉴는 Phase 1-B 이후 단계에서 연결됩니다. 현재는 가상 오피스, 업무 보드, 승인함을 우선 검증합니다.</p></div></section><aside className="panel no-selection"><div><b>□</b><strong>{label}</strong><p>아직 상세 패널이 준비되지 않았습니다.</p></div></aside></> }
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
function Panel({view,employee,tab,setTab,close,resolve,timelineEntries}:{view:View;employee:Employee;tab:Tab;setTab:(t:Tab)=>void;close:()=>void;resolve:(a:boolean)=>void;timelineEntries:BGTimelineEntry[]}){ if(view==="loading") return <aside className="panel skeleton"><i/><div><b/><span><i/><i/></span></div><i/><i className="tall"/><section><i/><i/></section><i/></aside>; if(view==="empty"||view==="unselected") return <aside className="panel no-selection"><div><b>♙</b><strong>{view==="empty"?"선택할 직원이 없습니다":"직원을 선택하세요"}</strong><p>{view==="empty"?"직원이 채용되면 이곳에서 상세 정보를 확인할 수 있습니다.":"하단 직원 도크에서 직원을 클릭하면 현재 업무와 상세 정보가 여기에 표시됩니다."}</p></div></aside>; return <aside className="panel"><div className="tabs">{(["summary","outputs","timeline"] as Tab[]).map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t==="summary"?"요약":t==="outputs"?"결과물":"타임라인"}</button>)}<button className="close" onClick={close}>×</button></div><div className="panel-body"><div className="profile"><Avatar e={employee}/><div><h2>{employee.name}</h2><p>{employee.department} · AI 에이전트</p></div></div><span className={`badge ${employee.group}`}><i className={`dot ${employee.group}`}/>{employee.status}</span>{tab==="summary"?<Summary e={employee} view={view} resolve={resolve}/>:tab==="outputs"?<Outputs e={employee}/>:<Timeline e={employee} entries={timelineEntries}/>}</div></aside> }
function Summary({e,view,resolve}:{e:Employee;view:View;resolve:(a:boolean)=>void}){ return <div className="panel-stack">{view==="error"&&e.error&&<div className="error-banner"><span>⚠</span><div><strong>오류가 발생했습니다</strong><p>{e.error}</p></div></div>}<section className="task"><label>현재 업무</label><strong>{e.task}</strong><div><span><i className={e.group} style={{width:`${e.progress}%`}}/></span><b>{e.progress}%</b></div></section><div className="metrics"><Metric label="시작 시각" value={e.started}/><Metric label="현재 비용" value={e.cost}/><Metric label="사용 중인 모델" value={`• ${e.model}`} wide/></div><section className="output"><b>▯</b><div><label>최근 결과물</label><strong>{e.output}</strong><small>{e.outputMeta}</small></div></section>{view==="approval"&&e.status==="승인 대기"&&<section className="approval"><label>대표 승인 요청</label><div><button onClick={()=>resolve(true)}>승인</button><button onClick={()=>resolve(false)}>반려</button></div></section>}<section className="next"><div><label>다음 행동</label><strong>{e.next}</strong></div><span>→</span></section></div> }
function Metric({label,value,wide}:{label:string;value:string;wide?:boolean}){return <div className={`metric ${wide?"wide":""}`}><label>{label}</label><strong>{value}</strong></div>}
function Outputs({e}:{e:Employee}){return <div className="output-list">{[[e.output,e.outputMeta],["업무 진행 메모",`${e.started} 작성`],["참고 자료 묶음","파일 4개"]].map(([a,b])=><article key={a}><b>▯</b><div><strong>{a}</strong><small>{b}</small></div></article>)}</div>}
function Timeline({e,entries}:{e:Employee;entries:BGTimelineEntry[]}){const fallback:[[string,string,string],[string,string,string],[string,string,string],[string,string,string]]=[[e.started,"업무를 시작했습니다","done"],["14:02","초기 자료 분석을 마쳤습니다","done"],["14:18",e.task,e.group],["다음",e.next,"idle"]];return <div className="timeline">{entries.length>0?entries.map((entry)=><article key={entry.id}><i className={entry.group}/><time>{new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(entry.timestamp))}</time><p><strong>{entry.eventType}</strong> · {entry.description}{entry.taskTitle?` · ${entry.taskTitle}`:""}</p></article>):fallback.map(([a,b,c])=><article key={`${a}${b}`}><i className={c}/><time>{a}</time><p>{b}</p></article>)}</div>}
function Avatar({e,small}:{e:Employee;small?:boolean}){return <b className={`avatar ${small?"small":""}`} data-dept={e.department}>{e.initial}<i className={`dot ${e.group}`}/></b>}
