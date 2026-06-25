import type { FurnitureItem } from "../types";

export function Board({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.5, height = 0.08, depth = 0.12] = item.size ?? [];

  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[width, 0.92, depth]} />
        <meshStandardMaterial color={item.color ?? "#F8FAFC"} roughness={0.62} />
      </mesh>
      <mesh castShadow position={[0, 1.22, 0]}>
        <boxGeometry args={[width + 0.16, 0.08, depth + 0.04]} />
        <meshStandardMaterial color="#94A3B8" roughness={0.78} />
      </mesh>
      <mesh castShadow position={[0, 0.2, 0]}>
        <boxGeometry args={[width + 0.16, height, depth + 0.04]} />
        <meshStandardMaterial color="#94A3B8" roughness={0.78} />
      </mesh>
      <mesh position={[-width * 0.22, 0.9, depth / 2 + 0.012]}>
        <boxGeometry args={[width * 0.36, 0.045, 0.018]} />
        <meshStandardMaterial color="#79D5CD" roughness={0.6} />
      </mesh>
    </group>
  );
}
