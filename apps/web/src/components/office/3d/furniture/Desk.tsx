import { Html } from "@react-three/drei";
import { Chair } from "./Chair";
import { Monitor } from "./Monitor";
import type { FurnitureDesk } from "../types";

function isMultiMonitorDesk(desk: FurnitureDesk) {
  return (
    desk.id.includes("dev") ||
    desk.id.includes("ops") ||
    desk.id.includes("stock") ||
    desk.id.includes("finance") ||
    desk.id.includes("director")
  );
}

export function Desk({ desk, debug }: { desk: FurnitureDesk; debug: boolean }) {
  const [x, y, z] = desk.position;
  const isReserved = desk.isReserved;
  const isDirectorDesk = desk.id.includes("director");
  const width = isDirectorDesk ? 2.35 : desk.capacity > 1 ? 1.9 : 1.36;
  const depth = isDirectorDesk ? 1.12 : 0.8;
  const hasMultiMonitor = isMultiMonitorDesk(desk);

  return (
    <group position={[x, y, z]} rotation={[0, desk.rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.29, 0]}>
        <boxGeometry args={[width, 0.17, depth]} />
        <meshStandardMaterial
          color={isReserved ? "#D9E4EF" : isDirectorDesk ? "#A8754F" : "#C8A783"}
          opacity={isReserved ? 0.62 : 1}
          roughness={0.7}
          transparent={isReserved}
        />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.44, -depth / 2 + 0.07]}>
        <boxGeometry args={[width * 0.92, 0.28, 0.08]} />
        <meshStandardMaterial color={isReserved ? "#B8C5D3" : isDirectorDesk ? "#7B5A42" : "#B7A289"} roughness={0.82} />
      </mesh>
      {[
        [-width / 2 + 0.13, -depth / 2 + 0.12],
        [width / 2 - 0.13, -depth / 2 + 0.12],
        [-width / 2 + 0.13, depth / 2 - 0.12],
        [width / 2 - 0.13, depth / 2 - 0.12],
      ].map(([legX, legZ]) => (
        <mesh key={`${legX}-${legZ}`} castShadow position={[legX, 0.13, legZ]}>
          <boxGeometry args={[0.08, 0.24, 0.08]} />
          <meshStandardMaterial color="#8C7564" roughness={0.84} />
        </mesh>
      ))}
      <Monitor position={[hasMultiMonitor ? -0.24 : 0, 0.55, -0.14]} color={isReserved ? "#A9B9C8" : "#334155"} />
      {hasMultiMonitor ? (
        <Monitor position={[0.34, 0.55, -0.13]} rotation={0.18} color={isReserved ? "#A9B9C8" : "#1F2937"} />
      ) : null}
      <mesh castShadow position={[-width / 2 + 0.26, 0.42, 0.13]}>
        <boxGeometry args={[0.25, 0.045, 0.34]} />
        <meshStandardMaterial color="#F7E7C8" roughness={0.86} />
      </mesh>
      <mesh castShadow position={[width / 2 - 0.26, 0.43, 0.12]}>
        <boxGeometry args={[0.18, 0.055, 0.22]} />
        <meshStandardMaterial color="#A8C1A0" roughness={0.78} />
      </mesh>
      {isDirectorDesk ? (
        <>
          <mesh castShadow position={[0, 0.405, 0.36]}>
            <boxGeometry args={[width * 0.68, 0.08, 0.12]} />
            <meshStandardMaterial color="#E8D4B8" roughness={0.72} />
          </mesh>
          <mesh castShadow position={[width / 2 - 0.16, 0.38, -0.04]}>
            <boxGeometry args={[0.12, 0.24, depth * 0.58]} />
            <meshStandardMaterial color="#7B5A42" roughness={0.82} />
          </mesh>
        </>
      ) : null}
      <Chair
        position={[0, 0, 0.78]}
        color={isReserved ? "#CBD5E1" : desk.id.includes("director") ? "#9BA7C4" : "#8AA4C8"}
      />
      {debug && isReserved ? (
        <Html center position={[0, 0.92, 0]}>
          <div className="office-furniture-debug-label">reserved</div>
        </Html>
      ) : null}
    </group>
  );
}
