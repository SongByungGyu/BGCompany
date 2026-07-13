import type { OfficeLayout } from "./types";

const WOOD_PLANK_COUNT = 18;

export function OfficeFloor({ layout }: { layout: OfficeLayout }) {
  const [width, depth] = layout.office.size;
  return (
    <group>
      <mesh receiveShadow position={[0, -0.12, 0]}>
        <boxGeometry args={[width, 0.24, depth]} />
        <meshStandardMaterial
          color={layout.office.floorColor}
          roughness={0.86}
        />
      </mesh>
      {Array.from({ length: WOOD_PLANK_COUNT }).map((_, index) => {
        const z = -depth / 2 + ((index + 0.5) * depth) / WOOD_PLANK_COUNT;
        return (
          <mesh key={index} receiveShadow position={[0, 0.018, z]}>
            <boxGeometry args={[width - 0.18, 0.012, 0.018]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? "#2C4358" : "#38536A"}
              opacity={0.16}
              roughness={0.94}
              transparent
            />
          </mesh>
        );
      })}
      {layout.walkableAreas
        .filter((area) => area.roomId === "central-corridor")
        .map((area) => (
          <group key={area.id} position={[area.position[0], 0.035, area.position[2]]}>
            <mesh receiveShadow>
              <boxGeometry args={[area.size[0], 0.045, area.size[1]]} />
              <meshStandardMaterial color="#172A3B" metalness={0.2} roughness={0.62} />
            </mesh>
            <mesh position={[0, 0.027, 0]}>
              <boxGeometry args={[Math.max(0.08, area.size[0] - 0.16), 0.012, Math.max(0.08, area.size[1] - 0.16)]} />
              <meshStandardMaterial color="#243F55" metalness={0.18} roughness={0.54} />
            </mesh>
            {area.size[0] > area.size[1] ? (
              <>
                <mesh position={[0, 0.042, -area.size[1] * 0.31]}>
                  <boxGeometry args={[area.size[0] - 0.3, 0.014, 0.025]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.22} transparent />
                </mesh>
                <mesh position={[0, 0.042, area.size[1] * 0.31]}>
                  <boxGeometry args={[area.size[0] - 0.3, 0.014, 0.025]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.22} transparent />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[-area.size[0] * 0.31, 0.042, 0]}>
                  <boxGeometry args={[0.025, 0.014, area.size[1] - 0.3]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.22} transparent />
                </mesh>
                <mesh position={[area.size[0] * 0.31, 0.042, 0]}>
                  <boxGeometry args={[0.025, 0.014, area.size[1] - 0.3]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.22} transparent />
                </mesh>
              </>
            )}
          </group>
        ))}
      {layout.debug.showGrid && (
        <gridHelper
          args={[24, 24, "#BFAF9B", "#D8C8B3"]}
          position={[0, 0.012, 0]}
        />
      )}
    </group>
  );
}
