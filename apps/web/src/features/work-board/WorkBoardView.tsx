"use client";

import { useMemo, useState } from "react";
import { createBGCompanyEvent } from "@/features/events/bg-company-events";
import type { BGCompanyEvent } from "@/features/events/types";
import { mockWorkTasks } from "./mock-tasks";
import type { WorkBoardProps, WorkTask, WorkTaskStatus } from "./work-board-types";

const filters: Array<"전체" | WorkTaskStatus> = ["전체", "진행 중", "승인 대기", "오류", "완료"];
const taskStatusGroup: Record<WorkTaskStatus, "working" | "waiting" | "error" | "done" | "idle"> = {
  "대기": "idle",
  "진행 중": "working",
  "승인 대기": "waiting",
  "오류": "error",
  "완료": "done",
};

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function payloadText(event: BGCompanyEvent, key: string) {
  const value = (event.payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function resolveTaskStatus(base: WorkTask, employeeStatus?: string): WorkTaskStatus {
  if (employeeStatus === "오류 대응 중") return "오류";
  if (employeeStatus === "승인 대기") return "승인 대기";
  if (employeeStatus === "업무 완료") return "완료";
  if (employeeStatus === "업무 종료" || employeeStatus === "대기 중") return base.status === "완료" ? "완료" : "대기";
  if (employeeStatus) return "진행 중";
  return base.status;
}

export function WorkBoardView({ employees, eventLog, onPublishEvent }: WorkBoardProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("전체");
  const [selectedTaskId, setSelectedTaskId] = useState(mockWorkTasks[0]?.id ?? "");
  const [notice, setNotice] = useState("업무 보드는 Mock 이벤트 기반으로 동작합니다.");

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const tasks = useMemo(() => mockWorkTasks.map((task) => {
    const employee = employeeById.get(task.assigneeId);
    const status = resolveTaskStatus(task, employee?.status);
    return {
      ...task,
      status,
      progress: employee?.progress ?? task.progress,
      model: employee?.model ?? task.model,
      cost: employee?.cost ?? task.cost,
      output: employee?.output ?? task.output,
      nextAction: employee?.next ?? task.nextAction,
      error: employee?.error ?? task.error,
    };
  }), [employeeById]);

  const visibleTasks = filter === "전체" ? tasks : tasks.filter((task) => task.status === filter);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0] ?? tasks[0];
  const selectedEmployee = selectedTask ? employeeById.get(selectedTask.assigneeId) : undefined;
  const taskEvents = selectedTask
    ? eventLog.filter((event) => event.taskId === selectedTask.id || event.employeeId === selectedTask.assigneeId).slice(0, 8)
    : [];
  const counts = {
    total: tasks.length,
    working: tasks.filter((task) => task.status === "진행 중").length,
    waiting: tasks.filter((task) => task.status === "승인 대기").length,
    error: tasks.filter((task) => task.status === "오류").length,
    done: tasks.filter((task) => task.status === "완료").length,
  };

  const publishTaskAction = (action: "pause" | "retry" | "cancel" | "log") => {
    if (!selectedTask) return;
    if (action === "log") {
      setNotice(`${selectedTask.title} 상세 로그를 Mock 콘솔에 기록했습니다.`);
      console.info("[BG Company] mock task log", selectedTask, taskEvents);
      return;
    }
    const eventMap = {
      pause: createBGCompanyEvent("EmployeeStatusChanged", {
        employeeId: selectedTask.assigneeId,
        taskId: selectedTask.id,
        payload: { status: "대기 중", reason: "업무 보드에서 일시정지" },
      }),
      retry: createBGCompanyEvent("TaskStarted", {
        employeeId: selectedTask.assigneeId,
        taskId: selectedTask.id,
        payload: { title: selectedTask.title, next: "재시도 후 결과 확인" },
      }),
      cancel: createBGCompanyEvent("EmployeeStatusChanged", {
        employeeId: selectedTask.assigneeId,
        taskId: selectedTask.id,
        payload: { status: "업무 종료", reason: "업무 보드에서 취소" },
      }),
    };
    onPublishEvent(eventMap[action], true);
    setNotice(`${selectedTask.title} · ${action === "pause" ? "일시정지" : action === "retry" ? "재시도" : "취소"} 이벤트를 발행했습니다.`);
  };

  return (
    <>
      <section className="stage">
        <div className="feature-shell">
          <header className="feature-hero">
            <div>
              <span>Phase 1-B</span>
              <h1>업무 보드</h1>
              <p>Mock 이벤트로 직원 상태, 업무 진행률, 승인/오류 흐름을 함께 검증합니다.</p>
            </div>
            <div className="work-summary">
              <span><b>{counts.total}</b>전체</span>
              <span><b>{counts.working}</b>진행</span>
              <span className="waiting"><b>{counts.waiting}</b>승인</span>
              <span className="error"><b>{counts.error}</b>오류</span>
              <span className="done"><b>{counts.done}</b>완료</span>
            </div>
          </header>
          <div className="feature-toolbar">
            <div className="filter-tabs">
              {filters.map((item) => (
                <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
              ))}
            </div>
            <p>{notice}</p>
          </div>
          {visibleTasks.length === 0 ? (
            <div className="feature-empty">현재 필터에 해당하는 업무가 없습니다.</div>
          ) : (
            <div className="task-board-list">
              {visibleTasks.map((task) => {
                const employee = employeeById.get(task.assigneeId);
                const group = taskStatusGroup[task.status];
                return (
                  <button key={task.id} className={`task-row ${selectedTask?.id === task.id ? "selected" : ""}`} onClick={() => setSelectedTaskId(task.id)}>
                    <div className="task-row-main">
                      <span className={`badge compact ${group}`}><i className={`dot ${group}`} />{task.status}</span>
                      <strong>{task.title}</strong>
                      <small>{employee?.name ?? "미배정"} · {task.department} · {task.model}</small>
                    </div>
                    <div className="task-row-progress">
                      <span><i style={{ width: `${task.progress}%` }} /></span>
                      <b>{task.progress}%</b>
                    </div>
                    <div className="task-row-meta">
                      <span>{task.started}</span>
                      <strong>{task.cost}</strong>
                      {task.approvalRequired ? <em>승인 필요</em> : null}
                      {task.error ? <em className="error">오류</em> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
      <aside className="panel feature-detail-panel">
        {selectedTask ? (
          <>
            <div className="feature-panel-tabs">
              <strong>업무 상세</strong>
              <span>{selectedTask.id}</span>
            </div>
            <div className="panel-body">
              <div className="feature-detail-head">
                <span className={`badge ${taskStatusGroup[selectedTask.status]}`}><i className={`dot ${taskStatusGroup[selectedTask.status]}`} />{selectedTask.status}</span>
                <h2>{selectedTask.title}</h2>
                <p>{selectedEmployee?.name ?? "미배정"} · {selectedTask.department}</p>
              </div>
              <div className="task feature-card">
                <label>목적</label>
                <strong>{selectedTask.purpose}</strong>
                <div><span><i style={{ width: `${selectedTask.progress}%` }} /></span><b>{selectedTask.progress}%</b></div>
              </div>
              <div className="feature-card">
                <label>현재 단계</label>
                <strong>{selectedTask.currentStep}</strong>
                <ul className="step-list">
                  {selectedTask.steps.map((step) => <li key={step.label} className={step.done ? "done" : ""}>{step.label}</li>)}
                </ul>
              </div>
              <div className="metrics">
                <div className="metric"><label>시작</label><strong>{selectedTask.started}</strong></div>
                <div className="metric"><label>비용</label><strong>{selectedTask.cost}</strong></div>
                <div className="metric wide"><label>모델</label><strong>{selectedTask.model}</strong></div>
              </div>
              {selectedTask.error ? <div className="error-banner"><span>⚠</span><div><strong>오류 로그</strong><p>{selectedTask.error}</p></div></div> : null}
              <div className="feature-card">
                <label>결과물 / 다음 행동</label>
                <strong>{selectedTask.output ?? "아직 생성된 결과물이 없습니다."}</strong>
                <p>{selectedTask.nextAction}</p>
              </div>
              <div className="feature-actions">
                <button onClick={() => publishTaskAction("pause")}>일시정지</button>
                <button onClick={() => publishTaskAction("retry")}>재시도</button>
                <button onClick={() => publishTaskAction("cancel")}>취소</button>
                <button onClick={() => publishTaskAction("log")}>상세 로그</button>
              </div>
              <TimelinePreview events={taskEvents} fallback="아직 이 업무에 연결된 Mock 이벤트가 없습니다." />
            </div>
          </>
        ) : (
          <div className="no-selection"><div><b>▣</b><strong>업무를 선택하세요</strong><p>왼쪽 업무 목록을 선택하면 상세 정보가 표시됩니다.</p></div></div>
        )}
      </aside>
    </>
  );
}

function TimelinePreview({ events, fallback }: { events: BGCompanyEvent[]; fallback: string }) {
  if (events.length === 0) return <div className="feature-card muted"><label>타임라인</label><p>{fallback}</p></div>;
  return (
    <div className="timeline feature-timeline">
      {events.map((event) => (
        <article key={event.id}>
          <i className={event.type.includes("Error") ? "error" : event.type.includes("Approval") ? "waiting" : event.type.includes("Meeting") ? "meeting" : "working"} />
          <time>{formatTime(event.timestamp)}</time>
          <p><strong>{event.type}</strong><br />{payloadText(event, "title") ?? payloadText(event, "meetingTitle") ?? payloadText(event, "reason") ?? "Mock 이벤트 기록"}</p>
        </article>
      ))}
    </div>
  );
}
