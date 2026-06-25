"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group, type Mesh, type MeshBasicMaterial } from "three";
import {
  buildRuntimeWaypointRoute,
  resolveEmployeeMovementPlans,
  type EmployeeMovementPlan,
} from "./employeeMovement";
import type { OfficeEmployee, OfficeLayout, Vec3 } from "./types";

const MOVEMENT_SPEED = 1.85;
const ARRIVAL_THRESHOLD = 0.045;

const departmentColors: Record<string, string> = {
  대표실: "#4F7DDE",
  콘텐츠팀: "#E690A6",
  재정팀: "#3FB6A6",
  주식팀: "#D9A23E",
  개발팀: "#6E97E0",
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

function vec3ToWalkVector([x, , z]: Vec3) {
  return new Vector3(x, 0.08, z);
}

function vectorToVec3(vector: Vector3): Vec3 {
  return [vector.x, 0, vector.z];
}

function actionKindForStatus(status: string) {
  if (status === "오류 대응 중") return "error";
  if (status === "회의 중") return "meeting";
  if (status === "조사 중") return "search";
  if (status === "승인 대기" || status === "보고 중") return "waiting";
  if (status === "휴식 중") return "rest";
  if (status === "업무 중" || status === "수정 중" || status === "검토 중") return "working";
  if (status === "업무 완료") return "done";
  return "idle";
}

function ActionEffect({
  actionKind,
  isMoving,
  pulseRef,
}: {
  actionKind: string;
  isMoving: boolean;
  pulseRef: React.RefObject<Mesh | null>;
}) {
  if (isMoving) {
    return (
      <mesh ref={pulseRef} position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.58, 0.018, 8, 44]} />
        <meshBasicMaterial color="#4B9FD8" opacity={0.45} transparent />
      </mesh>
    );
  }

  if (actionKind === "error") {
    return (
      <mesh ref={pulseRef} position={[0, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.58, 0.025, 8, 44]} />
        <meshBasicMaterial color="#EB6844" opacity={0.46} transparent />
      </mesh>
    );
  }

  if (actionKind === "search") {
    return (
      <mesh ref={pulseRef} position={[0, 1.2, 0]}>
        <sphereGeometry args={[0.085, 14, 10]} />
        <meshBasicMaterial color="#4B9FD8" opacity={0.78} transparent />
      </mesh>
    );
  }

  if (actionKind === "waiting") {
    return (
      <mesh ref={pulseRef} position={[0, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.018, 8, 40]} />
        <meshBasicMaterial color="#D99A1E" opacity={0.42} transparent />
      </mesh>
    );
  }

  if (actionKind === "meeting") {
    return (
      <mesh ref={pulseRef} position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.018, 8, 40]} />
        <meshBasicMaterial color="#8B6EDC" opacity={0.38} transparent />
      </mesh>
    );
  }

  if (actionKind === "rest") {
    return (
      <mesh ref={pulseRef} position={[0, 0.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.48, 30]} />
        <meshBasicMaterial color="#9AC4A5" opacity={0.22} transparent />
      </mesh>
    );
  }

  if (actionKind === "working") {
    return (
      <mesh ref={pulseRef} position={[0.28, 0.78, -0.05]} rotation={[0.15, 0.15, 0]}>
        <boxGeometry args={[0.16, 0.05, 0.08]} />
        <meshBasicMaterial color="#2FB5A7" opacity={0.78} transparent />
      </mesh>
    );
  }

  if (actionKind === "done") {
    return (
      <mesh ref={pulseRef} position={[0, 1.18, 0]}>
        <sphereGeometry args={[0.075, 14, 10]} />
        <meshBasicMaterial color="#35A772" opacity={0.7} transparent />
      </mesh>
    );
  }

  return null;
}

