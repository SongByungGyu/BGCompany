import type { FurnitureItem } from "../types";

export function Plant({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.18, 0.24, 0.32, 8]} />
        <meshStandardMaterial color="#C08457" roughness={0.84} />
      </mesh>
      <mesh castShadow position={[0, 0.46, 0]}>
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshStandardMaterial color="#6BAA75" roughness={0.76} />
      </mesh>
      <mesh castShadow position={[0.17, 0.55, -0.08]}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial color="#7FBD83" roughness={0.76} />
      </mesh>
    </group>
  );
}
