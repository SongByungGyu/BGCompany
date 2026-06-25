import type { Vec3 } from "../types";

export function Monitor({
  position,
  rotation = 0,
  color = "#334155",
}: {
  position: Vec3;
  rotation?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[0.48, 0.32, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.02, 0.033]}>
        <boxGeometry args={[0.34, 0.2, 0.012]} />
        <meshStandardMaterial color="#BFE3F4" opacity={0.72} roughness={0.5} transparent />
      </mesh>
    </group>
  );
}