function EmployeeAvatar3D({
  employee,
  movementPlan,
  navNodePositions,
  selected,
  onSelect,
}: {
  employee: OfficeEmployee;
  movementPlan: EmployeeMovementPlan;
  navNodePositions: Vec3[];
  selected: boolean;
  onSelect: (employeeId: string) => void;
}) {
  const color = departmentColors[employee.department] ?? "#6E97E0";
  const statusColor = statusColors[employee.group] ?? "#7B8794";
  const [x, , z] = movementPlan.position;
  const scale = selected ? 1.22 : 1;
  const rootRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const pulseRef = useRef<Mesh>(null);
  const [initialPosition] = useState<[number, number, number]>(() => [x, 0.08, z]);
  const lastDestinationId = useRef(movementPlan.destinationId);
  const initialPath = useMemo(
    () => movementPlan.route.map((point) => vec3ToWalkVector(point)),
    [movementPlan.route],
  );
  const pathRef = useRef(initialPath);
  const pathIndexRef = useRef(Math.max(0, initialPath.length - 1));
  const [isMoving, setIsMoving] = useState(false);
  const targetPosition = useMemo(() => vec3ToWalkVector(movementPlan.position), [movementPlan.position]);
  const visibleStatusColor = isMoving ? "#4B9FD8" : statusColor;
  const actionKind = actionKindForStatus(employee.status);
  const labelStatus = isMoving ? "이동 중" : employee.status;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const isNewDestination = lastDestinationId.current !== movementPlan.destinationId;
    lastDestinationId.current = movementPlan.destinationId;

    if (isNewDestination) {
      const runtimeRoute = buildRuntimeWaypointRoute(vectorToVec3(root.position), movementPlan.route, navNodePositions);
      pathRef.current = runtimeRoute.map((point) => vec3ToWalkVector(point));
      pathIndexRef.current = 0;
    }

    if (isNewDestination && root.position.distanceTo(targetPosition) > ARRIVAL_THRESHOLD) {
      setIsMoving(true);
    }
  }, [movementPlan.destinationId, movementPlan.route, navNodePositions, targetPosition]);

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root) return;

    const pathTarget = pathRef.current[pathIndexRef.current] ?? targetPosition;
    const distance = root.position.distanceTo(pathTarget);
    if (distance <= ARRIVAL_THRESHOLD) {
      root.position.copy(pathTarget);
      if (pathIndexRef.current < pathRef.current.length - 1) {
        pathIndexRef.current += 1;
        return;
      }
      root.position.copy(targetPosition);
      if (isMoving) setIsMoving(false);
    } else {
      const direction = pathTarget.clone().sub(root.position);
      const step = Math.min(1, (MOVEMENT_SPEED * delta) / distance);
      root.position.lerp(pathTarget, step);
      if (body && direction.lengthSq() > 0.0001) {
        body.rotation.y = Math.atan2(direction.x, direction.z);
      }
      if (!isMoving) setIsMoving(true);
    }

    if (body) {
      const bobIntensity = isMoving ? 0.055 : actionKind === "working" || actionKind === "search" ? 0.018 : actionKind === "rest" ? 0.01 : 0;
      body.position.y = bobIntensity > 0 ? Math.sin(clock.elapsedTime * (isMoving ? 10 : 3.2)) * bobIntensity : 0;
    }

    if (pulseRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * (isMoving ? 7 : 3.8)) * 0.08;
      pulseRef.current.scale.set(pulse, pulse, pulse);
      const material = pulseRef.current.material as MeshBasicMaterial | MeshBasicMaterial[];
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((item) => {
        if ("opacity" in item && item.transparent) {
          item.opacity = Math.max(0.18, Math.min(0.72, item.opacity + Math.sin(clock.elapsedTime * 3.8) * 0.002));
        }
      });
    }
  });

  return (
    <group
      ref={rootRef}
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

      <ActionEffect actionKind={actionKind} isMoving={isMoving} pulseRef={pulseRef} />

      <group ref={bodyRef}>
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
          <meshStandardMaterial
            color={visibleStatusColor}
            emissive={selected || isMoving ? visibleStatusColor : "#000000"}
            emissiveIntensity={selected || isMoving ? 0.26 : 0}
            roughness={0.55}
          />
        </mesh>
      </group>

      <Html center position={[0, 1.28, 0]} occlude={false} zIndexRange={[10, 0]}>
        <div className={`office-employee-label ${selected ? "office-employee-label-selected" : ""}`}>
          <span>{employee.name}</span>
          {isMoving ? <em>{labelStatus}</em> : null}
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
  const { plans } = useMemo(() => resolveEmployeeMovementPlans(layout, employees), [layout, employees]);
  const movementPlanByEmployeeId = useMemo(
    () => new Map(plans.map((plan) => [plan.employeeId, plan])),
    [plans],
  );
  const navNodePositions = useMemo(() => layout.navNodes.map((node) => node.position), [layout.navNodes]);

  return (
    <group>
      {employees.map((employee) => {
        const movementPlan = movementPlanByEmployeeId.get(employee.id);
        if (!movementPlan) return null;

        return (
          <EmployeeAvatar3D
            key={employee.id}
            employee={employee}
            movementPlan={movementPlan}
            navNodePositions={navNodePositions}
            selected={employee.id === selectedEmployeeId}
            onSelect={onSelectEmployee}
          />
        );
      })}
    </group>
  );
}
