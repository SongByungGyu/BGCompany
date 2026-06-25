import type { FurnitureItem } from "../types";

export function StorageCabinet({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.1, height = 0.8, depth = 0.36] = item.size ?? [];
  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={item.color ?? "#B79573"} roughness={0.82} />
      </mesh>
      {[0.68, 0.4].map((row) => (
        <mesh key={row} position={[0, height * row, depth / 2 + 0.006]}>
          <boxGeometry args={[width * 0.82, 0.04, 0.025]} />
          <meshStandardMaterial color="#E8D9C7" roughness={0.86} />
        </mesh>
      ))}
      <mesh position={[0, height * 0.22, depth / 2 + 0.006]}>
        <boxGeometry args={[width * 0.82, 0.035, 0.025]} />
        <meshStandardMaterial color="#8C7564" roughness={0.86} />
      </mesh>
    </group>
  );
}
