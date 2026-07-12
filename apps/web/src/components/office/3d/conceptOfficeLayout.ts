import type {
  FurnitureDesk,
  FurnitureItem,
  OfficeDestination,
  OfficeDoor,
  OfficeLayout,
  OfficeRoom,
  OfficeWall,
  PlacementPoint,
  SeatPlacement,
  Vec3,
} from "./types";

const rooms: OfficeRoom[] = [
  { id: "ceo-office", name: "CEO Office", position: [-11.25, 0, -5.7], size: [5.1, 4.4], color: "#243044", wallType: "low" },
  { id: "director-room", name: "AI Director Desk", position: [-6.1, 0, -5.7], size: [4.8, 4.4], color: "#203A4A", wallType: "low" },
  { id: "market-analysis-room", name: "Market Analysis Room", position: [-1.25, 0, -5.7], size: [4.7, 4.4], color: "#1C354D", wallType: "low" },
  { id: "content-zone", name: "Content Studio", position: [6.7, 0, -5.7], size: [10.8, 4.4], color: "#263244", wallType: "low" },
  { id: "knowledge-audit-zone", name: "QA & Audit Room", position: [-10.5, 0, -0.65], size: [6.6, 5.2], color: "#233245", wallType: "low" },
  { id: "meeting-room", name: "Central Meeting Room", position: [-2.6, 0, -0.65], size: [8.8, 5.2], color: "#22303F", wallType: "glass" },
  { id: "finance-room", name: "Finance Room", position: [4.55, 0, -0.65], size: [5.1, 5.2], color: "#253748", wallType: "low" },
  { id: "dev-ops-zone", name: "Dev & Server Room", position: [10.2, 0, -0.65], size: [6.0, 5.2], color: "#312B35", wallType: "low" },
  { id: "review-zone", name: "Publishing Station", position: [-10.6, 0, 5.25], size: [6.4, 5.8], color: "#1C3B43", wallType: "low" },
  { id: "approval-zone", name: "Approval Gate", position: [-3.85, 0, 5.25], size: [6.6, 5.8], color: "#433927", wallType: "low" },
  { id: "break-lounge", name: "Lounge", position: [5.55, 0, 5.25], size: [12.0, 5.8], color: "#2A3637", wallType: "low" },
];

