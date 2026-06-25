import { Html } from "@react-three/drei";
import type { FurnitureItem } from "../types";

export function DigitalSign({ item }: { item: FurnitureItem }) {
  const [width = 1.6, height = 0.78, depth = 0.12] = item.size ?? [1.6, 0.78, 0.12];
  const label = item.id.includes("bg-company") ? "BG COMPANY" : "INFO";

  return (
    <group position={item.position} rotation={[0, item.rotation, 0]}>
      <mesh position={[0, height / 2 + 0.1, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={item.color ?? "#172033"} roughness={0.34} metalness={0.08} />
      </mesh>
      <mesh position={[0, height + 0.18, -depth * 0.52]}>
        <boxGeometry args={[width * 0.72, 0.08, 0.08]} />
        <meshStandardMaterial color="#7DD3FC" emissive="#0EA5E9" emissiveIntensity={0.45} />
      </mesh>
      <Html center position={[0, height / 2 + 0.11, -depth * 0.62]} className="office-digital-sign">
        {label}
      </Html>
    </group>
  );
}
