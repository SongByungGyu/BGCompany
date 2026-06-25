import type { FurnitureItem } from "../types";

export function Table({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 1.2, , depth = 0.8] = item.size ?? [];
  const isRound = item.type === "roundMeetingTable" || item.type === "loungeTable" || item.type === "barTable";
  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.28, 0]} scale={isRound ? [width / depth, 1, 1] : [1, 1, 1]}>
        {isRound ? <cylinderGeometry args={[depth / 2, depth / 2, 0.16, 32]} /> : <boxGeometry args={[width, 0.16, depth]} />}
        <meshStandardMaterial color={item.color ?? "#D6B48F"} roughness={0.76} />
      </mesh>
      <mesh castShadow position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.24, 10]} />
        <meshStandardMaterial color="#8C7564" roughness={0.84} />
      </mesh>
      {item.type === "roundMeetingTable" ? (
        <mesh castShadow position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.08, 16]} />
          <meshStandardMaterial color="#8ABF87" roughness={0.75} />
        </mesh>
      ) : null}
    </group>
  );
}
