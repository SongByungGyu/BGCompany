"use client";

import type { NavNode, OfficeDestination, OfficeEmployee, OfficeLayout, Vec3 } from "./types";

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
  "meeting-seat-07",
  "meeting-seat-08",
  "meeting-seat-09",
];

const preferredMeetingSeatMap: Record<string, string> = {
  ceo: "meeting-seat-01",
  director: "meeting-seat-02",
  "content-planner": "meeting-seat-03",
  "marketing-manager": "meeting-seat-04",
  "content-writer": "meeting-seat-05",
  "qa-auditor": "meeting-seat-06",
  "finance-manager": "meeting-seat-07",
  "stock-monitor": "meeting-seat-08",
  developer: "meeting-seat-09",
};

const departmentFallbackDestinationMap: Record<string, string> = {
  대표실: "director-seat",
  콘텐츠팀: "content-seat-01",
  재정팀: "finance-seat-01",
  주식팀: "stock-seat-01",
  개발팀: "dev-seat-01",
  "지식·감사": "audit-seat-01",
  "게시 운영": "publishing-station-point",
};

const roomEntryNodeMap: Record<string, string> = {
  "ceo-office": "ceo-room-node",
  "director-room": "director-room-node",
  "market-analysis-room": "market-room-node",
  "meeting-room": "meeting-room-node",
  "content-zone": "content-room-node",
  "review-zone": "review-room-node",
  "dev-ops-zone": "dev-room-node",
  "finance-room": "finance-room-node",
  "finance-stock-zone": "finance-room-node",
  "break-lounge": "lounge-room-node",
  "approval-zone": "approval-room-node",
  "lobby-common-zone": "lower-junction",
  "pantry-coffee-zone": "lounge-room-node",
  "knowledge-audit-zone": "qa-room-node",
  "central-corridor": "lower-junction",
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
  return new Map(layout.navNodes.map((node) => [node.id, node] as const));
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
        if (employee.id === "stock-monitor") {
          return reserveFirstAvailable([baseDestinationId], destinationMap, occupancy, employee.id);
        }
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

function buildDestinationRoute(destination: MovementDestination, navNodeMap: Map<string, NavNode>) {
  const path: Vec3[] = [];
  const roomEntryNode = navNodeMap.get(roomEntryNodeMap[destination.roomId] ?? "");
  pushUniquePoint(path, roomEntryNode?.position);
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

function nearestNavNode(position: Vec3, navNodes: NavNode[]) {
  return navNodes.reduce<NavNode | undefined>((closest, node) => {
    if (!closest) return node;
    return distanceSquared(position, node.position) < distanceSquared(position, closest.position) ? node : closest;
  }, undefined);
}

function shortestNavNodeRoute(start: NavNode, end: NavNode, navNodes: NavNode[]) {
  if (start.id === end.id) return [start];
  const nodeMap = new Map(navNodes.map((node) => [node.id, node] as const));
  const queue = [start.id];
  const visited = new Set([start.id]);
  const previous = new Map<string, string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = nodeMap.get(currentId);
    if (!current) continue;
    for (const neighborId of current.connectsTo) {
      if (visited.has(neighborId) || !nodeMap.has(neighborId)) continue;
      visited.add(neighborId);
      previous.set(neighborId, currentId);
      if (neighborId === end.id) {
        const ids = [end.id];
        let cursor = end.id;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          ids.unshift(cursor);
          if (cursor === start.id) break;
        }
        return ids.map((id) => nodeMap.get(id)).filter((node): node is NavNode => Boolean(node));
      }
      queue.push(neighborId);
    }
  }

  console.warn(`[office-movement] No corridor route from ${start.id} to ${end.id}; movement cancelled.`);
  return [];
}

export function buildRuntimeWaypointRoute(currentPosition: Vec3, plannedRoute: Vec3[], navNodes: NavNode[]): Vec3[] {
  const route: Vec3[] = [];
  const finalDestination = plannedRoute.at(-1);
  const targetEntry = plannedRoute.length > 1 ? plannedRoute.at(-2) : finalDestination;
  const startNode = nearestNavNode(currentPosition, navNodes);
  const endNode = targetEntry ? nearestNavNode(targetEntry, navNodes) : undefined;

  if (finalDestination && distanceSquared(currentPosition, finalDestination) < 0.16) {
    return [finalDestination];
  }

  if (!startNode || !endNode) return [currentPosition];
  const graphRoute = shortestNavNodeRoute(startNode, endNode, navNodes);
  if (graphRoute.length === 0) return [currentPosition];
  graphRoute.forEach((node) => pushUniquePoint(route, node.position));
  if (targetEntry) pushUniquePoint(route, targetEntry);
  if (finalDestination) pushUniquePoint(route, finalDestination);

  return route.length > 0 ? route : [currentPosition];
}
