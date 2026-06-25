import type { FurnitureItem } from "../types";

export function Sofa({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.8, , depth = 0.72] = item.size ?? [];
  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[width, 0.32, depth]} />
        <meshStandardMaterial color={item.color ?? "#A8A2CF"} roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.58, -depth / 2 + 0.08]}>
        <boxGeometry args={[width, 0.52, 0.16]} />
        <meshStandardMaterial color={item.color ?? "#A8A2CF"} roughness={0.82} />
      </mesh>
      <mesh castShadow position={[-width / 2 + 0.08, 0.42, 0]}>
        <boxGeometry args={[0.16, 0.4, depth]} />
        <meshStandardMaterial color={item.color ?? "#A8A2CF"} roughness={0.82} />
      </mesh>
      <mesh castShadow position={[width / 2 - 0.08, 0.42, 0]}>
        <boxGeometry args={[0.16, 0.4, depth]} />
        <meshStandardMaterial color={item.color ?? "#A8A2CF"} roughness={0.82} />
      </mesh>
    </group>
  );
}
