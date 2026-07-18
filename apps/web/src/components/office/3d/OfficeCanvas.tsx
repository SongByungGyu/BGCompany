"use client";

import officeLayout from "@config/office-layout.json";
import { memo } from "react";
import { createConceptOfficeLayout } from "./conceptOfficeLayout";
import { OfficeHybridScene } from "./OfficeHybridScene";
import type { OfficeEmployee, OfficeLayout } from "./types";

const layout = createConceptOfficeLayout(officeLayout as unknown as OfficeLayout);

function OfficeCanvas({
  employees,
  onSelectEmployee,
  selectedEmployeeId,
}: {
  employees: OfficeEmployee[];
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployeeId: string | null;
}) {
  return (
    <div className="office-canvas" data-testid="office-canvas">
      <OfficeHybridScene
        employees={employees}
        layout={layout}
        onSelectEmployee={onSelectEmployee}
        selectedEmployeeId={selectedEmployeeId}
      />
    </div>
  );
}

export default memo(OfficeCanvas);
