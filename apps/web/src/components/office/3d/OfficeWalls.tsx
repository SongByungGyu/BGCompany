import { Html } from "@react-three/drei";
import type { OfficeLayout, OfficeWall } from "./types";

function wallHeight(wall: OfficeWall, layout: OfficeLayout) {
  const dimensions = layout.dimensions;
  return {
    outer: dimensions.outerWallHeight,
    inner: dimensions.innerWallHeight,
    glass: dimensions.glassWallHeight,
    front: dimensions.frontWallHeight,
  }[wall.heightType];
}

function wallMaterial(wall: OfficeWall) {
  if (wall.material === "glass") {
    return { color: "#86AFCB", metalness: 0.08, opacity: 0.2, roughness: 0.14 };
  }
  if (wall.heightType === "outer") {
    return { color: "#667789", metalness: 0.22, opacity: 0.96, roughness: 0.5 };
  }

  return { color: "#63788B", metalness: 0.16, opacity: 0.88, roughness: 0.54 };
}

export function OfficeWalls({ layout }: { layout: OfficeLayout }) {
  return (
    <group>
      {layout.walls.map((wall) => {
        const height = wallHeight(wall, layout);
        const [width, depth] = wall.size;
        const [x, y, z] = wall.position;
        const material = wallMaterial(wall);
        return (
          <group key={wall.id}>
            <mesh
              castShadow={wall.heightType !== "glass"}
              receiveShadow
              position={[x, y + height / 2, z]}
            >
              <boxGeometry args={[width, height, depth]} />
              <meshStandardMaterial
                color={material.color}
                depthWrite={wall.heightType !== "glass"}
                metalness={material.metalness}
                opacity={material.opacity}
                roughness={material.roughness}
                transparent={material.opacity < 1}
              />
            </mesh>
            <mesh castShadow position={[x, y + 0.055, z]}>
              <boxGeometry args={[width + 0.05, 0.11, depth + 0.05]} />
              <meshStandardMaterial color="#33485C" metalness={0.38} roughness={0.42} />
            </mesh>
            <mesh castShadow position={[x, y + height - 0.045, z]}>
              <boxGeometry args={[width + 0.07, 0.09, depth + 0.07]} />
              <meshStandardMaterial color="#AAB7C3" metalness={0.42} roughness={0.34} />
            </mesh>
          </group>
        );
      })}
      {layout.doors.map((door) => {
        const [width, depth] = door.size;
        const [x, y, z] = door.position;
        const isLoungeEntrance = door.id === "passage-lobby-break";
        return (
          <group key={door.id}>
            <mesh position={[x, y + 0.016, z]}>
              <boxGeometry args={[width, 0.032, depth]} />
              <meshStandardMaterial
                color={isLoungeEntrance ? "#58D5C6" : "#77A8D7"}
                depthWrite={false}
                emissive={isLoungeEntrance ? "#1A8077" : "#234C75"}
                emissiveIntensity={isLoungeEntrance ? 0.34 : 0.16}
                opacity={isLoungeEntrance ? 0.78 : 0.42}
                roughness={0.62}
                transparent
              />
            </mesh>
            {isLoungeEntrance ? (
              <>
                <mesh position={[x - width / 2 + 0.08, 0.65, z]}>
                  <boxGeometry args={[0.12, 1.3, 0.12]} />
                  <meshStandardMaterial color="#5AD6C7" emissive="#1C6F69" emissiveIntensity={0.34} />
                </mesh>
                <mesh position={[x + width / 2 - 0.08, 0.65, z]}>
                  <boxGeometry args={[0.12, 1.3, 0.12]} />
                  <meshStandardMaterial color="#5AD6C7" emissive="#1C6F69" emissiveIntensity={0.34} />
                </mesh>
                <Html center position={[x, 1.48, z]} occlude={false} zIndexRange={[12, 0]}>
                  <div className="office-door-label">라운지 입구</div>
                </Html>
              </>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
