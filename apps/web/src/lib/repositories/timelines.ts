import { prisma } from "@/lib/db";
import { serializeTimeline } from "./serializers";

const supportedTargetTypes = new Set(["task", "approval", "employee", "global", "system"]);

function normalizeTargetType(targetType?: string | null) {
  if (!targetType) return undefined;
  if (targetType === "global") return ["global", "system"];
  if (supportedTargetTypes.has(targetType)) return [targetType];
  throw new Error(`Unsupported timeline targetType: ${targetType}`);
}

export async function listTimelines(targetType?: string | null, targetId?: string | null) {
  const normalizedTargetTypes = normalizeTargetType(targetType);
  const timelines = await prisma.timeline.findMany({
    where: normalizedTargetTypes ? {
      targetType: { in: normalizedTargetTypes },
      ...(targetId ? { targetId } : {}),
    } : undefined,
    include: { event: true },
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  return timelines.map(serializeTimeline);
}
