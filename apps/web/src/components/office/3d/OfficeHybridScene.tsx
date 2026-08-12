"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  buildRuntimeWaypointRoute,
  resolveEmployeeMovementPlans,
  type MovementDestinationType,
} from "./employeeMovement";
import type { OfficeEmployee, OfficeLayout, OfficeRoom, Vec3 } from "./types";

const VIEW_WIDTH = 1400;
const VIEW_HEIGHT = 820;
const PAD_X = 24;
const PAD_Y = 28;
const FLOOR_WIDTH = VIEW_WIDTH - PAD_X * 2;
const FLOOR_HEIGHT = VIEW_HEIGHT - PAD_Y * 2;

type ScreenPoint = { x: number; y: number };
type ScreenRoom = ScreenPoint & { width: number; height: number };

type RoomMeta = {
  number: string;
  title: string;
  subtitle: string;
  accent?: "teal" | "gold" | "red";
};

const roomMeta: Record<string, RoomMeta> = {
  "ceo-office": { number: "1", title: "대표실", subtitle: "병규" },
  "director-room": { number: "2", title: "AI 디렉터실", subtitle: "루나" },
  "market-analysis-room": { number: "3", title: "트레이더 팀", subtitle: "서준 · 민서 · 태오" },
  "content-zone": { number: "4", title: "콘텐츠 스튜디오", subtitle: "미나 · 카이 · 지아" },
  "knowledge-audit-zone": { number: "5", title: "QA·감사실", subtitle: "윤아" },
  "meeting-room": { number: "9", title: "중앙 회의실", subtitle: "협업 · 의사결정" },
  "finance-room": { number: "6", title: "재정실", subtitle: "도윤" },
  "dev-ops-zone": { number: "7", title: "개발·서버실", subtitle: "준범", accent: "red" },
  "review-zone": { number: "8", title: "발행 스테이션", subtitle: "로컬 발행 Agent" },
  "approval-zone": { number: "10", title: "승인 게이트", subtitle: "승인 대기 · 최종 판단", accent: "gold" },
  "break-lounge": { number: "11", title: "라운지", subtitle: "휴식 · 재충전" },
};


type EmployeeVisualStyle = CSSProperties & Record<string, string>;

function worldToScreen(position: Vec3): ScreenPoint {
  return {
    x: PAD_X + ((position[0] + 14) / 28) * FLOOR_WIDTH,
    y: PAD_Y + ((position[2] + 9) / 18) * FLOOR_HEIGHT,
  };
}

function toScreenRoom(room: OfficeRoom): ScreenRoom {
  const topLeft = worldToScreen([
    room.position[0] - room.size[0] / 2,
    0,
    room.position[2] - room.size[1] / 2,
  ]);
  return {
    ...topLeft,
    width: (room.size[0] / 28) * FLOOR_WIDTH,
    height: (room.size[1] / 18) * FLOOR_HEIGHT,
  };
}

function Monitor({ x, y, width = 48, chart = false }: { x: number; y: number; width?: number; chart?: boolean }) {
  return (
    <g className="hybrid-monitor">
      <rect x={x - 2} y={y + 3} width={width + 4} height="26" rx="4" fill="#01060b" opacity="0.7" />
      <rect x={x} y={y} width={width} height="25" rx="3" fill="#07131f" stroke="#8193a1" strokeWidth="2" />
      <rect x={x + 4} y={y + 4} width={width - 8} height="16" rx="1" fill="url(#monitorGlow)" filter="url(#screenBloom)" />
      <path d={`M ${x + 5} ${y + 5} H ${x + width - 5}`} stroke="#b8f6ff" strokeWidth="1" opacity="0.35" />
      {chart ? (
        <>
          {[0.2, 0.38, 0.56, 0.74].map((ratio, index) => (
            <g key={ratio}>
              <line x1={x + width * ratio} y1={y + 8 + (index % 2) * 2} x2={x + width * ratio} y2={y + 17 - (index % 2)} stroke={index === 2 ? "#ff806f" : "#55dfd0"} strokeWidth="1" />
              <rect x={x + width * ratio - 1.7} y={y + 10 + (index % 2) * 2} width="3.4" height="5" fill={index === 2 ? "#ff806f" : "#55dfd0"} />
            </g>
          ))}
          <polyline
            points={`${x + 6},${y + 17} ${x + width * 0.27},${y + 11} ${x + width * 0.45},${y + 15} ${x + width * 0.67},${y + 7} ${x + width - 6},${y + 10}`}
            fill="none"
            stroke="#71f0e3"
            strokeWidth="1.7"
          />
        </>
      ) : (
        <>
          <rect x={x + 7} y={y + 8} width={width * 0.42} height="2" fill="#4fc4ff" />
          <rect x={x + 7} y={y + 13} width={width * 0.65} height="2" fill="#2976a0" />
        </>
      )}
      <rect x={x + width / 2 - 2} y={y + 25} width="4" height="7" fill="#526576" />
      <rect x={x + width / 2 - 9} y={y + 31} width="18" height="3" rx="1" fill="#3b4a57" />
    </g>
  );
}

