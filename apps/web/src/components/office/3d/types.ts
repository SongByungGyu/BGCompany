export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type OfficeRoom = {
  id: string;
  name: string;
  position: Vec3;
  size: Vec2;
  color: string;
  wallType: "glass" | "low" | "open";
  parentId?: string;
};

export type OfficeWall = {
  id: string;
  position: Vec3;
  size: Vec2;
  heightType: "outer" | "inner" | "glass" | "front";
  material: "solid" | "glass";
};

export type OfficeDoor = {
  id: string;
  position: Vec3;
  size: Vec2;
  connects: string[];
  width: number;
};

export type OfficeDestination = {
  id: string;
  roomId: string;
  position: Vec3;
};

export type WalkableArea = {
  id: string;
  roomId?: string;
  position: Vec3;
  size: Vec2;
};

export type NavNode = {
  id: string;
  position: Vec3;
  connectsTo: string[];
};

export type FurnitureDesk = {
  id: string;
  roomId: string;
  position: Vec3;
  rotation: number;
  assignedEmployeeId: string | null;
  isReserved: boolean;
  capacity: number;
};

export type FurnitureItem = {
  id: string;
  roomId: string;
  type:
    | "barTable"
    | "board"
    | "bookcase"
    | "chair"
    | "coffeeMachine"
    | "contentBoard"
    | "digitalSign"
    | "documentCabinet"
    | "expansionZone"
    | "floorRug"
    | "logoBoard"
    | "loungeTable"
    | "lamp"
    | "partition"
    | "plant"
    | "printer"
    | "propBox"
    | "reviewBoard"
    | "roundMeetingTable"
    | "rug"
    | "serverRack"
    | "shelf"
    | "smallMeetingTable"
    | "sofa"
    | "stool"
    | "storage"
    | "teamBench"
    | "waterDispenser";
  position: Vec3;
  rotation: number;
  size?: Vec3;
  color?: string;
};

export type EmployeeGroup = "working" | "meeting" | "waiting" | "error" | "done" | "idle";

export type OfficeEmployee = {
  id: string;
  name: string;
  initial: string;
  department: string;
  status: string;
  group: EmployeeGroup;
};

export type OfficeLayout = {
  office: {
    size: Vec2;
    floorHeight: number;
    floorColor: string;
    labelsEnabled: boolean;
  };
  debug: {
    showGrid: boolean;
    showNavigationDebug: boolean;
    showOfficeDebugLabels: boolean;
  };
  camera: {
    position: Vec3;
    up: Vec3;
    target: Vec3;
    zoom: number;
    minZoom: number;
    maxZoom: number;
    coverage: number;
  };
  dimensions: {
    outerWallHeight: number;
    innerWallHeight: number;
    glassWallHeight: number;
    wallThickness: number;
    frontWallHeight: number;
  };
  rooms: OfficeRoom[];
  walls: OfficeWall[];
  walkableAreas: WalkableArea[];
  doors: OfficeDoor[];
  destinations: OfficeDestination[];
  navNodes: NavNode[];
  furniture?: {
    desks: FurnitureDesk[];
    expansionZones: FurnitureItem[];
    items: FurnitureItem[];
  };
  employeeSeats: Record<string, string>;
};
