import type { Vec3 } from "../types";

export function Chair({
  position,
  rotation = 0,
  color = "#8AA4C8",
}: {
  position: Vec3;
  rotation?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.18, 0]}>
        <boxGeometry args={[0.48, 0.16, 0.46]} />
        <meshStandardMaterial color={color} roughness={0.74} />
      </mesh>
      <mesh castShadow position={[0, 0.48, 0.2]}>
        <boxGeometry args={[0.5, 0.5, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.78} />
      </mesh>
      <mesh castShadow position={[0, 0.08, 0.02]}>
        <cylinderGeometry args={[0.08, 0.08, 0.14, 8]} />
        <meshStandardMaterial color="#6B7280" roughness={0.84} />
      </mesh>
    </group>
  );
}
