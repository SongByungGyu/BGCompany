import type { StockBlogScheduleItem } from "@/lib/stock-blog/stock-blog-workflow";
import type { StockBlogSchedulerStatus } from "@/lib/stock-blog/stock-blog-scheduler";

export type DashboardSummarySeverity = "good" | "info" | "warning" | "critical";

export type DashboardSummaryCard = {
  id: string;
  title: string;
  value: string;
  description: string;
  severity: DashboardSummarySeverity;
  actionLabel?: string;
};

export type DashboardSummary = {
  ok: true;
  generatedAt: string;
  headline: string;
  briefing: string;
  cards: DashboardSummaryCard[];
  nextActions: string[];
  metrics: { activeTasks: number; waitingApprovals: number; errorTasks: number; naverDraftPending: number; hermesUsed: number; hermesLimit: number; hermesRemaining: number };
  stockBlogSchedule: StockBlogScheduleItem[];
  stockBlogScheduler: StockBlogSchedulerStatus;
};
