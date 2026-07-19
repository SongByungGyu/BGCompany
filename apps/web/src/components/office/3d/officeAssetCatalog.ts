const FURNITURE_ROOT = "/office/models/furniture";
const CHARACTER_ROOT = "/office/models/characters";

export const officeFurnitureModels = {
  bookcaseClosedWide: `${FURNITURE_ROOT}/bookcaseClosedWide.glb`,
  bookcaseOpen: `${FURNITURE_ROOT}/bookcaseOpen.glb`,
  cabinet: `${FURNITURE_ROOT}/cabinetTelevisionDoors.glb`,
  chair: `${FURNITURE_ROOT}/chairDesk.glb`,
  coffeeMachine: `${FURNITURE_ROOT}/kitchenCoffeeMachine.glb`,
  computerKeyboard: `${FURNITURE_ROOT}/computerKeyboard.glb`,
  computerMouse: `${FURNITURE_ROOT}/computerMouse.glb`,
  computerScreen: `${FURNITURE_ROOT}/computerScreen.glb`,
  desk: `${FURNITURE_ROOT}/desk.glb`,
  floorLamp: `${FURNITURE_ROOT}/lampSquareFloor.glb`,
  laptop: `${FURNITURE_ROOT}/laptop.glb`,
  loungeChair: `${FURNITURE_ROOT}/loungeDesignChair.glb`,
  loungeSofa: `${FURNITURE_ROOT}/loungeDesignSofa.glb`,
  loungeSofaCorner: `${FURNITURE_ROOT}/loungeDesignSofaCorner.glb`,
  plant: `${FURNITURE_ROOT}/pottedPlant.glb`,
  plantSmall: `${FURNITURE_ROOT}/plantSmall2.glb`,
  rug: `${FURNITURE_ROOT}/rugRectangle.glb`,
  tableCoffee: `${FURNITURE_ROOT}/tableCoffeeGlass.glb`,
  tableCross: `${FURNITURE_ROOT}/tableCross.glb`,
  trashcan: `${FURNITURE_ROOT}/trashcan.glb`,
} as const;

export const officeCharacterModels: Record<string, string> = {
  ceo: `${CHARACTER_ROOT}/character-a.glb`,
  director: `${CHARACTER_ROOT}/character-b.glb`,
  "stock-monitor": `${CHARACTER_ROOT}/character-c.glb`,
  "content-planner": `${CHARACTER_ROOT}/character-d.glb`,
  "marketing-manager": `${CHARACTER_ROOT}/character-e.glb`,
  "content-writer": `${CHARACTER_ROOT}/character-f.glb`,
  "qa-auditor": `${CHARACTER_ROOT}/character-g.glb`,
  "finance-manager": `${CHARACTER_ROOT}/character-h.glb`,
  developer: `${CHARACTER_ROOT}/character-i.glb`,
};

export const fallbackCharacterModel = `${CHARACTER_ROOT}/character-j.glb`;

export const officeMaterialTextures = {
  darkWood: {
    map: "/office/materials/dark-wood/diffuse.jpg",
    normalMap: "/office/materials/dark-wood/normal.jpg",
    roughnessMap: "/office/materials/dark-wood/roughness.jpg",
  },
  parquet: {
    map: "/office/materials/parquet/diffuse.jpg",
    normalMap: "/office/materials/parquet/normal.jpg",
    roughnessMap: "/office/materials/parquet/roughness.jpg",
  },
} as const;

export const officeModelUrls = [
  ...Object.values(officeFurnitureModels),
  ...Object.values(officeCharacterModels),
  fallbackCharacterModel,
];
