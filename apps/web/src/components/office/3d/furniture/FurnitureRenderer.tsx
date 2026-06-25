import { Board } from "./Board";
import { Chair } from "./Chair";
import { Desk } from "./Desk";
import { DigitalSign } from "./DigitalSign";
import { DeviceBox } from "./DeviceBox";
import { FloorRug } from "./FloorRug";
import { Lamp } from "./Lamp";
import { Partition } from "./Partition";
import { Plant } from "./Plant";
import { PropBox } from "./PropBox";
import { Sofa } from "./Sofa";
import { StorageCabinet } from "./StorageCabinet";
import { Table } from "./Table";
import { TeamBench } from "./TeamBench";
import type { FurnitureItem, OfficeLayout } from "../types";

function RenderItem({ item }: { item: FurnitureItem }) {
  switch (item.type) {
    case "board":
    case "logoBoard":
    case "contentBoard":
    case "reviewBoard":
      return <Board item={item} />;
    case "digitalSign":
      return <DigitalSign item={item} />;
    case "bookcase":
    case "shelf":
    case "storage":
    case "documentCabinet":
      return <StorageCabinet item={item} />;
    case "plant":
      return <Plant item={item} />;
    case "sofa":
      return <Sofa item={item} />;
    case "roundMeetingTable":
    case "smallMeetingTable":
    case "loungeTable":
    case "barTable":
      return <Table item={item} />;
    case "serverRack":
    case "printer":
    case "coffeeMachine":
    case "waterDispenser":
      return <DeviceBox item={item} />;
    case "chair":
      return <Chair position={item.position} rotation={item.rotation} color={item.color} />;
    case "stool":
      return <Chair position={item.position} rotation={item.rotation} color={item.color ?? "#D6B48F"} />;
    case "expansionZone":
    case "rug":
    case "floorRug":
      return <FloorRug item={item} />;
    case "partition":
      return <Partition item={item} />;
    case "lamp":
      return <Lamp item={item} />;
    case "propBox":
      return <PropBox item={item} />;
    case "teamBench":
      return <TeamBench item={item} />;
    default:
      return null;
  }
}

export function FurnitureRenderer({ layout }: { layout: OfficeLayout }) {
  const furniture = layout.furniture;
  if (!furniture) return null;

  return (
    <group>
      {furniture.expansionZones.map((zone) => <FloorRug key={zone.id} item={zone} />)}
      {furniture.items.map((item) => <RenderItem key={item.id} item={item} />)}
      {furniture.desks.map((desk) => <Desk key={desk.id} desk={desk} debug={layout.debug.showNavigationDebug} />)}
    </group>
  );
}
