import type {
  FurnitureDesk,
  FurnitureItem,
  OfficeDestination,
  OfficeDoor,
  OfficeLayout,
  NavNode,
  OfficeRoom,
  OfficeWall,
  PlacementPoint,
  SeatPlacement,
  Vec3,
} from "./types";

const rooms: OfficeRoom[] = [
  // Calibrated against hybrid-office-base-v1.png (1672x941). These bounds keep
  // labels, destinations and movement routes on the photographed room geometry.
  { id: "ceo-office", name: "대표실", position: [-10.39, 0, -6.24], size: [5.88, 5.48], color: "#2B303A", wallType: "low" },
  { id: "director-room", name: "AI 디렉터실", position: [-4.74, 0, -6.24], size: [5.39, 5.48], color: "#203A4A", wallType: "low" },
  { id: "market-analysis-room", name: "시장분석실", position: [0.2, 0, -6.24], size: [4.45, 5.48], color: "#1C354D", wallType: "low" },
  { id: "content-zone", name: "콘텐츠 스튜디오", position: [8.08, 0, -6.24], size: [10.57, 5.48], color: "#263244", wallType: "low" },
  { id: "knowledge-audit-zone", name: "QA·감사실", position: [-10.41, 0, -0.31], size: [5.97, 5.78], color: "#233245", wallType: "low" },
  { id: "meeting-room", name: "중앙 회의실", position: [-2.35, 0, -0.31], size: [8.59, 5.78], color: "#22303F", wallType: "glass" },
  { id: "finance-room", name: "재정실", position: [4.63, 0, -0.31], size: [4.69, 5.78], color: "#253748", wallType: "low" },
  { id: "dev-ops-zone", name: "개발·서버실", position: [10.38, 0, -0.31], size: [6.65, 5.78], color: "#312B35", wallType: "low" },
  { id: "review-zone", name: "발행 스테이션", position: [-10.37, 0, 5.87], size: [5.88, 6.18], color: "#1C3B43", wallType: "low" },
  { id: "approval-zone", name: "승인 게이트", position: [-1.68, 0, 5.87], size: [7.58, 6.18], color: "#433927", wallType: "low" },
  { id: "break-lounge", name: "라운지", position: [7.95, 0, 5.87], size: [11.33, 6.18], color: "#2A3637", wallType: "low" },
];

const northDoorRooms = new Set(["review-zone", "approval-zone", "break-lounge"]);

