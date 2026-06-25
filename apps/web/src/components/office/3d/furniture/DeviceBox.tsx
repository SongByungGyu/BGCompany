import type { FurnitureItem } from "../types";

export function DeviceBox({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 0.7, height = 0.62, depth = 0.48] = item.size ?? [];
  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={item.color ?? "#718096"} roughness={0.72} />
      </mesh>
      <mesh position={[0, height * 0.72, depth / 2 + 0.01]}>
        <boxGeometry args={[width * 0.68, 0.08, 0.025]} />
        <meshStandardMaterial color="#C7E7E4" roughness={0.55} />
      </mesh>
      <mesh position={[0, height * 0.5, depth / 2 + 0.01]}>
        <boxGeometry args={[width * 0.68, 0.06, 0.025]} />
        <meshStandardMaterial color="#F4D35E" roughness={0.55} />
      </mesh>
      <mesh position={[width * 0.28, height * 0.27, depth / 2 + 0.012]}>
        <boxGeometry args={[0.06, 0.06, 0.025]} />
        <meshStandardMaterial color="#34D399" roughness={0.5} />
      </mesh>
    </group>
  );
}
