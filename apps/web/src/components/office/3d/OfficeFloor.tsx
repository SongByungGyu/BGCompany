import type { OfficeLayout } from "./types";

const WOOD_PLANK_COUNT = 18;

export function OfficeFloor({ layout }: { layout: OfficeLayout }) {
  const [width, depth] = layout.office.size;
  return (
    <group>
      <mesh receiveShadow position={[0, -0.12, 0]}>
        <boxGeometry args={[width, 0.24, depth]} />
        <meshPhysicalMaterial
          clearcoat={0.12}
          clearcoatRoughness={0.5}
          color={layout.office.floorColor}
          metalness={0.18}
          roughness={0.64}
        />
      </mesh>
      {Array.from({ length: WOOD_PLANK_COUNT }).map((_, index) => {
        const z = -depth / 2 + ((index + 0.5) * depth) / WOOD_PLANK_COUNT;
        return (
          <mesh key={index} receiveShadow position={[0, 0.018, z]}>
            <boxGeometry args={[width - 0.18, 0.012, 0.018]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? "#2C4358" : "#4C6A80"}
              opacity={0.13}
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
              <meshPhysicalMaterial clearcoat={0.28} clearcoatRoughness={0.32} color="#152B3D" metalness={0.38} roughness={0.42} />
            </mesh>
            <mesh position={[0, 0.027, 0]}>
              <boxGeometry args={[Math.max(0.08, area.size[0] - 0.16), 0.012, Math.max(0.08, area.size[1] - 0.16)]} />
              <meshPhysicalMaterial clearcoat={0.24} color="#27465B" metalness={0.32} roughness={0.4} />
            </mesh>
            {area.size[0] > area.size[1] ? (
              <>
                <mesh position={[0, 0.042, -area.size[1] * 0.31]}>
                  <boxGeometry args={[area.size[0] - 0.3, 0.014, 0.025]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.42} transparent toneMapped={false} />
                </mesh>
                <mesh position={[0, 0.042, area.size[1] * 0.31]}>
                  <boxGeometry args={[area.size[0] - 0.3, 0.014, 0.025]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.42} transparent toneMapped={false} />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[-area.size[0] * 0.31, 0.042, 0]}>
                  <boxGeometry args={[0.025, 0.014, area.size[1] - 0.3]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.42} transparent toneMapped={false} />
                </mesh>
                <mesh position={[area.size[0] * 0.31, 0.042, 0]}>
                  <boxGeometry args={[0.025, 0.014, area.size[1] - 0.3]} />
                  <meshBasicMaterial color="#4FE0D1" opacity={0.42} transparent toneMapped={false} />
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