function createRoomWalls(room: OfficeRoom): OfficeWall[] {
  const [x, , z] = room.position;
  const [width, depth] = room.size;
  const thickness = 0.14;
  const doorway = Math.min(1.45, width * 0.28);
  const frontSegmentWidth = (width - doorway) / 2;
  const material = room.wallType === "glass" ? "glass" : "solid";
  const heightType = room.wallType === "glass" ? "glass" : "inner";

  const backWalls: OfficeWall[] = northDoorRooms.has(room.id)
    ? [
        { id: `${room.id}-back-left`, position: [x - doorway / 2 - frontSegmentWidth / 2, 0, z - depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
        { id: `${room.id}-back-right`, position: [x + doorway / 2 + frontSegmentWidth / 2, 0, z - depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
      ]
    : [{ id: `${room.id}-back`, position: [x, 0, z - depth / 2], size: [width, thickness], heightType, material }];
  const frontWalls: OfficeWall[] = northDoorRooms.has(room.id)
    ? [{ id: `${room.id}-front`, position: [x, 0, z + depth / 2], size: [width, thickness], heightType, material }]
    : [
        { id: `${room.id}-front-left`, position: [x - doorway / 2 - frontSegmentWidth / 2, 0, z + depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
        { id: `${room.id}-front-right`, position: [x + doorway / 2 + frontSegmentWidth / 2, 0, z + depth / 2], size: [frontSegmentWidth, thickness], heightType: "front", material },
      ];

  return [
    ...backWalls,
    { id: `${room.id}-left`, position: [x - width / 2, 0, z], size: [thickness, depth], heightType, material },
    { id: `${room.id}-right`, position: [x + width / 2, 0, z], size: [thickness, depth], heightType, material },
    ...frontWalls,
  ];
}

const walls = rooms.flatMap(createRoomWalls);

const doors: OfficeDoor[] = rooms.map((room) => {
  const [x, , z] = room.position;
  const doorZ = northDoorRooms.has(room.id) ? z - room.size[1] / 2 : z + room.size[1] / 2;
  const id = room.id === "break-lounge" ? "passage-lobby-break" : `${room.id}-door`;
  return {
    id,
    position: [x, 0, doorZ],
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
  seat("ceo-seat", "ceo-office", "ceo", [-10.45, 0, -5.59], "ceo-desk"),
  seat("director-seat", "director-room", "director", [-4.65, 0, -5.59], "director-desk"),
  seat("stock-seat-01", "market-analysis-room", "stock-monitor", [0.05, 0, -5.59], "stock-desk"),
  seat("content-seat-01", "content-zone", "content-planner", [4.84, 0, -5.59], "content-desk-01"),
  seat("content-seat-02", "content-zone", "marketing-manager", [7.29, 0, -5.59], "content-desk-02"),
  seat("content-seat-03", "content-zone", "content-writer", [9.85, 0, -5.59], "content-desk-03"),
  seat("audit-seat-01", "knowledge-audit-zone", "qa-auditor", [-10.96, 0, 0.45], "audit-desk"),
  seat("finance-seat-01", "finance-room", "finance-manager", [4.48, 0, 0.39], "finance-desk"),
  seat("dev-seat-01", "dev-ops-zone", "developer", [9.17, 0, 0.31], "dev-desk"),
  seat("publishing-station-point", "review-zone", "local-publisher", [-10.09, 0, 4.65], undefined, 0, "standPoint"),
  seat("meeting-seat-01", "meeting-room", null, [-5.33, 0, 0.43], undefined, 1.57, "meetingSeat"),
  seat("meeting-seat-02", "meeting-room", null, [-3.48, 0, -0.45], undefined, 0, "meetingSeat"),
  seat("meeting-seat-03", "meeting-room", null, [-2.68, 0, -0.45], undefined, 0, "meetingSeat"),
  seat("meeting-seat-04", "meeting-room", null, [-1.91, 0, -0.45], undefined, 0, "meetingSeat"),
  seat("meeting-seat-05", "meeting-room", null, [-1.19, 0, -0.45], undefined, 0, "meetingSeat"),
  seat("meeting-seat-06", "meeting-room", null, [-0.15, 0, 0.43], undefined, -1.57, "meetingSeat"),
  seat("meeting-seat-07", "meeting-room", null, [-3.48, 0, 1.94], undefined, 3.14, "meetingSeat"),
  seat("meeting-seat-08", "meeting-room", null, [-2.68, 0, 1.94], undefined, 3.14, "meetingSeat"),
  seat("meeting-seat-09", "meeting-room", null, [-1.91, 0, 1.94], undefined, 3.14, "meetingSeat"),
  seat("break-seat-01", "break-lounge", null, [3.85, 0, 5.75]),
  seat("break-seat-02", "break-lounge", null, [7.2, 0, 6.4]),
  seat("break-seat-03", "break-lounge", null, [9.25, 0, 5.7]),
];

const standPoints: PlacementPoint[] = [
  { id: "approval-wait-point", roomId: "approval-zone", position: [-2.49, 0, 5.0], rotation: 0, type: "waitingPoint" },
  { id: "director-report-point", roomId: "ceo-office", position: [-8.8, 0, -4.75], rotation: 0, type: "standPoint" },
  { id: "director-support-point", roomId: "director-room", position: [-3.3, 0, -4.75], rotation: 0, type: "standPoint" },
  { id: "error-response-point", roomId: "dev-ops-zone", position: [11.35, 0, 0.55], rotation: 0, type: "standPoint" },
  { id: "coffee-machine-point", roomId: "break-lounge", position: [11.05, 0, 5.25], rotation: 0, type: "standPoint" },
  { id: "pantry-counter-point", roomId: "break-lounge", position: [10.45, 0, 6.6], rotation: 0, type: "standPoint" },
  { id: "knowledge-search-point", roomId: "knowledge-audit-zone", position: [-9.05, 0, 0.55], rotation: 0, type: "standPoint" },
  { id: "secretary-reception-point", roomId: "review-zone", position: [-8.65, 0, 5.4], rotation: 0, type: "standPoint" },
  { id: "lobby-center", roomId: "central-corridor", position: [2.15, 0, 2.68], rotation: 0, type: "standPoint" },
  { id: "main-crossroad", roomId: "central-corridor", position: [2.15, 0, -0.31], rotation: 0, type: "standPoint" },
  { id: "entrance-point", roomId: "central-corridor", position: [2.15, 0, 8.15], rotation: 0, type: "standPoint" },
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
  desk("ceo-desk", "ceo-office", "ceo", [-10.45, 0, -6.45]),
  desk("director-desk", "director-room", "director", [-4.65, 0, -6.45]),
  desk("stock-desk", "market-analysis-room", "stock-monitor", [0.05, 0, -6.45]),
  desk("content-desk-01", "content-zone", "content-planner", [4.84, 0, -6.45]),
  desk("content-desk-02", "content-zone", "marketing-manager", [7.29, 0, -6.45]),
  desk("content-desk-03", "content-zone", "content-writer", [9.85, 0, -6.45]),
  desk("audit-desk", "knowledge-audit-zone", "qa-auditor", [-10.96, 0, -0.45]),
  desk("finance-desk", "finance-room", "finance-manager", [4.48, 0, -0.45]),
  desk("dev-desk", "dev-ops-zone", "developer", [9.17, 0, -0.45]),
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

const navNode = (id: string, position: Vec3, connectsTo: string[]): NavNode => ({ id, position, connectsTo });

const navNodes: NavNode[] = [
  navNode("upper-ceo-hall", [-10.39, 0, -3.35], ["ceo-room-node", "upper-director-hall"]),
  navNode("upper-director-hall", [-4.74, 0, -3.35], ["upper-ceo-hall", "director-room-node", "upper-market-hall"]),
  navNode("upper-market-hall", [0.2, 0, -3.35], ["upper-director-hall", "market-room-node", "upper-junction"]),
  navNode("upper-junction", [2.15, 0, -3.35], ["upper-market-hall", "upper-content-hall", "corridor-spine-mid"]),
  navNode("upper-content-hall", [8.08, 0, -3.35], ["upper-junction", "content-room-node"]),
  navNode("ceo-room-node", [-10.39, 0, -3.8], ["upper-ceo-hall"]),
  navNode("director-room-node", [-4.74, 0, -3.8], ["upper-director-hall"]),
  navNode("market-room-node", [0.2, 0, -3.8], ["upper-market-hall"]),
  navNode("content-room-node", [8.08, 0, -3.8], ["upper-content-hall"]),

  navNode("corridor-spine-mid", [2.15, 0, -0.31], ["upper-junction", "lower-junction"]),
  navNode("lower-west-hall", [-10.41, 0, 2.68], ["qa-room-node", "review-room-node", "lower-meeting-hall"]),
  navNode("lower-meeting-hall", [-2.35, 0, 2.68], ["lower-west-hall", "meeting-room-node", "approval-room-node", "lower-junction"]),
  navNode("lower-junction", [2.15, 0, 2.68], ["lower-meeting-hall", "lower-finance-hall", "corridor-spine-mid", "entrance-corridor-node"]),
  navNode("lower-finance-hall", [4.63, 0, 2.68], ["lower-junction", "finance-room-node", "lower-lounge-hall"]),
  navNode("lower-lounge-hall", [7.95, 0, 2.68], ["lower-finance-hall", "lounge-room-node", "lower-dev-hall"]),
  navNode("lower-dev-hall", [10.38, 0, 2.68], ["lower-lounge-hall", "dev-room-node"]),
  navNode("qa-room-node", [-10.41, 0, 2.25], ["lower-west-hall"]),
  navNode("meeting-room-node", [-2.35, 0, 2.25], ["lower-meeting-hall"]),
  navNode("finance-room-node", [4.63, 0, 2.25], ["lower-finance-hall"]),
  navNode("dev-room-node", [10.38, 0, 2.25], ["lower-dev-hall"]),
  navNode("review-room-node", [-10.37, 0, 3.05], ["lower-west-hall"]),
  navNode("approval-room-node", [-1.68, 0, 3.05], ["lower-meeting-hall"]),
  navNode("lounge-room-node", [7.95, 0, 3.05], ["lower-lounge-hall"]),
  navNode("entrance-corridor-node", [2.15, 0, 8.15], ["lower-junction"]),
];

export function createConceptOfficeLayout(base: OfficeLayout): OfficeLayout {
  return {
    ...base,
    office: { ...base.office, size: [28, 18], floorColor: "#111D2B", labelsEnabled: true },
    camera: {
      ...base.camera,
      // A centred, elevated isometric view keeps the full floor plate legible
      // and matches the symmetrical command-centre composition of the target.
      position: [0, 56, 16],
      target: [0, 0.2, 0.15],
      zoom: 34,
      minZoom: 21,
      maxZoom: 48,
      coverage: 0.985,
    },
    dimensions: {
      ...base.dimensions,
      outerWallHeight: 2.08,
      innerWallHeight: 1.82,
      glassWallHeight: 1.9,
      frontWallHeight: 0.68,
    },
    rooms,
    walls,
    doors,
    walkableAreas: [
      ...rooms.map((room) => ({ id: `${room.id}-walkable`, roomId: room.id, position: room.position, size: room.size })),
      { id: "upper-main-corridor", roomId: "central-corridor", position: [0, 0, -3.35] as Vec3, size: [27.6, 0.85] as [number, number] },
      { id: "lower-main-corridor", roomId: "central-corridor", position: [0, 0, 2.68] as Vec3, size: [27.6, 0.85] as [number, number] },
      { id: "central-vertical-corridor", roomId: "central-corridor", position: [2.15, 0, -0.31] as Vec3, size: [1.2, 5.2] as [number, number] },
      { id: "entrance-corridor", roomId: "central-corridor", position: [2.15, 0, 5.87] as Vec3, size: [1.2, 6.2] as [number, number] },
    ],
    destinations,
    seats,
    workPoints: [],
    standPoints,
    blockedAreas: [],
    navNodes,
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
