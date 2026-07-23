export type OperationsHealth = "healthy" | "warning" | "critical" | "info" | "idle";

export type OperationsMetric = {
  label: string;
  value: string;
  note: string;
  tone: OperationsHealth;
};

export type OperationsListItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: OperationsHealth;
  href?: string | null;
};

export type OperationsService = {
  id: string;
  name: string;
  status: OperationsHealth;
  label: string;
  detail: string;
  checkedAt: string;
};

export type OperationsCostBreakdown = {
  id: string;
  label: string;
  amount: number;
  detail: string;
};

export type OperationsOverview = {
  ok: true;
  generatedAt: string;
  report: {
    date: string;
    headline: string;
    summary: string;
    metrics: OperationsMetric[];
    highlights: OperationsListItem[];
    openItems: OperationsListItem[];
  };
  development: {
    overallStatus: OperationsHealth;
    headline: string;
    services: OperationsService[];
    incidents: OperationsListItem[];
    recentRuns: OperationsListItem[];
  };
  finance: {
    headline: string;
    currency: "USD";
    metrics: OperationsMetric[];
    departmentCosts: OperationsCostBreakdown[];
    employeeCosts: OperationsCostBreakdown[];
    hermesUsed: number;
    hermesLimit: number;
    note: string;
  };
};
