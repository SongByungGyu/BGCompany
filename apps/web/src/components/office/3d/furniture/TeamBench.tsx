import { Chair } from "./Chair";
import { Monitor } from "./Monitor";
import type { FurnitureItem } from "../types";

export function TeamBench({ item }: { item: FurnitureItem }) {
  const [x, y, z] = item.position;
  const [width = 2.3, , depth = 1.05] = item.size ?? [];
  const monitorCount = width > 2.6 ? 4 : 3;
  const monitorStep = width / (monitorCount + 1);

  return (
    <group position={[x, y, z]} rotation={[0, item.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.29, 0]}>
        <boxGeometry args={[width, 0.16, depth]} />
        <meshStandardMaterial color={item.color ?? "#C8A783"} roughness={0.72} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.43, 0]}>
        <boxGeometry args={[width * 0.94, 0.26, 0.08]} />
        <meshStandardMaterial color="#B9A68B" roughness={0.82} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.45, -depth * 0.34]}>
        <boxGeometry args={[width * 0.94, 0.24, 0.08]} />
        <meshStandardMaterial color="#C6D8EA" opacity={0.72} roughness={0.82} transparent />
      </mesh>
      {Array.from({ length: monitorCount }).map((_, index) => {
        const mx = -width / 2 + monitorStep * (index + 1);
        return (
          <Monitor
            key={index}
            position={[mx, 0.57, -0.18 + (index % 2) * 0.14]}
            rotation={(index % 2 === 0 ? -0.12 : 0.12)}
            color={index % 2 === 0 ? "#1F2937" : "#334155"}
          />
        );
      })}
      {[-width * 0.28, width * 0.28].map((chairX, index) => (
        <Chair
          key={index}
          position={[chairX, 0, depth / 2 + 0.34]}
          color={index % 2 === 0 ? "#8AA4C8" : "#9BA7C4"}
        />
      ))}
      <mesh castShadow position={[-width / 2 + 0.28, 0.42, 0.18]}>
        <boxGeometry args={[0.26, 0.05, 0.36]} />
        <meshStandardMaterial color="#F7E7C8" roughness={0.86} />
      </mesh>
      <mesh castShadow position={[width / 2 - 0.28, 0.42, 0.2]}>
        <boxGeometry args={[0.22, 0.06, 0.25]} />
        <meshStandardMaterial color="#A8C1A0" roughness={0.78} />
      </mesh>
    </group>
  );
}
