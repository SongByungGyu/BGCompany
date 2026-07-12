import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { OfficeCamera } from "./OfficeCamera";
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
      <color attach="background" args={["#071426"]} />
      <fog attach="fog" args={["#071426", 76, 138]} />
      <ambientLight intensity={0.92} />
      <hemisphereLight args={["#DCEBFF", "#14253D", 1.12]} />
      <directionalLight
        castShadow
        intensity={2.9}
        position={[10, 22, 14]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <Environment resolution={128} background={false}>
        <Lightformer form="rect" intensity={2.4} color="#DDEBFF" position={[0, 18, 2]} scale={[18, 5, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.3} color="#44D9D0" position={[-18, 7, 3]} scale={[3, 12, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.1} color="#F0B75D" position={[18, 5, -2]} scale={[3, 9, 1]} rotation-y={-Math.PI / 2} />
      </Environment>
      <OfficeCamera layout={layout} />
      <group>
        <OfficeFloor layout={layout} />
        <OfficeRooms layout={layout} />
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
      <ContactShadows
        position={[0, 0.035, 0]}
        scale={38}
        opacity={0.42}
        blur={2.3}
        far={10}
        resolution={512}
        color="#010817"
      />
    </>
  );
}
