import { Html } from "@react-three/drei";
import type { OfficeLayout, OfficeRoom, Vec3 } from "./types";

const SHOW_ZONE_LABELS = true;

const ROOM_LABEL_ALIASES: Record<string, string> = {
  "review-zone": "secretary-zone",
};

const ROOM_LABEL_POSITION_OVERRIDES: Record<string, Vec3> = {
  "director-room": [-10.85, 0.2, -3.55],
  "meeting-room": [-3.9, 0.2, -3.55],
  "content-zone": [6.0, 0.2, -3.55],
  "review-zone": [-10.85, 0.2, 1.92],
  "dev-ops-zone": [-3.9, 0.2, 1.92],
  "finance-stock-zone": [6.0, 0.2, 1.92],
  "break-lounge": [-10.85, 0.2, 6.92],
  "lobby-common-zone": [-3.9, 0.2, 6.92],
  "pantry-coffee-zone": [1.55, 0.42, 6.92],
  "knowledge-audit-zone": [6.0, 0.2, 6.92],
};

function getLowerLeftLabelPosition(room: OfficeRoom): Vec3 {
  const [x, , z] = room.position;
  const [width, depth] = room.size;

  return [
    x - width / 2 + 0.65,
    room.parentId ? 0.42 : 0.2,
    z + depth / 2 - 0.9,
  ];
}

export function OfficeLabels({
  layout,
  enabled,
}: {
  layout: OfficeLayout;
  enabled: boolean;
}) {
  if (!enabled || !SHOW_ZONE_LABELS) return null;

  return (
    <group>
      {layout.rooms.map((room) => {
        const roomLabelId = ROOM_LABEL_ALIASES[room.id] ?? room.id;
        const labelPosition =
          ROOM_LABEL_POSITION_OVERRIDES[room.id] ?? getLowerLeftLabelPosition(room);

        return (
          <Html
            key={room.id}
            position={labelPosition}
            occlude={false}
            center={false}
            zIndexRange={[5, 0]}
          >
            <div
              className={`office-room-label-text ${
                room.parentId ? "office-room-label-sub-text" : ""
              }`}
            >
              <strong>{room.name}</strong>
              <span>{roomLabelId}</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
