import { prisma } from "@/lib/db";
import { serializeTimeline } from "./serializers";

export async function listTimelines(targetType?: string | null, targetId?: string | null) {
  const timelines = await prisma.timeline.findMany({
    where: targetType && targetId ? { targetType, targetId } : undefined,
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  return timelines.map(serializeTimeline);
}
