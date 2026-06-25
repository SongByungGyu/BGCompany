import type { FurnitureItem } from "../types";

export function Partition({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.2, height = 0.34, depth = 0.12] = item.size ?? [];

  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={item.color ?? "#CFE7E3"}
          opacity={0.58}
          roughness={0.82}
          transparent
        />
      </mesh>
      <mesh position={[0, height + 0.02, 0]}>
        <boxGeometry args={[width, 0.035, depth + 0.018]} />
        <meshStandardMaterial color="#FFFFFF" opacity={0.48} transparent roughness={0.7} />
      </mesh>
    </group>
  );
}
