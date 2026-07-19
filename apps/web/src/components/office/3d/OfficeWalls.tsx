import { Html } from "@react-three/drei";
import type { OfficeLayout, OfficeWall } from "./types";

function wallHeight(wall: OfficeWall, layout: OfficeLayout) {
  return {
    outer: layout.dimensions.outerWallHeight,
    inner: layout.dimensions.innerWallHeight,
    glass: layout.dimensions.glassWallHeight,
    front: layout.dimensions.frontWallHeight,
  }[wall.heightType];
}

function Frame({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshPhysicalMaterial color="#8293A3" clearcoat={0.35} clearcoatRoughness={0.26} metalness={0.74} roughness={0.27} />
    </mesh>
  );
}

export function OfficeWalls({ layout }: { layout: OfficeLayout }) {
  return (
    <group>
      {layout.walls.map((wall) => {
        const height = wallHeight(wall, layout);
        const [width, depth] = wall.size;
        const [x, y, z] = wall.position;
        const isGlass = wall.material === "glass";
        const horizontal = width >= depth;
        const endpoints: Array<[number, number, number]> = horizontal
          ? [[x - width / 2, y + height / 2, z], [x + width / 2, y + height / 2, z]]
          : [[x, y + height / 2, z - depth / 2], [x, y + height / 2, z + depth / 2]];
        return (
          <group key={wall.id}>
            <mesh castShadow={!isGlass} receiveShadow position={[x, y + height / 2, z]}>
              <boxGeometry args={[width, height, depth]} />
              {isGlass ? (
                <meshPhysicalMaterial
                  color="#9BC7D8"
                  depthWrite={false}
                  ior={1.46}
                  metalness={0.04}
                  opacity={0.38}
                  roughness={0.08}
                  thickness={0.16}
                  transmission={0.48}
                  transparent
                />
              ) : (
                <meshPhysicalMaterial
                  clearcoat={0.15}
                  clearcoatRoughness={0.42}
                  color={wall.heightType === "front" ? "#40586B" : "#30485B"}
                  metalness={0.28}
                  roughness={0.42}
                />
              )}
            </mesh>
            <Frame position={[x, y + 0.06, z]} size={[width + 0.06, 0.12, depth + 0.06]} />
            <Frame position={[x, y + height - 0.045, z]} size={[width + 0.085, 0.09, depth + 0.085]} />
            {endpoints.map((position, index) => (
              <Frame key={index} position={position} size={[0.1, height, 0.1]} />
            ))}
            {isGlass && height > 1 ? (
              <Frame
                position={[x, y + height * 0.52, z]}
                size={horizontal ? [width, 0.055, depth + 0.035] : [width + 0.035, 0.055, depth]}
              />
            ) : null}
          </group>
        );
      })}

      {layout.doors.map((door) => {
        const [width, depth] = door.size;
        const [x, y, z] = door.position;
        const isLoungeEntrance = door.id === "passage-lobby-break";
        return (
          <group key={door.id}>
            <mesh position={[x, y + 0.018, z]}>
              <boxGeometry args={[width, 0.036, depth]} />
              <meshStandardMaterial
                color={isLoungeEntrance ? "#58D5C6" : "#67A8D5"}
                emissive={isLoungeEntrance ? "#1A8077" : "#234C75"}
                emissiveIntensity={isLoungeEntrance ? 0.5 : 0.3}
                opacity={0.75}
                roughness={0.48}
                transparent
              />
            </mesh>
            <Frame position={[x - width / 2 + 0.075, 0.68, z]} size={[0.11, 1.36, 0.11]} />
            <Frame position={[x + width / 2 - 0.075, 0.68, z]} size={[0.11, 1.36, 0.11]} />
            <Frame position={[x, 1.33, z]} size={[width, 0.11, 0.11]} />
            {isLoungeEntrance ? (
              <Html center position={[x, 1.56, z]} occlude={false} zIndexRange={[12, 0]}>
                <div className="office-door-label">라운지 입구</div>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