function Desk({
  x,
  y,
  width = 104,
  wood = false,
  chart = false,
  monitors = 2,
}: {
  x: number;
  y: number;
  width?: number;
  wood?: boolean;
  chart?: boolean;
  monitors?: number;
}) {
  const monitorWidth = Math.min(52, (width - 18) / monitors);
  return (
    <g>
      <rect x={x + 5} y={y + 15} width={width} height="42" rx="4" fill="#050c13" opacity="0.58" />
      <rect
        x={x}
        y={y}
        width={width}
        height="43"
        rx="4"
        fill={wood ? "url(#deskWood)" : "url(#deskSurface)"}
        stroke={wood ? "#8e704f" : "#56697a"}
        strokeWidth="2"
      />
      {Array.from({ length: monitors }, (_, index) => (
        <Monitor
          key={index}
          x={x + 8 + index * ((width - 16) / monitors)}
          y={y - 18}
          width={monitorWidth}
          chart={chart || index === monitors - 1}
        />
      ))}
      <rect x={x + width * 0.33} y={y + 25} width={width * 0.34} height="7" rx="2" fill="#111b24" stroke="#71808c" strokeWidth="1" />
      <rect x={x + width * 0.37} y={y + 28} width={width * 0.26} height="1" fill="#8da4b5" opacity="0.7" />
      <circle cx={x + width - 13} cy={y + 29} r="5" fill="#c8d1d5" stroke="#6d7b83" />
      <circle cx={x + width - 13} cy={y + 29} r="2.5" fill="#5b3926" />
      <path d={`M ${x + 12} ${y + 27} h 16 v 9 h -16 z`} fill="#d7d4c9" opacity="0.72" transform={`rotate(-5 ${x + 20} ${y + 31})`} />
      <rect x={x + width * 0.12} y={y + 43} width="9" height="19" fill="#26323d" />
      <rect x={x + width * 0.79} y={y + 43} width="9" height="19" fill="#26323d" />
      <path d={`M ${x + 5} ${y + 7} H ${x + width - 5}`} stroke="#dbe7ef" strokeWidth="1" opacity="0.28" />
    </g>
  );
}

function Chair({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`rotate(${rotate} ${x} ${y})`}>
      <ellipse cx={x} cy={y + 13} rx="18" ry="8" fill="#02070c" opacity="0.45" />
      <rect x={x - 13} y={y - 2} width="26" height="26" rx="9" fill="#202a35" stroke="#5a6b7c" />
      <rect x={x - 10} y={y - 15} width="20" height="18" rx="7" fill="#2f3b48" stroke="#6a7a89" />
      <path d={`M ${x - 10} ${y - 9} Q ${x} ${y - 3} ${x + 10} ${y - 9}`} fill="none" stroke="#8fa0ac" strokeWidth="1" opacity="0.7" />
      <path d={`M ${x - 18} ${y + 5} H ${x - 10} M ${x + 10} ${y + 5} H ${x + 18}`} stroke="#6e8190" strokeWidth="3" />
      <path d={`M ${x - 14} ${y + 22} L ${x + 14} ${y + 22}`} stroke="#66788a" strokeWidth="3" />
      <circle cx={x - 14} cy={y + 23} r="2.4" fill="#111b24" />
      <circle cx={x + 14} cy={y + 23} r="2.4" fill="#111b24" />
    </g>
  );
}

function Plant({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="16" rx="13" ry="5" fill="#02080a" opacity="0.4" />
      <path d="M -8 8 L 8 8 L 5 22 L -5 22 Z" fill="#765b42" stroke="#aa8662" />
      <ellipse cx="-7" cy="1" rx="7" ry="13" fill="#28765e" transform="rotate(-38 -7 1)" />
      <ellipse cx="8" cy="0" rx="7" ry="14" fill="#3b9b78" transform="rotate(38 8 0)" />
      <ellipse cx="1" cy="-8" rx="7" ry="14" fill="#54b487" />
      <path d="M 0 9 V -12 M 0 1 L -10 -4 M 0 1 L 11 -5" stroke="#8bd6a9" strokeWidth="1.4" opacity="0.8" />
    </g>
  );
}

