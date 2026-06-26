import type { ApprovalRequest, ApprovalStatus } from "./approval-types";
import { mapApprovalRecordToApprovalRequest, type ApprovalRecord } from "./mappers";

export async function fetchApprovals(): Promise<ApprovalRequest[]> {
  const response = await fetch("/api/approvals", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch approvals: ${response.status}`);
  const data = await response.json() as { approvals?: ApprovalRecord[] };
  return (data.approvals ?? []).map(mapApprovalRecordToApprovalRequest);
}

export async function updateApprovalStatus(input: {
  approvalId: string;
  status: ApprovalStatus;
  decisionReason?: string;
}): Promise<ApprovalRequest> {
  const response = await fetch(`/api/approvals/${input.approvalId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Failed to update approval: ${response.status}`);
  const data = await response.json() as { approval?: ApprovalRecord };
  if (!data.approval) throw new Error("approval response is empty");
  return mapApprovalRecordToApprovalRequest(data.approval);
}
