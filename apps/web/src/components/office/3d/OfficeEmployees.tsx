"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import type { OfficeEmployee, OfficeLayout, Vec3 } from "./types";

type EmployeeLocation = {
  employeeId: string;
  destinationId: string;
  position: Vec3;
  path: Vec3[];
};

const MOVEMENT_SPEED = 4.2;
const ARRIVAL_THRESHOLD = 0.035;

const meetingSeatMap: Record<string, string> = {
  director: "meeting-seat-01",
  "content-planner": "meeting-seat-02",
  "marketing-manager": "meeting-seat-03",
  developer: "meeting-seat-04",
  "finance-manager": "meeting-seat-05",
  "stock-monitor": "meeting-seat-06",
  "qa-auditor": "meeting-seat-05",
};

const departmentFallbackDestinationMap: Record<string, string> = {
  "대표실": "director-seat",
  "콘텐츠팀": "content-seat-01",
  "재정팀": "finance-seat-01",
  "주식팀": "stock-seat-01",
  "개발팀": "dev-seat-01",
  "지식·감사": "audit-seat-01",
};

const roomEntryNodeMap: Record<string, string> = {
  "director-room": "director-open-node",
  "meeting-room": "meeting-open-hub",
  "content-zone": "content-open-node",
  "review-zone": "review-open-node",
  "dev-ops-zone": "dev-open-hub",
  "finance-stock-zone": "finance-open-node",
  "break-lounge": "lounge-open-node",
  "lobby-common-zone": "lobby-open-hub",
  "pantry-coffee-zone": "pantry-open-node",
  "knowledge-audit-zone": "knowledge-open-node",
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

type DestinationEntry = {
  id: string;
  roomId: string;
  position: Vec3;
};

function buildDestinationMap(layout: OfficeLayout) {
  const map = new Map<string, DestinationEntry>();

  layout.destinations.forEach((destination) => {
    map.set(destination.id, destination);
  });
  layout.seats.forEach((seat) => {
    map.set(seat.id, seat);
  });
  layout.workPoints.forEach((point) => {
    map.set(point.id, point);
  });
  layout.standPoints.forEach((point) => {
    map.set(point.id, point);
  });

  return map;
}

function buildNavNodeMap(layout: OfficeLayout) {
  return new Map(layout.navNodes.map((node) => [node.id, node.position] as const));
}

function getAssignedSeatId(layout: OfficeLayout, employee: OfficeEmployee) {
  return layout.employeeSeats[employee.id];
}

function getFallbackDestinationId(layout: OfficeLayout, employee: OfficeEmployee) {
  return getAssignedSeatId(layout, employee) ?? departmentFallbackDestinationMap[employee.department] ?? "lobby-center";
}

function getStatusDestinationId(layout: OfficeLayout, employee: OfficeEmployee) {
  const baseDestinationId = getFallbackDestinationId(layout, employee);

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
      return employee.id === "director" ? "break-seat-02" : employee.id === "qa-auditor" ? "break-seat-03" : "break-seat-01";
    case "업무 종료":
      return "entrance-point";
    default:
      return baseDestinationId;
  }
}

function getWaypointPath(
  destination: DestinationEntry,
  destinationId: string,
  navNodeMap: Map<string, Vec3>,
) {
  if (["lobby-center", "main-crossroad", "entrance-point"].includes(destinationId)) {
    return [destination.position];
  }

  const path: Vec3[] = [];
  const lobbyNode = navNodeMap.get("lobby-open-hub");
  const mainNode = navNodeMap.get("dev-open-hub");
  const roomEntryNodeId = roomEntryNodeMap[destination.roomId];
  const roomEntryNode = roomEntryNodeId ? navNodeMap.get(roomEntryNodeId) : undefined;

  if (lobbyNode) path.push(lobbyNode);
  if (mainNode && destination.roomId !== "lobby-common-zone") path.push(mainNode);
  if (roomEntryNode && !path.some((point) => point[0] === roomEntryNode[0] && point[2] === roomEntryNode[2])) {
    path.push(roomEntryNode);
  }
  path.push(destination.position);

  return path;
}

