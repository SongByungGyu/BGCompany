import type { OfficeLayout } from "./types";

export function OfficeRooms({ layout }: { layout: OfficeLayout }) {
  return (
    <group>
      {layout.rooms.map((room) => {
        const [width, depth] = room.size;
        const [x, y, z] = room.position;
        return (
          <mesh
            key={room.id}
            receiveShadow
            position={[x, y + 0.028, z]}
          >
            <boxGeometry args={[width - 0.04, 0.056, depth - 0.04]} />
            <meshStandardMaterial
              color={room.color}
              depthWrite={false}
              opacity={room.parentId ? 0.58 : 0.68}
              roughness={0.88}
              transparent
            />
          </mesh>
        );
      })}
    </group>
  );
}
