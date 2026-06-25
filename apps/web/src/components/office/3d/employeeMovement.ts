"use client";

import type { OfficeDestination, OfficeEmployee, OfficeLayout, Vec3 } from "./types";

export type MovementDestinationType = NonNullable<OfficeDestination["type"]>;

export type MovementDestination = {
  id: string;
  roomId: string;
  position: Vec3;
  type: MovementDestinationType;
};

export type EmployeeMovementPlan = {
  employeeId: string;
  destinationId: string;
  destinationType: MovementDestinationType;
  roomId: string;
  position: Vec3;
  route: Vec3[];
  warning?: string;
};

export type DestinationOccupancy = Map<string, string>;

const meetingSeatIds = [
  "meeting-seat-01",
  "meeting-seat-02",
  "meeting-seat-03",
  "meeting-seat-04",
  "meeting-seat-05",
  "meeting-seat-06",
];

const preferredMeetingSeatMap: Record<string, string> = {
  director: "meeting-seat-01",
  "content-planner": "meeting-seat-02",
  "marketing-manager": "meeting-seat-03",
  developer: "meeting-seat-04",
  "finance-manager": "meeting-seat-05",
  "stock-monitor": "meeting-seat-06",
  "qa-auditor": "meeting-seat-05",
};

const departmentFallbackDestinationMap: Record<string, string> = {
  대표실: "director-seat",
  콘텐츠팀: "content-seat-01",
  재정팀: "finance-seat-01",
  주식팀: "stock-seat-01",
  개발팀: "dev-seat-01",
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

const protectedDestinationFallbacks: Record<string, string[]> = {
  "approval-wait-point": ["approval-wait-point", "director-report-point", "director-support-point", "lobby-center"],
  "director-report-point": ["director-report-point", "approval-wait-point", "director-support-point", "lobby-center"],
  "error-response-point": ["error-response-point", "dev-work-point-02", "ops-work-point-01", "main-crossroad"],
  "coffee-machine-point": ["coffee-machine-point", "pantry-counter-point", "break-seat-01", "break-seat-02"],
  "break-seat-01": ["break-seat-01", "break-seat-02", "break-seat-03", "coffee-machine-point"],
  "break-seat-02": ["break-seat-02", "break-seat-03", "break-seat-01", "coffee-machine-point"],
  "break-seat-03": ["break-seat-03", "break-seat-01", "break-seat-02", "coffee-machine-point"],
};

function inferDestinationType(id: string): MovementDestinationType {
  if (id.startsWith("meeting-seat-")) return "meetingSeat";
  if (id.includes("seat")) return "seat";
  if (id.includes("work-point")) return "workPoint";
  if (id.includes("wait-point")) return "waitingPoint";
  return "standPoint";
}

function toMovementDestination(
  item: { id: string; roomId: string; position: Vec3; type?: MovementDestinationType },
): MovementDestination {
  return {
    id: item.id,
    roomId: item.roomId,
    position: item.position,
    type: item.type ?? inferDestinationType(item.id),
  };
}

export function buildDestinationMap(layout: OfficeLayout) {
  const map = new Map<string, MovementDestination>();

  layout.destinations.forEach((destination) => {
    map.set(destination.id, toMovementDestination(destination));
  });
  layout.seats.forEach((seat) => {
    map.set(seat.id, toMovementDestination({ ...seat, type: seat.type ?? "seat" }));
  });
  layout.workPoints.forEach((point) => {
    map.set(point.id, toMovementDestination({ ...point, type: point.type ?? "workPoint" }));
  });
  layout.standPoints.forEach((point) => {
    map.set(point.id, toMovementDestination({ ...point, type: point.type ?? inferDestinationType(point.id) }));
  });

  return map;
}

export function buildNavNodeMap(layout: OfficeLayout) {
  return new Map(layout.navNodes.map((node) => [node.id, node.position] as const));
}

export function getAssignedDestinationId(layout: OfficeLayout, employee: OfficeEmployee) {
  return layout.employeeSeats[employee.id] ?? departmentFallbackDestinationMap[employee.department] ?? "lobby-center";
}

function firstExisting(ids: string[], destinationMap: Map<string, MovementDestination>) {
  return ids.find((id) => destinationMap.has(id));
}

function reserveFirstAvailable(
  ids: string[],
  destinationMap: Map<string, MovementDestination>,
  occupancy: DestinationOccupancy,
  employeeId: string,
) {
  const existingIds = ids.filter((id) => destinationMap.has(id));
  const availableId = existingIds.find((id) => !occupancy.has(id));
  const destinationId = availableId ?? existingIds[0] ?? "lobby-center";
  occupancy.set(destinationId, employeeId);
  return destinationId;
}

function preferredMeetingSeatIds(employee: OfficeEmployee) {
  const preferred = preferredMeetingSeatMap[employee.id] ?? "meeting-seat-01";
  return [preferred, ...meetingSeatIds.filter((seatId) => seatId !== preferred)];
}

function preferredBreakDestinationIds(employee: OfficeEmployee) {
  if (employee.id === "content-planner") return ["coffee-machine-point", "break-seat-02", "break-seat-03", "break-seat-01"];
  if (employee.id === "director") return ["break-seat-02", "break-seat-03", "break-seat-01", "coffee-machine-point"];
  if (employee.id === "qa-auditor") return ["break-seat-03", "break-seat-02", "break-seat-01", "coffee-machine-point"];
  return ["break-seat-02", "break-seat-03", "coffee-machine-point", "break-seat-01"];
}

function resolveStatusDestinationId(
  layout: OfficeLayout,
  employee: OfficeEmployee,
  destinationMap: Map<string, MovementDestination>,
  occupancy: DestinationOccupancy,
) {
  const baseDestinationId = getAssignedDestinationId(layout, employee);

  switch (employee.status) {
    case "회의 중":
      return reserveFirstAvailable(preferredMeetingSeatIds(employee), destinationMap, occupancy, employee.id);
    case "조사 중":
      return reserveFirstAvailable(
        ["knowledge-search-point", "knowledge-seat-01", baseDestinationId],
        destinationMap,
        occupancy,
        employee.id,
      );
    case "검토 중":
      return reserveFirstAvailable(["secretary-reception-point", baseDestinationId], destinationMap, occupancy, employee.id);
    case "승인 대기":
      return reserveFirstAvailable(protectedDestinationFallbacks["approval-wait-point"], destinationMap, occupancy, employee.id);
    case "보고 중":
      return reserveFirstAvailable(protectedDestinationFallbacks["director-report-point"], destinationMap, occupancy, employee.id);
    case "오류 대응 중":
      return reserveFirstAvailable(protectedDestinationFallbacks["error-response-point"], destinationMap, occupancy, employee.id);
    case "휴식 중":
      return reserveFirstAvailable(preferredBreakDestinationIds(employee), destinationMap, occupancy, employee.id);
    case "업무 종료":
      return reserveFirstAvailable(["entrance-point", "lobby-center"], destinationMap, occupancy, employee.id);
    case "대기 중":
    case "업무 중":
    case "결과 대기":
    case "수정 중":
    case "업무 완료":
    default:
      return reserveFirstAvailable([baseDestinationId, "lobby-center"], destinationMap, occupancy, employee.id);
  }
}

function pushUniquePoint(path: Vec3[], point: Vec3 | undefined) {
  if (!point) return;
  const exists = path.some(([x, , z]) => Math.abs(x - point[0]) < 0.01 && Math.abs(z - point[2]) < 0.01);
  if (!exists) path.push(point);
}

function buildDestinationRoute(destination: MovementDestination, navNodeMap: Map<string, Vec3>) {
  const path: Vec3[] = [];
  const lobbyNode = navNodeMap.get("lobby-open-hub");
  const mainNode = navNodeMap.get("dev-open-hub");
  const roomEntryNode = navNodeMap.get(roomEntryNodeMap[destination.roomId] ?? "");

  if (destination.roomId === "lobby-common-zone") {
    pushUniquePoint(path, lobbyNode);
  } else if (destination.roomId === "pantry-coffee-zone" || destination.roomId === "break-lounge") {
    pushUniquePoint(path, lobbyNode);
    pushUniquePoint(path, roomEntryNode);
  } else {
    pushUniquePoint(path, lobbyNode);
    pushUniquePoint(path, mainNode);
    pushUniquePoint(path, roomEntryNode);
  }
  pushUniquePoint(path, destination.position);

  return path;
}

export function resolveEmployeeMovementPlans(layout: OfficeLayout, employees: OfficeEmployee[]) {
  const destinationMap = buildDestinationMap(layout);
  const navNodeMap = buildNavNodeMap(layout);
  const occupancy: DestinationOccupancy = new Map();
  const plans: EmployeeMovementPlan[] = [];

  employees.forEach((employee) => {
    const requestedDestinationId = resolveStatusDestinationId(layout, employee, destinationMap, occupancy);
    let destination = destinationMap.get(requestedDestinationId);
    let warning: string | undefined;

    if (!destination) {
      const fallbackDestinationId = firstExisting(["lobby-center", getAssignedDestinationId(layout, employee)], destinationMap);
      destination = fallbackDestinationId ? destinationMap.get(fallbackDestinationId) : undefined;
      warning = `[office-movement] Missing ${requestedDestinationId}; ${employee.id} uses ${fallbackDestinationId ?? "origin"}.`;
      if (fallbackDestinationId) occupancy.set(fallbackDestinationId, employee.id);
    }

    if (!destination) {
      console.warn(`[office-movement] Missing movement destination for ${employee.id}; falling back to origin.`);
      plans.push({
        employeeId: employee.id,
        destinationId: "missing-destination",
        destinationType: "standPoint",
        roomId: "unknown",
        position: [0, 0, 0],
        route: [[0, 0, 0]],
        warning,
      });
      return;
    }

    if (warning) console.warn(warning);

    plans.push({
      employeeId: employee.id,
      destinationId: destination.id,
      destinationType: destination.type,
      roomId: destination.roomId,
      position: destination.position,
      route: buildDestinationRoute(destination, navNodeMap),
      warning,
    });
  });

  return { plans, occupancy };
}

function distanceSquared(a: Vec3, b: Vec3) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

function nearestNavNode(position: Vec3, navNodePositions: Vec3[]) {
  return navNodePositions.reduce<Vec3 | undefined>((closest, point) => {
    if (!closest) return point;
    return distanceSquared(position, point) < distanceSquared(position, closest) ? point : closest;
  }, undefined);
}

export function buildRuntimeWaypointRoute(currentPosition: Vec3, plannedRoute: Vec3[], navNodePositions: Vec3[]): Vec3[] {
  const route: Vec3[] = [];
  const finalDestination = plannedRoute.at(-1);
  const nearest = nearestNavNode(currentPosition, navNodePositions);

  if (finalDestination && distanceSquared(currentPosition, finalDestination) < 0.16) {
    return [finalDestination];
  }

  pushUniquePoint(route, nearest);
  plannedRoute.forEach((point) => pushUniquePoint(route, point));

  return route.length > 0 ? route : finalDestination ? [finalDestination] : ([[0, 0, 0]] as Vec3[]);
}