function getEmployeeLocations(layout: OfficeLayout, employees: OfficeEmployee[]) {
  const destinationMap = buildDestinationMap(layout);
  const navNodeMap = buildNavNodeMap(layout);

  return employees.map((employee): EmployeeLocation => {
    const requestedDestinationId = getStatusDestinationId(layout, employee);
    const fallbackDestinationId = getFallbackDestinationId(layout, employee);
    const requestedDestination =
      destinationMap.get(requestedDestinationId) ??
      destinationMap.get(fallbackDestinationId) ??
      destinationMap.get(departmentFallbackDestinationMap[employee.department]) ??
      destinationMap.get("lobby-center");

    if (!requestedDestination) {
      console.warn(`[office-placement] Missing destination for ${employee.id}; falling back to origin.`);
      return {
        employeeId: employee.id,
        destinationId: "missing-destination",
        path: [[0, 0, 0]],
        position: [0, 0, 0],
      };
    }

    if (!destinationMap.has(requestedDestinationId)) {
      console.warn(`[office-placement] Missing ${requestedDestinationId}; ${employee.id} uses ${requestedDestination.id}.`);
    }

    return {
      employeeId: employee.id,
      destinationId: requestedDestination.id,
      path: getWaypointPath(requestedDestination, requestedDestination.id, navNodeMap),
      position: requestedDestination.position,
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
  const groupRef = useRef<Group>(null);
  const [initialPosition] = useState<[number, number, number]>(() => [x, 0.08, z]);
  const lastDestinationId = useRef(location.destinationId);
  const initialPath = useMemo(() => location.path.map(([pathX, , pathZ]) => new Vector3(pathX, 0.08, pathZ)), [location.path]);
  const pathRef = useRef(initialPath);
  const pathIndexRef = useRef(Math.max(0, initialPath.length - 1));
  const [isMoving, setIsMoving] = useState(false);
  const targetPosition = useMemo(() => new Vector3(x, 0.08, z), [x, z]);
  const visibleStatusColor = isMoving ? "#4B9FD8" : statusColor;

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const isNewDestination = lastDestinationId.current !== location.destinationId;
    lastDestinationId.current = location.destinationId;

    if (isNewDestination) {
      pathRef.current = location.path.map(([pathX, , pathZ]) => new Vector3(pathX, 0.08, pathZ));
      pathIndexRef.current = 0;
    }

    if (isNewDestination && group.position.distanceTo(targetPosition) > ARRIVAL_THRESHOLD) {
      setIsMoving(true);
    }
  }, [location.destinationId, location.path, targetPosition]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const pathTarget = pathRef.current[pathIndexRef.current] ?? targetPosition;
    const distance = group.position.distanceTo(pathTarget);
    if (distance <= ARRIVAL_THRESHOLD) {
      group.position.copy(pathTarget);
      if (pathIndexRef.current < pathRef.current.length - 1) {
        pathIndexRef.current += 1;
        return;
      }
      group.position.copy(targetPosition);
      if (isMoving) setIsMoving(false);
      return;
    }

    const step = Math.min(1, (MOVEMENT_SPEED * delta) / distance);
    group.position.lerp(pathTarget, step);
    if (!isMoving) setIsMoving(true);
  });

  return (
    <group
      ref={groupRef}
      position={initialPosition}
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

      {isMoving ? (
        <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.58, 0.018, 8, 44]} />
          <meshBasicMaterial color="#4B9FD8" opacity={0.45} transparent />
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
        <meshStandardMaterial color={visibleStatusColor} emissive={selected || isMoving ? visibleStatusColor : "#000000"} emissiveIntensity={selected || isMoving ? 0.26 : 0} roughness={0.55} />
      </mesh>

      <Html center position={[0, 1.28, 0]} occlude={false} zIndexRange={[10, 0]}>
        <div className={`office-employee-label ${selected ? "office-employee-label-selected" : ""}`}>
          <span>{employee.name}</span>
          {isMoving ? <em>이동 중</em> : null}
          <i style={{ backgroundColor: visibleStatusColor }} />
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
