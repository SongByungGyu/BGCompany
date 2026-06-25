import { OfficeCamera } from "./OfficeCamera";
import { OfficeEmployees } from "./OfficeEmployees";
import { OfficeFloor } from "./OfficeFloor";
import { OfficeFurniture } from "./OfficeFurniture";
import { OfficeLabels } from "./OfficeLabels";
import { OfficeNavigationDebug } from "./OfficeNavigationDebug";
import { OfficeRooms } from "./OfficeRooms";
import { OfficeWalls } from "./OfficeWalls";
import type { OfficeEmployee, OfficeLayout } from "./types";

export function OfficeScene({
  employees,
  layout,
  onSelectEmployee,
  selectedEmployeeId,
  showLabels,
}: {
  employees: OfficeEmployee[];
  layout: OfficeLayout;
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployeeId: string | null;
  showLabels: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#F7F3EC"]} />
      <fog attach="fog" args={["#F7F3EC", 80, 140]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#FFF7E9", "#9AAFC8", 0.95]} />
      <directionalLight
        castShadow
        intensity={2.65}
        position={[10, 22, 14]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <OfficeCamera layout={layout} />
      <group>
        <OfficeFloor layout={layout} />
        <OfficeRooms layout={layout} />
        <OfficeWalls layout={layout} />
        <OfficeFurniture layout={layout} />
        <OfficeEmployees
          employees={employees}
          layout={layout}
          onSelectEmployee={onSelectEmployee}
          selectedEmployeeId={selectedEmployeeId}
        />
        <OfficeNavigationDebug layout={layout} />
        <OfficeLabels layout={layout} enabled={showLabels} />
      </group>
    </>
  );
}