function RoomFurniture({ room, seats }: { room: OfficeRoom; seats: OfficeLayout["seats"] }) {
  const r = toScreenRoom(room);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const meetingSeats = seats.filter((seat) => seat.roomId === room.id && seat.type === "meetingSeat");

  switch (room.id) {
    case "ceo-office":
      return (
        <g className="hybrid-furniture">
          <rect x={r.x + 14} y={r.y + 34} width="34" height={r.height - 60} rx="4" fill="url(#bookcase)" stroke="#8f6e49" />
          <Desk x={cx - 64} y={cy - 12} width={128} wood monitors={1} />
          <Chair x={cx} y={cy + 58} />
          <circle cx={r.x + r.width - 27} cy={r.y + r.height - 30} r="10" fill="#e2b86b" opacity="0.88" />
          <path d={`M ${r.x + r.width - 27} ${r.y + r.height - 23} L ${r.x + r.width - 27} ${r.y + r.height - 8}`} stroke="#9b7845" strokeWidth="4" />
        </g>
      );
    case "director-room":
      return (
        <g className="hybrid-furniture">
          <Desk x={cx - 61} y={cy - 18} width={122} monitors={3} />
          <Chair x={cx} y={cy + 54} />
          <Plant x={r.x + r.width - 24} y={r.y + r.height - 32} scale={0.75} />
        </g>
      );
    case "market-analysis-room":
      return (
        <g className="hybrid-furniture">
          <rect x={r.x + 20} y={r.y + 35} width={r.width - 40} height="34" rx="3" fill="#071827" stroke="#245e80" />
          <polyline
            points={`${r.x + 29},${r.y + 60} ${r.x + 57},${r.y + 47} ${r.x + 78},${r.y + 54} ${r.x + 105},${r.y + 42} ${r.x + r.width - 28},${r.y + 48}`}
            fill="none"
            stroke="#49d5d0"
            strokeWidth="3"
          />
          {[0, 1, 2].map((index) => {
            const stationWidth = 54;
            const x = cx - 91 + index * 64;
            return <g key={index}><Desk x={x} y={cy + 14} width={stationWidth} monitors={1} chart /><Chair x={x + stationWidth / 2} y={cy + 70} /></g>;
          })}
        </g>
      );
    case "content-zone": {
      const stationWidth = (r.width - 76) / 3;
      return (
        <g className="hybrid-furniture">
          {[0, 1, 2].map((index) => {
            const x = r.x + 24 + index * (stationWidth + 14);
            return (
              <g key={index}>
                <Desk x={x} y={cy - 21} width={stationWidth} monitors={2} />
                <Chair x={x + stationWidth / 2} y={cy + 47} />
              </g>
            );
          })}
          <Plant x={r.x + r.width - 24} y={r.y + r.height - 30} scale={0.7} />
        </g>
      );
    }
    case "knowledge-audit-zone":
      return (
        <g className="hybrid-furniture">
          <rect x={r.x + 22} y={r.y + 35} width={r.width - 44} height="40" rx="4" fill="#071827" stroke="#278a9b" />
          {[0, 1, 2].map((index) => (
            <g key={index}>
              <rect x={r.x + 32} y={r.y + 45 + index * 9} width="8" height="4" fill="#53d8c9" />
              <rect x={r.x + 46} y={r.y + 45 + index * 9} width={r.width - 88} height="3" fill="#38566d" />
            </g>
          ))}
          <Desk x={cx - 66} y={cy + 18} width={132} monitors={2} />
          <Chair x={cx} y={cy + 82} />
          <Plant x={r.x + r.width - 25} y={r.y + r.height - 28} scale={0.7} />
        </g>
      );
    case "meeting-room":
      return (
        <g className="hybrid-furniture">
          <rect x={cx - 71} y={r.y + 33} width="142" height="34" rx="4" fill="#061827" stroke="#2f647d" />
          <text x={cx} y={r.y + 55} textAnchor="middle" fill="#d8f7ff" fontSize="13" fontWeight="700">BG Company</text>
          <rect x={cx - 112} y={cy - 22} width="224" height="92" rx="15" fill="url(#meetingTable)" stroke="#d8e1e8" strokeWidth="3" />
          <rect x={cx - 88} y={cy - 7} width="176" height="8" rx="4" fill="#bac6d0" opacity="0.7" />
          {meetingSeats.map((seat) => {
            const point = worldToScreen(seat.position);
            return (
              <Chair
                key={seat.id}
                x={point.x}
                y={point.y}
                rotate={180 - ((seat.rotation ?? 0) * 180) / Math.PI}
              />
            );
          })}
          <Plant x={r.x + 23} y={r.y + r.height - 28} scale={0.75} />
          <Plant x={r.x + r.width - 23} y={r.y + r.height - 28} scale={0.75} />
        </g>
      );
    case "finance-room":
      return (
        <g className="hybrid-furniture">
          <rect x={r.x + 16} y={r.y + 38} width={r.width - 32} height="35" rx="3" fill="#071827" stroke="#34687d" />
          <circle cx={r.x + 39} cy={r.y + 55} r="10" fill="none" stroke="#54d6c8" strokeWidth="5" strokeDasharray="20 9" />
          <rect x={r.x + 58} y={r.y + 46} width={r.width - 83} height="4" fill="#2f9fbd" />
          <rect x={r.x + 58} y={r.y + 58} width={(r.width - 83) * 0.72} height="4" fill="#d6a945" />
          <Desk x={cx - 58} y={cy + 13} width={116} monitors={2} chart />
          <Chair x={cx} y={cy + 77} />
        </g>
      );
    case "dev-ops-zone":
      return (
        <g className="hybrid-furniture">
          <Desk x={r.x + 38} y={cy + 5} width={150} monitors={3} />
          <Chair x={r.x + 113} y={cy + 69} />
          {[0, 1].map((index) => (
            <g key={index}>
              <rect x={r.x + r.width - 95 + index * 45} y={r.y + 42} width="34" height={r.height - 75} rx="3" fill="#05090e" stroke="#5d6974" strokeWidth="2" />
              {Array.from({ length: 7 }, (_, light) => (
                <rect key={light} x={r.x + r.width - 89 + index * 45} y={r.y + 52 + light * 14} width="22" height="4" fill={light % 3 === 0 ? "#ef6b4a" : "#31bfc0"} opacity="0.85" />
              ))}
            </g>
          ))}
          <path d={`M ${r.x + 18} ${r.y + r.height - 10} H ${r.x + r.width - 18}`} stroke="#d35848" strokeWidth="3" opacity="0.55" />
        </g>
      );
    case "review-zone":
      return (
        <g className="hybrid-furniture">
          <rect x={cx - 84} y={cy - 23} width="168" height="67" rx="9" fill="#263b4c" stroke="#5a788c" strokeWidth="3" />
          <Monitor x={cx - 55} y={cy - 37} width={110} />
          <g transform={`translate(${cx - 118} ${cy + 24})`}>
            <circle cx="0" cy="0" r="28" fill="#e9f3f5" stroke="#4ed9d1" strokeWidth="3" />
            <rect x="-21" y="24" width="42" height="20" rx="8" fill="#c7d7dc" stroke="#4ed9d1" />
            <circle cx="-9" cy="-2" r="4" fill="#0a95a2" />
            <circle cx="9" cy="-2" r="4" fill="#0a95a2" />
            <path d="M -9 9 Q 0 15 9 9" fill="none" stroke="#0a95a2" strokeWidth="3" />
          </g>
          <Plant x={r.x + r.width - 24} y={r.y + r.height - 28} scale={0.75} />
        </g>
      );
    case "approval-zone":
      return (
        <g className="hybrid-furniture">
          <rect x={cx - 105} y={cy - 28} width="210" height="87" rx="8" fill="#2b2115" stroke="#b8893d" strokeWidth="3" />
          <path d={`M ${cx - 92} ${cy - 13} H ${cx + 92} L ${cx + 76} ${cy + 42} H ${cx - 76} Z`} fill="url(#approvalDesk)" stroke="#e0ae53" strokeWidth="3" />
          <path d={`M ${cx} ${cy - 4} L ${cx + 19} ${cy + 7} L ${cx + 14} ${cy + 31} L ${cx} ${cy + 42} L ${cx - 14} ${cy + 31} L ${cx - 19} ${cy + 7} Z`} fill="none" stroke="#ffe29a" strokeWidth="3" />
          <Plant x={cx - 126} y={cy + 41} scale={0.68} />
          <Plant x={cx + 126} y={cy + 41} scale={0.68} />
        </g>
      );
    case "break-lounge":
      return (
        <g className="hybrid-furniture">
          <rect x={r.x + 44} y={r.y + 56} width={r.width - 178} height={r.height - 82} rx="15" fill="#22313b" stroke="#344b59" />
          <path d={`M ${r.x + 78} ${cy - 11} H ${cx + 70} V ${cy + 25} H ${r.x + 78} Z`} fill="#66717d" stroke="#87949f" strokeWidth="3" />
          <path d={`M ${r.x + 63} ${cy - 2} V ${cy + 72} H ${r.x + 101} V ${cy - 2} Z`} fill="#596672" stroke="#82909a" strokeWidth="3" />
          <ellipse cx={cx + 35} cy={cy + 53} rx="45" ry="26" fill="#6d4a36" stroke="#a87851" strokeWidth="3" />
          <ellipse cx={cx + 35} cy={cy + 51} rx="14" ry="8" fill="#d8d0c2" />
          <rect x={r.x + r.width - 115} y={r.y + 62} width="86" height={r.height - 98} rx="4" fill="#6f5942" stroke="#998066" />
          <rect x={r.x + r.width - 97} y={r.y + 45} width="30" height="39" rx="4" fill="#c3c8c8" stroke="#e0e5e5" />
          <circle cx={r.x + r.width - 82} cy={r.y + 66} r="8" fill="#222a2c" />
          <Plant x={r.x + 25} y={r.y + r.height - 28} scale={0.85} />
          <Plant x={r.x + r.width - 25} y={r.y + r.height - 28} scale={0.75} />
        </g>
      );
    default:
      return null;
  }
}

