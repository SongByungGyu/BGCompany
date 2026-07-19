import { Environment, Lightformer } from "@react-three/drei";
import { OfficeCamera } from "./OfficeCamera";
import { OfficeArchitecture } from "./OfficeArchitecture";
import { ConceptOfficeFurniture } from "./ConceptOfficeFurniture";
import { OfficeEmployees } from "./OfficeEmployees";
import { OfficeFloor } from "./OfficeFloor";
import { OfficeFlowPaths } from "./OfficeFlowPaths";
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
      <color attach="background" args={["#030B16"]} />
      <fog attach="fog" args={["#030B16", 82, 148]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#E2F1FF", "#091522", 1.04]} />
      <directionalLight
        castShadow
        intensity={2.48}
        position={[-12, 24, 14]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <Environment resolution={128} background={false}>
        <Lightformer form="rect" intensity={2.7} color="#E3F0FF" position={[-2, 20, 3]} scale={[20, 6, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.45} color="#42E2D1" position={[-19, 8, 1]} scale={[3, 13, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.25} color="#E9B75B" position={[19, 7, -3]} scale={[3, 11, 1]} rotation-y={-Math.PI / 2} />
      </Environment>
      <OfficeCamera layout={layout} />
      <group>
        <OfficeFloor layout={layout} />
        <OfficeRooms layout={layout} />
        <OfficeArchitecture layout={layout} />
        <OfficeWalls layout={layout} />
        <ConceptOfficeFurniture />
        <OfficeFlowPaths />
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