function createRoomWalls(room: OfficeRoom): OfficeWall[] {
  const [x, , z] = room.position;
  const [width, depth] = room.size;
  const thickness = 0.14;
  const doorway = Math.min(1.45, width * 0.28);
  const frontSegmentWidth = (width - doorway) / 2;
  const material = room.wallType === "glass" ? "glass" : "solid";
  const heightType = room.wallType === "glass" ? "glass" : "inner";

  return [
    { id: `${room.id}-back`, position: [x, 0, z - depth / 2], size: [width, thickness], heightType, material },
    { id: `${room.id}-left`, position: [x - width / 2, 0, z], size: [thickness, depth], heightType, material },
    { id: `${room.id}-right`, position: [x + width / 2, 0, z], size: [thickness, depth], heightType, material },
    { id: `${room.id}-front-left`, position: [x - doorway / 2 - frontSegmentWidth / 2, 0, z + depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
    { id: `${room.id}-front-right`, position: [x + doorway / 2 + frontSegmentWidth / 2, 0, z + depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
  ];
}

const walls = rooms.flatMap(createRoomWalls);

const doors: OfficeDoor[] = rooms.map((room) => {
  const [x, , z] = room.position;
  const id = room.id === "break-lounge" ? "passage-lobby-break" : `${room.id}-door`;
  return {
    id,
    position: [x, 0, z + room.size[1] / 2],
    size: [1.45, 0.2],
    connects: [room.id, "central-corridor"],
    width: 1.45,
  };
});

const seat = (
  id: string,
  roomId: string,
  employeeId: string | null,
  position: Vec3,
  deskId?: string,
  rotation = 0,
  type: SeatPlacement["type"] = "seat",
): SeatPlacement => ({ id, roomId, employeeId, position, deskId, rotation, type });

const seats: SeatPlacement[] = [
  seat("ceo-seat", "ceo-office", "ceo", [-11.25, 0, -5.1], "ceo-desk"),
  seat("director-seat", "director-room", "director", [-6.1, 0, -5.1], "director-desk"),
  seat("stock-seat-01", "market-analysis-room", "stock-monitor", [-1.25, 0, -5.1], "stock-desk"),
  seat("content-seat-01", "content-zone", "content-planner", [3.35, 0, -5.1], "content-desk-01"),
  seat("content-seat-02", "content-zone", "marketing-manager", [6.65, 0, -5.1], "content-desk-02"),
  seat("content-seat-03", "content-zone", "content-writer", [9.7, 0, -5.1], "content-desk-03"),
  seat("audit-seat-01", "knowledge-audit-zone", "qa-auditor", [-10.5, 0, -0.05], "audit-desk"),
  seat("finance-seat-01", "finance-room", "finance-manager", [4.55, 0, -0.05], "finance-desk"),
  seat("dev-seat-01", "dev-ops-zone", "developer", [9.6, 0, -0.05], "dev-desk"),
  seat("publishing-station-point", "review-zone", "local-publisher", [-10.6, 0, 5.25], undefined, 0, "standPoint"),
  seat("meeting-seat-01", "meeting-room", null, [-5.55, 0, -0.65], undefined, 1.57, "meetingSeat"),
  seat("meeting-seat-02", "meeting-room", null, [-4.7, 0, -2.0], undefined, 0, "meetingSeat"),
  seat("meeting-seat-03", "meeting-room", null, [-3.3, 0, -2.0], undefined, 0, "meetingSeat"),
  seat("meeting-seat-04", "meeting-room", null, [-1.9, 0, -2.0], undefined, 0, "meetingSeat"),
  seat("meeting-seat-05", "meeting-room", null, [-0.5, 0, -2.0], undefined, 0, "meetingSeat"),
  seat("meeting-seat-06", "meeting-room", null, [0.35, 0, -0.65], undefined, -1.57, "meetingSeat"),
  seat("meeting-seat-07", "meeting-room", null, [-4.7, 0, 0.75], undefined, 3.14, "meetingSeat"),
  seat("meeting-seat-08", "meeting-room", null, [-2.6, 0, 0.75], undefined, 3.14, "meetingSeat"),
  seat("meeting-seat-09", "meeting-room", null, [-0.5, 0, 0.75], undefined, 3.14, "meetingSeat"),
  seat("break-seat-01", "break-lounge", null, [3.0, 0, 5.0]),
  seat("break-seat-02", "break-lounge", null, [5.2, 0, 5.7]),
  seat("break-seat-03", "break-lounge", null, [7.2, 0, 5.0]),
];

const standPoints: PlacementPoint[] = [
  { id: "approval-wait-point", roomId: "approval-zone", position: [-3.85, 0, 5.85], rotation: 0, type: "waitingPoint" },
  { id: "director-report-point", roomId: "ceo-office", position: [-9.7, 0, -4.65], rotation: 0, type: "standPoint" },
  { id: "director-support-point", roomId: "director-room", position: [-5.0, 0, -4.65], rotation: 0, type: "standPoint" },
  { id: "error-response-point", roomId: "dev-ops-zone", position: [11.35, 0, 0.65], rotation: 0, type: "standPoint" },
  { id: "coffee-machine-point", roomId: "break-lounge", position: [9.5, 0, 5.8], rotation: 0, type: "standPoint" },
  { id: "pantry-counter-point", roomId: "break-lounge", position: [8.8, 0, 6.4], rotation: 0, type: "standPoint" },
  { id: "knowledge-search-point", roomId: "knowledge-audit-zone", position: [-9.0, 0, 0.75], rotation: 0, type: "standPoint" },
  { id: "secretary-reception-point", roomId: "review-zone", position: [-9.0, 0, 5.8], rotation: 0, type: "standPoint" },
  { id: "lobby-center", roomId: "approval-zone", position: [0, 0, 3.0], rotation: 0, type: "standPoint" },
  { id: "main-crossroad", roomId: "meeting-room", position: [0, 0, 1.9], rotation: 0, type: "standPoint" },
  { id: "entrance-point", roomId: "approval-zone", position: [-3.85, 0, 7.5], rotation: 0, type: "standPoint" },
];

const destinations: OfficeDestination[] = [
  ...seats.map(({ id, roomId, position, type }) => ({ id, roomId, position, type })),
  ...standPoints.map(({ id, roomId, position, type }) => ({ id, roomId, position, type })),
];

const desk = (id: string, roomId: string, employeeId: string, position: Vec3, rotation = 0): FurnitureDesk => ({
  id,
  roomId,
  position,
  rotation,
  assignedEmployeeId: employeeId,
  isReserved: false,
  capacity: 1,
  seatId: `${employeeId}-seat`,
  workPointId: `${employeeId}-work-point`,
});

const desks: FurnitureDesk[] = [
  desk("ceo-desk", "ceo-office", "ceo", [-11.25, 0, -5.85]),
  desk("director-desk", "director-room", "director", [-6.1, 0, -5.85]),
  desk("stock-desk", "market-analysis-room", "stock-monitor", [-1.25, 0, -5.85]),
  desk("content-desk-01", "content-zone", "content-planner", [3.35, 0, -5.85]),
  desk("content-desk-02", "content-zone", "marketing-manager", [6.65, 0, -5.85]),
  desk("content-desk-03", "content-zone", "content-writer", [9.7, 0, -5.85]),
  desk("audit-desk", "knowledge-audit-zone", "qa-auditor", [-10.5, 0, -0.8]),
  desk("finance-desk", "finance-room", "finance-manager", [4.55, 0, -0.8]),
  desk("dev-desk", "dev-ops-zone", "developer", [9.6, 0, -0.8]),
];

const item = (id: string, roomId: string, type: FurnitureItem["type"], position: Vec3, size?: Vec3, color?: string, rotation = 0): FurnitureItem => ({
  id, roomId, type, position, rotation, size, color,
});

const items: FurnitureItem[] = [
  item("ceo-books", "ceo-office", "bookcase", [-12.6, 0, -6.8], [2.0, 1.2, 0.35], "#6B513E"),
  item("ceo-lamp", "ceo-office", "lamp", [-13.0, 0, -4.55], undefined, "#D3A957"),
  item("director-board", "director-room", "digitalSign", [-6.1, 0, -7.25], [2.4, 0.1, 0.14], "#1B6A8A"),
  item("market-board", "market-analysis-room", "contentBoard", [-1.25, 0, -7.25], [2.8, 0.08, 0.14], "#102C4D"),
  item("content-board", "content-zone", "contentBoard", [6.7, 0, -7.25], [4.0, 0.08, 0.14], "#173A59"),
  item("qa-board", "knowledge-audit-zone", "reviewBoard", [-10.5, 0, -2.65], [2.8, 0.08, 0.14], "#153854"),
  item("meeting-table", "meeting-room", "roundMeetingTable", [-2.6, 0, -0.65], [5.3, 0.35, 2.15], "#C7CDD5"),
  item("meeting-logo", "meeting-room", "digitalSign", [-2.6, 0, -2.78], [3.0, 0.1, 0.14], "#0E3855"),
  ...seats
    .filter((meetingSeat) => meetingSeat.type === "meetingSeat")
    .map((meetingSeat, index) => item(
      `meeting-chair-${index + 1}`,
      "meeting-room",
      "chair",
      meetingSeat.position,
      [0.48, 0.72, 0.46],
      "#4E5D6D",
      meetingSeat.rotation,
    )),
  item("finance-board", "finance-room", "contentBoard", [4.55, 0, -2.65], [2.5, 0.08, 0.14], "#153854"),
  item("server-rack-01", "dev-ops-zone", "serverRack", [11.55, 0, -1.2], [0.7, 1.5, 0.7], "#151C25"),
  item("server-rack-02", "dev-ops-zone", "serverRack", [12.25, 0, -1.2], [0.7, 1.5, 0.7], "#151C25"),
  item("publishing-sign", "review-zone", "digitalSign", [-10.6, 0, 3.1], [2.8, 0.1, 0.14], "#0E5965"),
  item("publishing-console", "review-zone", "teamBench", [-10.6, 0, 6.15], [3.5, 0.8, 1.15], "#33485B"),
  item("approval-desk", "approval-zone", "barTable", [-3.85, 0, 5.45], [3.2, 0.5, 1.0], "#8D672F"),
  item("approval-board", "approval-zone", "logoBoard", [-3.85, 0, 3.15], [2.2, 0.08, 0.14], "#57401E"),
  item("lounge-sofa-main", "break-lounge", "sofa", [5.3, 0, 5.25], [3.5, 0.8, 1.1], "#69727D"),
  item("lounge-sofa-side", "break-lounge", "sofa", [2.7, 0, 6.1], [1.6, 0.8, 0.9], "#59636E", 1.57),
  item("lounge-table", "break-lounge", "loungeTable", [5.2, 0, 6.35], [1.8, 0.3, 1.0], "#795B42"),
  item("lounge-rug", "break-lounge", "floorRug", [5.2, 0, 5.55], [5.6, 0.02, 3.6], "#334353"),
  item("coffee", "break-lounge", "coffeeMachine", [9.5, 0, 5.45], [0.6, 1.0, 0.5], "#C8D0D6"),
  item("lounge-storage", "break-lounge", "storage", [9.4, 0, 6.6], [2.2, 0.8, 0.55], "#735E48"),
  ...[
    [-13.0, -4.0], [-8.4, -4.0], [1.8, -4.0], [12.0, -4.0],
    [-7.8, 1.15], [1.2, 1.15], [7.2, 1.15], [-7.8, 7.0], [1.2, 7.0], [10.5, 7.0],
  ].map(([x, z], index) => item(`concept-plant-${index + 1}`, "central-corridor", "plant", [x, 0, z], undefined, "#3A8B69")),
];

const roomEntryNodes: Array<[string, Vec3]> = [
  ["ceo-open-node", [-11.25, 0, -3.45]],
  ["director-open-node", [-6.1, 0, -3.45]],
  ["market-open-node", [-1.25, 0, -3.45]],
  ["content-open-node", [6.7, 0, -3.45]],
  ["knowledge-open-node", [-10.5, 0, 1.95]],
  ["meeting-open-hub", [-2.6, 0, 1.95]],
  ["finance-open-node", [4.55, 0, 1.95]],
  ["dev-open-room-node", [10.2, 0, 1.95]],
  ["review-open-node", [-10.6, 0, 2.3]],
  ["approval-open-node", [-3.85, 0, 2.3]],
  ["lounge-open-node", [5.55, 0, 2.3]],
];

export function createConceptOfficeLayout(base: OfficeLayout): OfficeLayout {
  return {
    ...base,
    office: { ...base.office, size: [28, 18], floorColor: "#111D2B", labelsEnabled: true },
    camera: {
      ...base.camera,
      position: [0, 52, 22],
      target: [0, 0, 0.55],
      zoom: 36,
      minZoom: 26,
      maxZoom: 52,
      coverage: 1.08,
    },
    dimensions: {
      ...base.dimensions,
      outerWallHeight: 1.65,
      innerWallHeight: 1.34,
      glassWallHeight: 1.46,
      frontWallHeight: 0.62,
    },
    rooms,
    walls,
    doors,
    walkableAreas: rooms.map((room) => ({ id: `${room.id}-walkable`, roomId: room.id, position: room.position, size: room.size })),
    destinations,
    seats,
    workPoints: [],
    standPoints,
    blockedAreas: [],
    navNodes: [
      { id: "lobby-open-hub", position: [0, 0, 3.0], connectsTo: ["dev-open-hub"] },
      { id: "dev-open-hub", position: [0, 0, 1.6], connectsTo: roomEntryNodes.map(([id]) => id) },
      ...roomEntryNodes.map(([id, position]) => ({ id, position, connectsTo: ["dev-open-hub"] })),
    ],
    furniture: { desks, expansionZones: [], items },
    employeeSeats: {
      ceo: "ceo-seat",
      director: "director-seat",
      "content-planner": "content-seat-01",
      "marketing-manager": "content-seat-02",
      "content-writer": "content-seat-03",
      "qa-auditor": "audit-seat-01",
      "finance-manager": "finance-seat-01",
      "stock-monitor": "stock-seat-01",
      developer: "dev-seat-01",
      "local-publisher": "publishing-station-point",
    },
  };
}
