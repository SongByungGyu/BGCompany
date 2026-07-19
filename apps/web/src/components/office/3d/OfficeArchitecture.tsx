import type { OfficeLayout } from "./types";

const ROOM_ACCENTS: Record<string, string> = {
  "approval-zone": "#E3B85D",
  "break-lounge": "#83BCA9",
  "ceo-office": "#D0A16A",
  "content-zone": "#58DDCE",
  "dev-ops-zone": "#F27663",
  "director-room": "#53D9D0",
  "finance-room": "#4FD9CF",
  "knowledge-audit-zone": "#9B89E6",
  "market-analysis-room": "#56ADEC",
  "meeting-room": "#62DCCE",
  "review-zone": "#61D8CB",
};

function Beam({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshPhysicalMaterial color="#52677B" clearcoat={0.28} clearcoatRoughness={0.34} metalness={0.62} roughness={0.31} />
    </mesh>
  );
}

export function OfficeArchitecture({ layout }: { layout: OfficeLayout }) {
  const [officeWidth, officeDepth] = layout.office.size;
  return (
    <group>
      {/* Raised architectural plinth gives the office a cutaway-dollhouse silhouette. */}
      <Beam position={[0, -0.26, -officeDepth / 2]} size={[officeWidth + 0.55, 0.45, 0.34]} />
      <Beam position={[0, -0.26, officeDepth / 2]} size={[officeWidth + 0.55, 0.45, 0.34]} />
      <Beam position={[-officeWidth / 2, -0.26, 0]} size={[0.34, 0.45, officeDepth]} />
      <Beam position={[officeWidth / 2, -0.26, 0]} size={[0.34, 0.45, officeDepth]} />

      {layout.rooms.map((room) => {
        const [width, depth] = room.size;
        const [x, , z] = room.position;
        const accent = ROOM_ACCENTS[room.id] ?? "#55DCCC";
        return (
          <group key={room.id}>
            {/* Illuminated room header, visually matching the reference office. */}
            <mesh position={[x, 1.67, z - depth / 2 + 0.11]}>
              <boxGeometry args={[Math.max(0.6, width - 0.48), 0.045, 0.045]} />
              <meshBasicMaterial color={accent} opacity={0.7} transparent toneMapped={false} />
            </mesh>
            <mesh position={[x, 1.62, z - depth / 2 + 0.105]}>
              <boxGeometry args={[Math.max(0.7, width - 0.3), 0.15, 0.08]} />
              <meshStandardMaterial color="#172738" metalness={0.58} roughness={0.34} />
            </mesh>

            {/* Corner uprights make every room read as a physical module. */}
            {[
              [x - width / 2 + 0.08, z - depth / 2 + 0.08],
              [x + width / 2 - 0.08, z - depth / 2 + 0.08],
            ].map(([px, pz], index) => (
              <mesh castShadow key={index} position={[px, 1.02, pz]}>
                <boxGeometry args={[0.13, 2.04, 0.13]} />
                <meshPhysicalMaterial color="#6D8194" clearcoat={0.24} metalness={0.72} roughness={0.28} />
              </mesh>
            ))}

            <pointLight color={accent} distance={Math.max(4.8, width * 0.68)} intensity={0.92} position={[x, 2.55, z]} />
          </group>
        );
      })}

      {/* Corridor lighting remains inside walkable lanes and reinforces routes. */}
      <pointLight color="#5BE5D7" distance={8} intensity={0.72} position={[0, 2.8, -3.4]} />
      <pointLight color="#84BCE8" distance={9} intensity={0.6} position={[0, 2.8, 2.35]} />
    </group>
  );
}
