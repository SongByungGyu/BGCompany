import type { OfficeLayout } from "./types";

const WOOD_PLANK_COUNT = 26;

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
              color={index % 2 === 0 ? "#D8B98F" : "#E4C7A0"}
              opacity={0.42}
              roughness={0.94}
              transparent
            />
          </mesh>
        );
      })}
      {layout.debug.showGrid && (
        <gridHelper
          args={[24, 24, "#BFAF9B", "#D8C8B3"]}
          position={[0, 0.012, 0]}
        />
      )}
    </group>
  );
}