function RoomShell({ room, seats }: { room: OfficeRoom; seats: OfficeLayout["seats"] }) {
  const r = toScreenRoom(room);
  const meta = roomMeta[room.id] ?? { number: "", title: room.name, subtitle: "" };
  const labelWidth = Math.min(r.width - 28, Math.max(142, meta.title.length * 7.25 + 68));
  const titleFontSize = meta.title.length > 18 ? 10.5 : meta.title.length > 14 ? 11.5 : 13;
  const accentColor = meta.accent === "gold" ? "#d9a23a" : meta.accent === "red" ? "#e45f4b" : "#44ddcf";
  const floorFill = room.id === "ceo-office" ? "url(#executiveWoodPhoto)" : room.id === "break-lounge" ? "url(#loungeFloorPhoto)" : "url(#roomFloor)";
  const warmRoom = room.id === "ceo-office" || room.id === "approval-zone" || room.id === "break-lounge";

  return (
    <g className={`hybrid-room hybrid-room-${room.id}`} filter="url(#roomDepthShadow)">
      <path d={`M ${r.x + 14} ${r.y + 15} H ${r.x + r.width + 14} V ${r.y + r.height + 16} H ${r.x + 14} Z`} fill="#000309" opacity="0.78" />
      <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={floorFill} stroke="#63798b" strokeWidth="3" />
      <rect x={r.x + 5} y={r.y + 18} width={r.width - 10} height={r.height - 31} fill={warmRoom ? "url(#warmRoomLight)" : "url(#coolRoomLight)"} opacity="0.58" />
      <rect x={r.x + 13} y={r.y + 24} width={r.width - 26} height="5" rx="2.5" fill={warmRoom ? "#ffd29a" : "#89ecff"} opacity="0.52" filter="url(#screenBloom)" />
      <path d={`M ${r.x + 17} ${r.y + 34} H ${r.x + r.width - 17}`} stroke="#bfd5e2" strokeWidth="1" opacity="0.2" />
      <path d={`M ${r.x + r.width * 0.33} ${r.y + 22} V ${r.y + r.height - 16} M ${r.x + r.width * 0.67} ${r.y + 22} V ${r.y + r.height - 16}`} stroke="#86a1b2" strokeWidth="1" opacity="0.12" />
      <rect x={r.x + 4} y={r.y + 4} width={r.width - 8} height="13" fill="url(#metalWall)" stroke="#8ca0ae" strokeWidth="1.5" />
      <path d={`M ${r.x} ${r.y} L ${r.x + 12} ${r.y + 13} V ${r.y + r.height - 3} L ${r.x} ${r.y + r.height} Z`} fill="#3d5263" stroke="#6b8294" strokeWidth="2" />
      <path d={`M ${r.x + r.width} ${r.y} L ${r.x + r.width - 12} ${r.y + 13} V ${r.y + r.height - 3} L ${r.x + r.width} ${r.y + r.height} Z`} fill="#253746" stroke="#5d7588" strokeWidth="2" />
      <rect x={r.x + 2} y={r.y + r.height - 10} width={r.width - 4} height="13" fill="url(#glassFront)" stroke="#6f8797" strokeWidth="2" opacity="0.88" />
      <path d={`M ${r.x + 18} ${r.y + r.height - 8} L ${r.x + r.width * 0.38} ${r.y + r.height + 1} M ${r.x + r.width * 0.55} ${r.y + r.height - 8} L ${r.x + r.width - 26} ${r.y + r.height + 1}`} stroke="#d4f3ff" strokeWidth="1.2" opacity="0.26" />
      <RoomFurniture room={room} seats={seats} />
      <g className="hybrid-room-label" transform={`translate(${r.x + 16} ${r.y + 17})`}>
        <rect width={labelWidth} height="48" rx="10" fill="url(#labelGlass)" stroke="#688196" strokeWidth="1.6" />
        <path d={`M 10 5 H ${labelWidth - 10}`} stroke="#bdefff" strokeWidth="1" opacity="0.25" />
        <circle cx="19" cy="19" r="11" fill="#d9e2e8" />
        <text x="19" y="23" textAnchor="middle" fill="#102131" fontSize="12" fontWeight="900">{meta.number}</text>
        <text x="38" y="20" fill="#f2f7fa" fontSize={titleFontSize} fontWeight="800">{meta.title}</text>
        <text x="38" y="37" fill="#9eb1bf" fontSize="10">{meta.subtitle}</text>
        <circle cx={labelWidth - 13} cy="16" r="5" fill={accentColor} filter="url(#smallGlow)" />
      </g>
    </g>
  );
}

