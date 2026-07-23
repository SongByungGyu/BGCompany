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

export type DashboardEmployeeActivity = {
  id: string;
  employeeId: string | null;
  employeeName: string;
  employeeRole: string | null;
  taskTitle: string;
  status: string;
  statusLabel: string;
  severity: DashboardSummarySeverity;
  detail: string;
  source: "Task" | "AgentRun";
  mode: string | null;
  occurredAt: string;
};

export type DashboardSummary = {
  ok: true;
  generatedAt: string;
  headline: string;
  briefing: string;
  cards: DashboardSummaryCard[];
  activeWork: DashboardEmployeeActivity[];
  recentAgentActivity: DashboardEmployeeActivity[];
  nextActions: string[];
  metrics: { activeTasks: number; waitingApprovals: number; errorTasks: number; naverDraftPending: number; hermesUsed: number; hermesLimit: number; hermesRemaining: number };
  stockBlogSchedule: StockBlogScheduleItem[];
  stockBlogScheduler: StockBlogSchedulerStatus;
};
