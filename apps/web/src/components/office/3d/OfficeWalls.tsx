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
    return { color: "#DCEBF4", metalness: 0.02, opacity: 0.26, roughness: 0.18 };
  }
  if (wall.heightType === "outer") {
    return { color: "#C9BBA9", metalness: 0, opacity: 0.58, roughness: 0.78 };
  }

  return { color: "#D9CDBD", metalness: 0, opacity: 0.46, roughness: 0.82 };
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
          <mesh
            key={wall.id}
            castShadow={wall.heightType === "outer"}
            receiveShadow
            position={[x, y + height / 2, z]}
          >
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial
              color={material.color}
              depthWrite={wall.heightType === "outer"}
              metalness={material.metalness}
              opacity={material.opacity}
              roughness={material.roughness}
              transparent
            />
          </mesh>
        );
      })}
      {layout.doors.map((door) => {
        const [width, depth] = door.size;
        const [x, y, z] = door.position;
        return (
          <mesh key={door.id} position={[x, y + 0.012, z]}>
            <boxGeometry args={[width, 0.024, depth]} />
            <meshStandardMaterial
              color="#C7E7E4"
              depthWrite={false}
              opacity={0.42}
              roughness={0.78}
              transparent
            />
          </mesh>
        );
      })}
    </group>
  );
}