function CorridorLayer({ layout }: { layout: OfficeLayout }) {
  const spineX = 2.15;
  const upper = worldToScreen([0, 0, -3.35]);
  const lower = worldToScreen([0, 0, 2.68]);
  const spineTop = worldToScreen([spineX, 0, -3.78]);
  const spineBottom = worldToScreen([spineX, 0, 8.15]);
  const corridorHeight = (0.85 / 18) * FLOOR_HEIGHT;
  const spineWidth = (1.18 / 28) * FLOOR_WIDTH;

  return (
    <g className="hybrid-corridors">
      <rect x={PAD_X} y={upper.y - corridorHeight / 2} width={FLOOR_WIDTH} height={corridorHeight} fill="url(#corridorFloor)" stroke="#375b72" strokeWidth="3" />
      <rect x={PAD_X} y={lower.y - corridorHeight / 2} width={FLOOR_WIDTH} height={corridorHeight} fill="url(#corridorFloor)" stroke="#375b72" strokeWidth="3" />
      <rect x={spineTop.x - spineWidth / 2} y={spineTop.y} width={spineWidth} height={spineBottom.y - spineTop.y} fill="url(#corridorFloor)" stroke="#375b72" strokeWidth="3" />
      <line x1={PAD_X + 30} y1={upper.y} x2={VIEW_WIDTH - PAD_X - 30} y2={upper.y} stroke="#63b8ca" strokeWidth="2" strokeDasharray="17 12" opacity="0.48" />
      <line x1={PAD_X + 30} y1={lower.y} x2={VIEW_WIDTH - PAD_X - 30} y2={lower.y} stroke="#63b8ca" strokeWidth="2" strokeDasharray="17 12" opacity="0.48" />
      <line x1={spineTop.x} y1={spineTop.y + 8} x2={spineTop.x} y2={spineBottom.y - 8} stroke="#63b8ca" strokeWidth="2" strokeDasharray="13 10" opacity="0.48" />
      <path d={`M ${PAD_X + 92} ${lower.y - 7} H ${spineTop.x - 53} V ${upper.y + 7} H ${VIEW_WIDTH - PAD_X - 98}`} fill="none" stroke="#53dfd2" strokeWidth="3" strokeLinecap="round" strokeDasharray="9 8" opacity="0.58" filter="url(#routeGlow)" markerEnd="url(#routeArrow)" />
      <path d={`M ${VIEW_WIDTH - PAD_X - 150} ${upper.y + 8} V ${lower.y - 7} H ${VIEW_WIDTH - PAD_X - 54}`} fill="none" stroke="#ef7866" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="8 8" opacity="0.48" markerEnd="url(#alertArrow)" />
      {layout.doors.map((door) => {
        const point = worldToScreen(door.position);
        const width = (door.width / 28) * FLOOR_WIDTH;
        return (
          <g key={door.id}>
            <rect x={point.x - width / 2} y={point.y - 5} width={width} height="11" fill="#07121c" stroke="#6e8799" strokeWidth="2" />
            <line x1={point.x - width / 2 + 4} y1={point.y} x2={point.x + width / 2 - 4} y2={point.y} stroke="#4ed8cd" strokeWidth="2" opacity="0.75" />
          </g>
        );
      })}
      <g transform={`translate(${worldToScreen([7.95, 0, 2.68]).x - 46} ${lower.y - 17})`}>
        <rect width="92" height="34" rx="17" fill="#092b31" stroke="#45d8cd" strokeWidth="2" />
        <text x="46" y="22" textAnchor="middle" fill="#d7fffa" fontSize="12" fontWeight="800">라운지 입구</text>
      </g>
    </g>
  );
}

