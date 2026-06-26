import { prisma } from "@/lib/db";
import { serializeApproval } from "./serializers";

export async function listApprovals() {
  const approvals = await prisma.approvalRequest.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return approvals.map(serializeApproval);
}
