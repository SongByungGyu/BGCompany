"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBGCompanyEvent } from "@/features/events/bg-company-events";
import type { BGCompanyEvent } from "@/features/events/types";
import { useTimeline } from "@/features/timelines/useTimeline";
import type { TimelineRecord } from "@/features/timelines/api";
import { fetchApprovals, updateApprovalStatus } from "./api";
import { mockApprovals } from "./mock-approvals";
import type { ApprovalInboxProps, ApprovalRequest, ApprovalStatus } from "./approval-types";

const statusGroup: Record<ApprovalStatus, "waiting" | "done" | "error" | "working" | "idle"> = {
  "승인 대기": "waiting",
  "승인 완료": "done",
  "반려": "error",
  "수정 요청": "working",
  "보류": "idle",
};

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function payloadText(event: BGCompanyEvent, key: string) {
  const value = (event.payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function ApprovalInboxView({ employees, eventLog, onPublishEvent }: ApprovalInboxProps) {
  const [selectedApprovalId, setSelectedApprovalId] = useState(mockApprovals[0]?.id ?? "");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ApprovalStatus>>({});
  const [auditNotes, setAuditNotes] = useState<Record<string, string[]>>({});
  const [comment, setComment] = useState("");
  const [apiApprovals, setApiApprovals] = useState<ApprovalRequest[]>(mockApprovals);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState("DB 승인 요청 데이터를 표시 중입니다.");
  const [actionBusy, setActionBusy] = useState(false);

  const refreshApprovals = useCallback(async () => {
    try {
      const approvals = await fetchApprovals();
      setApiApprovals(approvals);
      setFetchError(null);
      setActionNotice("DB seed 승인 요청 데이터를 표시 중입니다.");
      setSelectedApprovalId((current) => approvals.some((approval) => approval.id === current) ? current : approvals[0]?.id ?? "");
      return approvals;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setApiApprovals(mockApprovals);
      setFetchError(message);
      setActionNotice("DB 승인 조회 실패 · Mock fallback을 표시 중입니다.");
      return mockApprovals;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => refreshApprovals())
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshApprovals]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const approvals = apiApprovals.map((approval) => ({ ...approval, status: statusOverrides[approval.id] ?? approval.status }));
  const selectedApproval = approvals.find((approval) => approval.id === selectedApprovalId) ?? approvals[0];
  const selectedEmployee = selectedApproval ? employeeById.get(selectedApproval.employeeId) : undefined;
  const approvalEvents = selectedApproval
    ? eventLog.filter((event) => event.taskId === selectedApproval.relatedTaskId || event.employeeId === selectedApproval.employeeId || payloadText(event, "approvalId") === selectedApproval.id).slice(0, 8)
    : [];
  const approvalTimeline = useTimeline(selectedApproval ? "approval" : undefined, selectedApproval?.id);
  const counts = {
    waiting: approvals.filter((approval) => approval.status === "승인 대기").length,
    done: approvals.filter((approval) => approval.status === "승인 완료").length,
    returned: approvals.filter((approval) => approval.status === "반려" || approval.status === "수정 요청").length,
    hold: approvals.filter((approval) => approval.status === "보류").length,
  };

  const appendAudit = (approvalId: string, note: string) => {
    setAuditNotes((prev) => ({ ...prev, [approvalId]: [`${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())} ${note}`, ...(prev[approvalId] ?? [])].slice(0, 8) }));
  };

  const handleAction = async (approval: ApprovalRequest, nextStatus: ApprovalStatus) => {
    if (actionBusy) return;
    setActionBusy(true);
    setStatusOverrides((prev) => ({ ...prev, [approval.id]: nextStatus }));
    appendAudit(approval.id, `${nextStatus} 처리 · ${comment || "코멘트 없음"}`);
    setActionNotice(`${nextStatus} 처리 중입니다.`);
    try {
      const updatedApproval = await updateApprovalStatus({ approvalId: approval.id, status: nextStatus, decisionReason: comment });
      setApiApprovals((prev) => prev.map((item) => item.id === updatedApproval.id ? updatedApproval : item));
      if (nextStatus === "승인 완료" || nextStatus === "반려") {
        await onPublishEvent(createBGCompanyEvent("ApprovalResolved", {
          employeeId: approval.employeeId,
          taskId: approval.relatedTaskId,
          payload: { title: approval.title, approved: nextStatus === "승인 완료", comment, approvalId: approval.id },
        }), true, false);
      } else if (nextStatus === "수정 요청") {
        await onPublishEvent(createBGCompanyEvent("EmployeeStatusChanged", {
          employeeId: approval.employeeId,
          taskId: approval.relatedTaskId,
          payload: { status: "수정 중", reason: comment || "승인함에서 수정 요청", approvalId: approval.id },
        }), true, false);
      } else {
        await onPublishEvent(createBGCompanyEvent("EmployeeStatusChanged", {
          employeeId: approval.employeeId,
          taskId: approval.relatedTaskId,
          payload: { status: "대기 중", reason: "승인 보류", approvalId: approval.id },
        }), true, false);
      }
      setStatusOverrides((prev) => { const next = { ...prev }; delete next[approval.id]; return next; });
      setActionNotice(`${nextStatus} 처리 결과가 DB에 저장되었습니다.`);
      setComment("");
      await refreshApprovals();
      await approvalTimeline.refresh();
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <section className="stage">
        <div className="feature-shell">
          <header className="feature-hero approval-hero">
            <div>
              <span>Phase 1-B</span>
              <h1>승인함</h1>
              <p>DB seed 승인 요청과 처리 결과 저장 흐름을 검증합니다.</p>
            </div>
            <div className="work-summary">
              <span className="waiting"><b>{counts.waiting}</b>대기</span>
              <span className="done"><b>{counts.done}</b>승인</span>
              <span className="error"><b>{counts.returned}</b>반려/수정</span>
              <span><b>{counts.hold}</b>보류</span>
            </div>
          </header>
          <div className="feature-toolbar approval-toolbar"><p>{isLoading ? "DB 승인 요청을 불러오는 중입니다." : fetchError ? `${actionNotice} (${fetchError})` : actionNotice}</p></div>
          {isLoading ? <div className="feature-empty">DB 승인 요청을 불러오는 중입니다.</div> : approvals.length === 0 ? <div className="feature-empty">표시할 승인 요청이 없습니다.</div> : <div className="approval-list">
            {approvals.map((approval) => {
              const employee = employeeById.get(approval.employeeId);
              const group = statusGroup[approval.status];
              return (
                <button key={approval.id} className={`approval-row ${selectedApproval?.id === approval.id ? "selected" : ""}`} onClick={() => setSelectedApprovalId(approval.id)}>
                  <div>
                    <span className={`badge compact ${group}`}><i className={`dot ${group}`} />{approval.status}</span>
                    <strong>{approval.title}</strong>
                    <small>{employee?.name ?? "미배정"} · {approval.type} · {approval.requestedAt} 요청</small>
                  </div>
                  <dl>
                    <div><dt>위험도</dt><dd className={approval.risk === "높음" ? "error" : ""}>{approval.risk}</dd></div>
                    <div><dt>비용</dt><dd>{approval.estimatedCost}</dd></div>
                    <div><dt>업무</dt><dd>{approval.relatedTaskId}</dd></div>
                  </dl>
                </button>
              );
            })}
          </div>}
        </div>
      </section>
      <aside className="panel feature-detail-panel">
        {selectedApproval ? (
          <>
            <div className="feature-panel-tabs">
              <strong>승인 상세</strong>
              <span>{selectedApproval.id}</span>
            </div>
            <div className="panel-body">
              <div className="feature-detail-head">
                <span className={`badge ${statusGroup[selectedApproval.status]}`}><i className={`dot ${statusGroup[selectedApproval.status]}`} />{selectedApproval.status}</span>
                <h2>{selectedApproval.title}</h2>
                <p>{selectedEmployee?.name ?? "미배정"} · {selectedApproval.type}</p>
              </div>
              <div className="feature-card">
                <label>요청 사유</label>
                <strong>{selectedApproval.reason}</strong>
              </div>
              <div className="feature-card">
                <label>실행 계획 / 기대 결과</label>
                <strong>{selectedApproval.plannedAction}</strong>
                <p>{selectedApproval.expectedResult}</p>
              </div>
              <div className="metrics">
                <div className="metric"><label>예상 비용</label><strong>{selectedApproval.estimatedCost}</strong></div>
                <div className="metric"><label>위험도</label><strong>{selectedApproval.risk}</strong></div>
                <div className="metric wide"><label>관련 업무</label><strong>{selectedApproval.relatedTaskId}</strong></div>
              </div>
              <div className="feature-card">
                <label>결과물</label>
                <strong>{selectedApproval.output}</strong>
              </div>
              <textarea className="approval-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="승인/반려/수정 요청 사유를 입력하세요." />
              <div className="feature-actions approval-actions">
                <button disabled={actionBusy} onClick={() => void handleAction(selectedApproval, "승인 완료")}>승인</button>
                <button disabled={actionBusy} onClick={() => void handleAction(selectedApproval, "반려")}>반려</button>
                <button disabled={actionBusy} onClick={() => void handleAction(selectedApproval, "수정 요청")}>수정 요청</button>
                <button disabled={actionBusy} onClick={() => void handleAction(selectedApproval, "보류")}>보류</button>
              </div>
              <div className="feature-card">
                <label>감사 로그</label>
                <ul className="audit-list">
                  {(auditNotes[selectedApproval.id] ?? []).map((note) => <li key={note}>{note}</li>)}
                  {approvalTimeline.isLoading ? <li>DB timeline을 불러오는 중입니다.</li> : null}
                  {approvalTimeline.error ? <li>DB timeline 조회 실패 · {approvalTimeline.error}</li> : null}
                  {approvalTimeline.timeline.map((entry) => <li key={entry.id}>{formatTime(entry.timestamp)} {entry.title} · {entry.description ?? "DB timeline 기록"}</li>)}
                  {approvalTimeline.timeline.length === 0 && !approvalTimeline.isLoading && !approvalTimeline.error ? approvalEvents.map((event) => <li key={event.id}>{formatTime(event.timestamp)} {event.type} · {payloadText(event, "title") ?? payloadText(event, "reason") ?? "Local 이벤트"}</li>) : null}
                  {(auditNotes[selectedApproval.id] ?? []).length === 0 && approvalTimeline.timeline.length === 0 && approvalEvents.length === 0 && !approvalTimeline.isLoading ? <li>아직 처리 로그가 없습니다.</li> : null}
                </ul>
              </div>
              <ApprovalTimelinePreview timeline={approvalTimeline.timeline} />
            </div>
          </>
        ) : (
          <div className="no-selection"><div><b>♙</b><strong>승인 요청을 선택하세요</strong><p>왼쪽 요청을 선택하면 승인 상세가 표시됩니다.</p></div></div>
        )}
      </aside>
    </>
  );
}

function ApprovalTimelinePreview({ timeline }: { timeline: TimelineRecord[] }) {
  if (timeline.length === 0) return null;
  return (
    <div className="timeline feature-timeline">
      {timeline.map((entry) => (
        <article key={entry.id}>
          <i className={entry.title.includes("반려") ? "error" : entry.title.includes("승인") ? "waiting" : "working"} />
          <time>{formatTime(entry.timestamp)}</time>
          <p><strong>{entry.title}</strong><br />{entry.description ?? "DB approval timeline"}</p>
        </article>
      ))}
    </div>
  );
}
