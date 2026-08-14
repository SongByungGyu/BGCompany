import { Html } from "@react-three/drei";
import type { OfficeLayout, OfficeRoom, Vec3 } from "./types";

const SHOW_ZONE_LABELS = true;

const ROOM_NUMBERS: Record<string, number> = {
  "ceo-office": 1,
  "director-room": 2,
  "market-analysis-room": 3,
  "content-zone": 4,
  "knowledge-audit-zone": 5,
  "finance-room": 6,
  "dev-ops-zone": 7,
  "review-zone": 8,
  "meeting-room": 9,
  "approval-zone": 10,
  "break-lounge": 11,
};

const ROOM_LABEL_ALIASES: Record<string, string> = {
  "ceo-office": "병규",
  "director-room": "루나",
  "market-analysis-room": "서준",
  "meeting-room": "협업 · 인수인계",
  "content-zone": "미나 · 카이 · 지아",
  "review-zone": "Local Agent",
  "dev-ops-zone": "하늘",
  "finance-room": "도윤",
  "finance-stock-zone": "서준 · 도윤",
  "break-lounge": "휴식 · 재충전",
  "approval-zone": "승인 대기 · 최종 판단",
  "lobby-common-zone": "승인 대기 · 이동 허브",
  "knowledge-audit-zone": "윤아",
  "pantry-coffee-zone": "커피 · 스낵",
};

const ROOM_LABEL_POSITION_OVERRIDES: Record<string, Vec3> = {};

function getLowerLeftLabelPosition(room: OfficeRoom): Vec3 {
  const [x, , z] = room.position;
  const [width, depth] = room.size;

  return [
    x - width / 2 + 0.65,
    room.parentId ? 0.72 : 0.82,
    z - depth / 2 + 0.58,
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
              <div>
                {ROOM_NUMBERS[room.id] ? <b>{ROOM_NUMBERS[room.id]}</b> : null}
                <strong>{room.name}</strong>
                <i />
              </div>
              <span>{roomLabelId}</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