function BackgroundDefs() {
  return (
    <defs>
      <linearGradient id="officeBackdrop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#020914" />
        <stop offset="0.5" stopColor="#061321" />
        <stop offset="1" stopColor="#020811" />
      </linearGradient>
      <linearGradient id="photoGrade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#041426" stopOpacity="0.04" />
        <stop offset="0.56" stopColor="#03111f" stopOpacity="0.12" />
        <stop offset="1" stopColor="#010711" stopOpacity="0.3" />
      </linearGradient>
      <linearGradient id="roomFloor" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#334858" />
        <stop offset="0.38" stopColor="#1c3040" />
        <stop offset="1" stopColor="#0b1722" />
      </linearGradient>
      <pattern id="executiveWoodPhoto" width="512" height="512" patternUnits="userSpaceOnUse">
        <image href="/office/materials/dark-wood/diffuse.jpg" width="512" height="512" preserveAspectRatio="xMidYMid slice" />
        <rect width="512" height="512" fill="#24140b" opacity="0.2" />
      </pattern>
      <pattern id="loungeFloorPhoto" width="512" height="512" patternUnits="userSpaceOnUse">
        <image href="/office/materials/parquet/diffuse.jpg" width="512" height="512" preserveAspectRatio="xMidYMid slice" />
        <rect width="512" height="512" fill="#15251e" opacity="0.46" />
      </pattern>
      <linearGradient id="coolRoomLight" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#8adcf2" stopOpacity="0.2" />
        <stop offset="0.42" stopColor="#326078" stopOpacity="0.08" />
        <stop offset="1" stopColor="#02070c" stopOpacity="0.7" />
      </linearGradient>
      <linearGradient id="warmRoomLight" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#ffd5a1" stopOpacity="0.25" />
        <stop offset="0.45" stopColor="#7c5938" stopOpacity="0.07" />
        <stop offset="1" stopColor="#050606" stopOpacity="0.58" />
      </linearGradient>
      <linearGradient id="corridorFloor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#17334a" />
        <stop offset="0.5" stopColor="#21435a" />
        <stop offset="1" stopColor="#132d42" />
      </linearGradient>
      <linearGradient id="metalWall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b2bec7" />
        <stop offset="0.28" stopColor="#526878" />
        <stop offset="0.65" stopColor="#273d4d" />
        <stop offset="1" stopColor="#8ca0ae" />
      </linearGradient>
      <linearGradient id="glassFront" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5b7484" stopOpacity="0.84" />
        <stop offset="0.45" stopColor="#172f40" stopOpacity="0.7" />
        <stop offset="1" stopColor="#0b1b29" stopOpacity="0.95" />
      </linearGradient>
      <linearGradient id="labelGlass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#183149" stopOpacity="0.97" />
        <stop offset="0.58" stopColor="#0b1a29" stopOpacity="0.96" />
        <stop offset="1" stopColor="#05111e" stopOpacity="0.98" />
      </linearGradient>
      <linearGradient id="deskSurface" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#82909b" />
        <stop offset="0.5" stopColor="#4a5a67" />
        <stop offset="1" stopColor="#293742" />
      </linearGradient>
      <linearGradient id="deskWood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#a67b50" />
        <stop offset="0.5" stopColor="#6d4a31" />
        <stop offset="1" stopColor="#3d2b22" />
      </linearGradient>
      <linearGradient id="monitorGlow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#09324a" />
        <stop offset="0.55" stopColor="#0a5d78" />
        <stop offset="1" stopColor="#031726" />
      </linearGradient>
      <linearGradient id="meetingTable" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e3e8ec" />
        <stop offset="0.55" stopColor="#aebbc5" />
        <stop offset="1" stopColor="#71808d" />
      </linearGradient>
      <linearGradient id="approvalDesk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b78a3c" />
        <stop offset="0.6" stopColor="#77531f" />
        <stop offset="1" stopColor="#3d2b15" />
      </linearGradient>
      <pattern id="bookcase" width="34" height="28" patternUnits="userSpaceOnUse">
        <rect width="34" height="28" fill="#4b3527" />
        <rect x="4" y="5" width="5" height="16" fill="#b66b46" />
        <rect x="11" y="3" width="6" height="18" fill="#d0a05d" />
        <rect x="20" y="7" width="7" height="14" fill="#67859a" />
        <path d="M 0 24 H 34" stroke="#9b744d" strokeWidth="3" />
      </pattern>
      <filter id="smallGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="routeGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="screenBloom" x="-60%" y="-80%" width="220%" height="260%">
        <feGaussianBlur stdDeviation="1.8" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="roomDepthShadow" x="-12%" y="-12%" width="130%" height="135%">
        <feDropShadow dx="4" dy="8" stdDeviation="6" floodColor="#00040a" floodOpacity="0.74" />
      </filter>
      <marker id="routeArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#53dfd2" />
      </marker>
      <marker id="alertArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef7866" />
      </marker>
    </defs>
  );
}

