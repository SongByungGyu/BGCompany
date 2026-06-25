import type { FurnitureItem } from "../types";

export function PropBox({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 0.42, height = 0.3, depth = 0.42] = item.size ?? [];
  return (
    <mesh castShadow receiveShadow position={[x, y + height / 2, z]} rotation={[0, item.rotation, 0]}>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={item.color ?? "#D6B48F"} roughness={0.84} />
    </mesh>
  );
}
