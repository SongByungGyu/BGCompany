"use client";

import { Canvas } from "@react-three/fiber";
import officeLayout from "@config/office-layout.json";
import { createConceptOfficeLayout } from "./conceptOfficeLayout";
import { OfficeScene } from "./OfficeScene";
import type { OfficeEmployee, OfficeLayout } from "./types";

const layout = createConceptOfficeLayout(officeLayout as unknown as OfficeLayout);
const showOfficeLabels = layout.office.labelsEnabled;

export default function OfficeCanvas({
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
      <Canvas
        dpr={[1, 1.5]}
        shadows
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <OfficeScene
          employees={employees}
          layout={layout}
          onSelectEmployee={onSelectEmployee}
          selectedEmployeeId={selectedEmployeeId}
          showLabels={showOfficeLabels}
        />
      </Canvas>
    </div>
  );
}
