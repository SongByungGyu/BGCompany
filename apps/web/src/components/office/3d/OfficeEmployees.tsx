import { Html } from "@react-three/drei";
import type { OfficeEmployee, OfficeLayout, Vec3 } from "./types";

type EmployeeLocation = {
  employeeId: string;
  destinationId: string;
  position: Vec3;
};

const employeeBaseDestinationMap: Record<string, string> = {
  director: "director-desk",
  "content-planner": "content-desk-01",
  "marketing-manager": "content-desk-02",
  developer: "dev-desk-01",
  "finance-manager": "finance-desk-01",
  "stock-monitor": "stock-desk-01",
  "qa-auditor": "audit-desk-01",
};

const meetingSeatMap: Record<string, string> = {
  director: "meeting-seat-01",
  "content-planner": "meeting-seat-02",
  "marketing-manager": "meeting-seat-03",
  developer: "meeting-seat-04",
  "finance-manager": "meeting-seat-05",
  "stock-monitor": "meeting-seat-06",
  "qa-auditor": "meeting-seat-05",
};

const destinationOffsets: Record<string, Vec3> = {
  "director-desk": [0, 0, 0.72],
  "content-desk-01": [0, 0, 0.62],
  "content-desk-02": [0, 0, 0.62],
  "dev-desk-01": [0.64, 0, 0.12],
  "finance-desk-01": [0.58, 0, 0.1],
  "stock-desk-01": [0, 0, 0.62],
  "audit-desk-01": [0.54, 0, 0.1],
  "approval-wait-point": [0, 0, 0.1],
  "director-report-point": [0, 0, 0.08],
  "error-response-point": [0.32, 0, 0.1],
  "knowledge-search-point": [0, 0, 0.1],
  "lobby-center": [0, 0, 0],
  "break-seat-01": [0, 0, 0],
  "coffee-machine-point": [0.12, 0, 0.2],
  "entrance-point": [0, 0, -0.1],
};

const departmentColors: Record<string, string> = {
  "대표실": "#4F7DDE",
  "콘텐츠팀": "#E690A6",
  "재정팀": "#3FB6A6",
  "주식팀": "#D9A23E",
  "개발팀": "#6E97E0",
  "지식·감사": "#9B86DB",
};

const statusColors: Record<string, string> = {
  working: "#2FB5A7",
  meeting: "#8B6EDC",
  waiting: "#D99A1E",
  error: "#EB6844",
  done: "#35A772",
  idle: "#7B8794",
};

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function buildDestinationMap(layout: OfficeLayout) {
  const map = new Map<string, Vec3>();

  layout.destinations.forEach((destination) => {
    map.set(destination.id, destination.position);
  });

  layout.furniture?.desks.forEach((desk) => {
    map.set(desk.id, desk.position);
  });

  return map;
}

function getStatusDestinationId(employee: OfficeEmployee) {
  const baseDestinationId = employeeBaseDestinationMap[employee.id] ?? "lobby-center";

  switch (employee.status) {
    case "대기 중":
    case "업무 중":
    case "결과 대기":
    case "수정 중":
    case "업무 완료":
      return baseDestinationId;
    case "조사 중":
      return "knowledge-search-point";
    case "회의 중":
      return meetingSeatMap[employee.id] ?? "meeting-seat-01";
    case "검토 중":
      return "secretary-reception-point";
    case "승인 대기":
      return "approval-wait-point";
    case "보고 중":
      return "director-report-point";
    case "오류 대응 중":
      return "error-response-point";
    case "휴식 중":
      return employee.id === "director" ? "break-seat-02" : "break-seat-01";
    case "업무 종료":
      return "entrance-point";
    default:
      return baseDestinationId;
  }
}