type EmployeeAnchorMotion = {
  anchorPosition: Vec3;
  anchorDestinationId: string;
  anchorDestinationType: MovementDestinationType;
  targetPosition: Vec3;
  targetDestinationId: string;
  targetDestinationType: MovementDestinationType;
  tokenPosition: Vec3 | null;
  route: Vec3[];
  routeIndex: number;
  moving: boolean;
  arrivalCount: number;
};

type EmployeeAnchorMotionRecord = Record<string, EmployeeAnchorMotion>;

function copyVec3([x, y, z]: Vec3): Vec3 {
  return [x, y, z];
}

function vec3Distance(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function motionsToRecord(motions: Map<string, EmployeeAnchorMotion>): EmployeeAnchorMotionRecord {
  return Object.fromEntries(
    Array.from(motions.entries(), ([employeeId, motion]) => [
      employeeId,
      {
        ...motion,
        anchorPosition: copyVec3(motion.anchorPosition),
        targetPosition: copyVec3(motion.targetPosition),
        tokenPosition: motion.tokenPosition ? copyVec3(motion.tokenPosition) : null,
        route: motion.route.map(copyVec3),
      },
    ]),
  ) as EmployeeAnchorMotionRecord;
}

function useSeatAnchoredEmployeeMovement(layout: OfficeLayout, employees: OfficeEmployee[]) {
  const plans = useMemo(() => resolveEmployeeMovementPlans(layout, employees).plans, [employees, layout]);
  const motionsRef = useRef(new Map<string, EmployeeAnchorMotion>());
  const [motions, setMotions] = useState<EmployeeAnchorMotionRecord>({});

  useEffect(() => {
    let didChange = false;
    const activeIds = new Set(employees.map((employee) => employee.id));

    for (const id of motionsRef.current.keys()) {
      if (!activeIds.has(id)) {
        motionsRef.current.delete(id);
        didChange = true;
      }
    }

    plans.forEach((plan) => {
      const existing = motionsRef.current.get(plan.employeeId);
      if (!existing) {
        motionsRef.current.set(plan.employeeId, {
          anchorPosition: copyVec3(plan.position),
          anchorDestinationId: plan.destinationId,
          anchorDestinationType: plan.destinationType,
          targetPosition: copyVec3(plan.position),
          targetDestinationId: plan.destinationId,
          targetDestinationType: plan.destinationType,
          tokenPosition: null,
          route: [],
          routeIndex: 0,
          moving: false,
          arrivalCount: 0,
        });
        didChange = true;
        return;
      }

      if (existing.targetDestinationId === plan.destinationId) return;

      const startPosition = existing.tokenPosition ?? existing.anchorPosition;
      const route = buildRuntimeWaypointRoute(startPosition, plan.route, layout.navNodes);
      const finalPosition = route.at(-1) ?? plan.position;

      existing.targetPosition = copyVec3(plan.position);
      existing.targetDestinationId = plan.destinationId;
      existing.targetDestinationType = plan.destinationType;

      if (route.length <= 1 || vec3Distance(startPosition, finalPosition) < 0.08) {
        existing.anchorPosition = copyVec3(plan.position);
        existing.anchorDestinationId = plan.destinationId;
        existing.anchorDestinationType = plan.destinationType;
        existing.tokenPosition = null;
        existing.route = [];
        existing.routeIndex = 0;
        existing.moving = false;
        existing.arrivalCount += 1;
      } else {
        existing.tokenPosition = copyVec3(startPosition);
        existing.route = route.map(copyVec3);
        existing.routeIndex = 0;
        existing.moving = true;
      }
      didChange = true;
    });

    if (didChange) setMotions(motionsToRecord(motionsRef.current));
  }, [employees, layout.navNodes, plans]);

  useEffect(() => {
    let frame = 0;
    let lastTime = performance.now();
    let lastPublishTime = 0;

    const tick = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      let moved = false;
      let arrived = false;

      motionsRef.current.forEach((motion) => {
        if (!motion.moving || !motion.tokenPosition) return;
        const target = motion.route[motion.routeIndex];
        if (!target) {
          motion.anchorPosition = copyVec3(motion.targetPosition);
          motion.anchorDestinationId = motion.targetDestinationId;
          motion.anchorDestinationType = motion.targetDestinationType;
          motion.tokenPosition = null;
          motion.route = [];
          motion.routeIndex = 0;
          motion.moving = false;
          motion.arrivalCount += 1;
          arrived = true;
          return;
        }

        const current = motion.tokenPosition;
        const dx = target[0] - current[0];
        const dz = target[2] - current[2];
        const distance = Math.hypot(dx, dz);

        if (distance < 0.045) {
          motion.tokenPosition = copyVec3(target);
          if (motion.routeIndex < motion.route.length - 1) {
            motion.routeIndex += 1;
            moved = true;
          } else {
            motion.anchorPosition = copyVec3(motion.targetPosition);
            motion.anchorDestinationId = motion.targetDestinationId;
            motion.anchorDestinationType = motion.targetDestinationType;
            motion.tokenPosition = null;
            motion.route = [];
            motion.routeIndex = 0;
            motion.moving = false;
            motion.arrivalCount += 1;
            arrived = true;
          }
          return;
        }

        const step = Math.min(distance, 4.4 * delta);
        motion.tokenPosition = [
          current[0] + (dx / distance) * step,
          0,
          current[2] + (dz / distance) * step,
        ];
        moved = true;
      });

      if (arrived || (moved && time - lastPublishTime >= 40)) {
        setMotions(motionsToRecord(motionsRef.current));
        lastPublishTime = time;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return { motions, plans };
}

export function OfficeHybridScene({
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
  const { motions, plans } = useSeatAnchoredEmployeeMovement(layout, employees);
  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.employeeId, plan])), [plans]);

  const movementRoutes = useMemo(() => employees.flatMap((employee) => {
    const motion = motions[employee.id];
    if (!motion?.moving || !motion.tokenPosition) return [];
    const remainingRoute = [
      motion.tokenPosition,
      ...motion.route.slice(motion.routeIndex),
    ].filter((point, index, route) => {
      if (index === 0) return true;
      return vec3Distance(point, route[index - 1]) > 0.03;
    });
    if (remainingRoute.length < 2) return [];
    return [{
      employeeId: employee.id,
      group: employee.group,
      selected: selectedEmployeeId === employee.id,
      points: remainingRoute.map(worldToScreen),
    }];
  }), [employees, motions, selectedEmployeeId]);

  const movementAccent = (group: OfficeEmployee["group"]) => {
    if (group === "error") return "#ef7866";
    if (group === "waiting") return "#e5ae43";
    if (group === "meeting") return "#9587ff";
    return "#53dfd2";
  };

  return (
    <div className="office-hybrid-scene is-photo" role="application" aria-label="BG Company 2.5D virtual office">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <BackgroundDefs />
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#officeBackdrop)" />
        <image
          className="hybrid-office-photo"
          href="/office/hybrid-office-base-v1.png"
          x="12"
          y="12"
          width={VIEW_WIDTH - 24}
          height={VIEW_HEIGHT - 24}
          preserveAspectRatio="none"
        />
        <rect
          className="hybrid-office-photo-grade"
          x="12"
          y="12"
          width={VIEW_WIDTH - 24}
          height={VIEW_HEIGHT - 24}
          rx="12"
          fill="url(#photoGrade)"
        />
        <rect x="12" y="12" width={VIEW_WIDTH - 24} height={VIEW_HEIGHT - 24} rx="12" fill="none" stroke="#243d52" strokeWidth="2" />
        <CorridorLayer layout={layout} />
        {layout.rooms.map((room) => (
          <RoomShell key={room.id} room={room} seats={layout.seats} />
        ))}
        {movementRoutes.map((route) => (
          <polyline
            key={route.employeeId}
            className={`hybrid-movement-route${route.selected ? " is-selected" : ""}`}
            points={route.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={movementAccent(route.group)}
            strokeWidth={route.selected ? 4 : 2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={route.selected ? "12 9" : "7 10"}
            filter={route.selected ? "url(#routeGlow)" : undefined}
          />
        ))}
      </svg>

      {employees.map((employee) => {
        const plan = planMap.get(employee.id);
        if (!plan) return null;

        const motion = motions[employee.id];
        const moving = Boolean(motion?.moving && motion.tokenPosition);
        const position = moving
          ? motion?.tokenPosition ?? plan.position
          : motion?.anchorPosition ?? plan.position;
        const point = worldToScreen(position);
        const selected = selectedEmployeeId === employee.id;
        const accent = movementAccent(employee.group);
        const tokenStyle: EmployeeVisualStyle = {
          left: `${(point.x / VIEW_WIDTH) * 100}%`,
          top: `${(point.y / VIEW_HEIGHT) * 100}%`,
          "--movement-accent": accent,
        };

        return (
          <button
            key={`movement-token-${employee.id}`}
            type="button"
            className={`hybrid-movement-token${moving ? " is-moving" : " is-stationary"}${selected ? " is-selected" : ""}${motion?.arrivalCount ? " is-arriving" : ""}`}
            data-group={employee.group}
            data-employee-id={employee.id}
            data-moving={moving ? "true" : "false"}
            data-arrival-count={motion?.arrivalCount ?? 0}
            style={tokenStyle}
            onClick={() => onSelectEmployee(employee.id)}
            aria-label={`${employee.name} ${moving ? "목적지로 이동 중" : employee.status}`}
          >
            <span className="hybrid-movement-token-pulse" aria-hidden="true" />
            <span className="hybrid-movement-token-orb">
              <span
                className="office-employee-portrait hybrid-movement-token-avatar"
                data-employee={employee.id}
                aria-hidden="true"
              />
              <span className="hybrid-movement-token-state-dot" aria-hidden="true" />
            </span>
            <span className="hybrid-movement-token-label">
              <strong>{employee.name}</strong>
              <small>{moving ? "목적지로 이동 중" : employee.status}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
