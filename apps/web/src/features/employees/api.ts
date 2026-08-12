import type { WorkBoardEmployee } from "@/features/work-board/work-board-types";

export type EmployeeRecord = {
  id: string;
  displayName: string;
  initial: string;
  department: string;
  role: string;
  status: WorkBoardEmployee["status"];
  currentTaskId: string | null;
  currentLocation: string | null;
  model: string | null;
  currentCost: string | null;
  currentTask: null | {
    id: string;
    title: string;
    description: string | null;
    department: string;
    assignedEmployeeId: string | null;
    status: string;
    progress: number;
    startedAt: string | null;
    completedAt: string | null;
    model: string | null;
    cost: string | null;
    currentStep: string | null;
    recentOutput: string | null;
    nextAction: string | null;
    error: string | null;
  };
};

export async function fetchEmployees(): Promise<EmployeeRecord[]> {
  const response = await fetch("/api/employees", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch employees: ${response.status}`);
  const data = await response.json() as { employees?: EmployeeRecord[] };
  return data.employees ?? [];
}