function getEmployeeLocations(layout: OfficeLayout, employees: OfficeEmployee[]) {
  const destinationMap = buildDestinationMap(layout);

  return employees.map((employee): EmployeeLocation => {
    const destinationId = getStatusDestinationId(employee);
    const fallbackDestinationId = employeeBaseDestinationMap[employee.id] ?? "lobby-center";
    const basePosition =
      destinationMap.get(destinationId) ??
      destinationMap.get(fallbackDestinationId) ??
      ([0, 0, 0] as Vec3);
    const offset = destinationOffsets[destinationId] ?? destinationOffsets[fallbackDestinationId] ?? ([0, 0, 0] as Vec3);

    return {
      employeeId: employee.id,
      destinationId,
      position: addVec3(basePosition, offset),
    };
  });
}

function EmployeeAvatar3D({
  employee,
  location,
  selected,
  onSelect,
}: {
  employee: OfficeEmployee;
  location: EmployeeLocation;
  selected: boolean;
  onSelect: (employeeId: string) => void;
}) {
  const color = departmentColors[employee.department] ?? "#6E97E0";
  const statusColor = statusColors[employee.group] ?? "#7B8794";
  const [x, , z] = location.position;
  const scale = selected ? 1.22 : 1;

  return (
    <group
      position={[x, 0.08, z]}
      scale={[scale, scale, scale]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(employee.id);
      }}
    >
      <mesh receiveShadow position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color={selected ? "#4F7DDE" : "#2F4058"} opacity={selected ? 0.3 : 0.12} transparent />
      </mesh>

      {selected ? (
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.04, 8, 56]} />
          <meshStandardMaterial color="#4F7DDE" emissive="#4F7DDE" emissiveIntensity={0.34} roughness={0.45} />
        </mesh>
      ) : null}

      <mesh castShadow position={[0, 0.22, 0.08]} rotation={[0.2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.3, 10]} />
        <meshStandardMaterial color="#6D7480" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.22, -0.08]} rotation={[-0.2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.3, 10]} />
        <meshStandardMaterial color="#6D7480" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.48, 0]}>
        <cylinderGeometry args={[0.24, 0.29, 0.6, 20]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      <mesh castShadow position={[-0.26, 0.5, 0]} rotation={[0, 0, 0.18]}>
        <cylinderGeometry args={[0.055, 0.065, 0.42, 10]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0.26, 0.5, 0]} rotation={[0, 0, -0.18]}>
        <cylinderGeometry args={[0.055, 0.065, 0.42, 10]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.24, 20, 14]} />
        <meshStandardMaterial color="#F2C7A5" roughness={0.62} />
      </mesh>
      <mesh castShadow position={[0.17, 1.05, 0.02]}>
        <sphereGeometry args={[0.09, 14, 10]} />
        <meshStandardMaterial color={statusColor} emissive={selected ? statusColor : "#000000"} emissiveIntensity={selected ? 0.26 : 0} roughness={0.55} />
      </mesh>

      <Html center position={[0, 1.28, 0]} occlude={false} zIndexRange={[10, 0]}>
        <div className={`office-employee-label ${selected ? "office-employee-label-selected" : ""}`}>
          <span>{employee.name}</span>
          <i style={{ backgroundColor: statusColor }} />
        </div>
      </Html>
    </group>
  );
}

export function OfficeEmployees({
  employees,
  layout,
  onSelectEmployee,
  selectedEmployeeId,
}: {
  employees: OfficeEmployee[];
  layout: OfficeLayout;
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployeeId: string | null;
}) {
  const locations = getEmployeeLocations(layout, employees);
  const locationByEmployeeId = new Map(locations.map((location) => [location.employeeId, location]));

  return (
    <group>
      {employees.map((employee) => {
        const location = locationByEmployeeId.get(employee.id);
        if (!location) return null;

        return (
          <EmployeeAvatar3D
            key={employee.id}
            employee={employee}
            location={location}
            selected={employee.id === selectedEmployeeId}
            onSelect={onSelectEmployee}
          />
        );
      })}
    </group>
  );
}
