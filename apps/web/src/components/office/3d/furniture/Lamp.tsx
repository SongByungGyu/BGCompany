import type { FurnitureItem } from "../types";

export function Lamp({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;

  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.76, 8]} />
        <meshStandardMaterial color="#8C7564" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.78, 0]}>
        <coneGeometry args={[0.22, 0.28, 12]} />
        <meshStandardMaterial color={item.color ?? "#F8D99B"} roughness={0.7} />
      </mesh>
      <pointLight color="#FFE4A3" intensity={0.12} distance={2.8} position={[0, 0.8, 0]} />
    </group>
  );
}
