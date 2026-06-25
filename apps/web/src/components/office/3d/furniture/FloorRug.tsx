import type { FurnitureItem } from "../types";

export function FloorRug({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.4, height = 0.026, depth = 0.9] = item.size ?? [];

  return (
    <group position={[x, y + 0.05, z]} rotation={[0, item.rotation, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={item.color ?? "#EBDAC4"} opacity={0.72} roughness={0.9} transparent />
      </mesh>
    </group>
  );
}
