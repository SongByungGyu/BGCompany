import { Line } from "@react-three/drei";
import type { Vec3 } from "./types";

type FlowPath = {
  id: string;
  color: string;
  points: Vec3[];
};

const flowPaths: FlowPath[] = [
  {
    id: "content-to-meeting",
    color: "#4FE0D1",
    points: [[6.2, 0.13, -3.4], [0, 0.13, -3.4], [0, 0.13, 2.35], [-4.4, 0.13, 2.35], [-4.4, 0.13, 1.35]],
  },
  {
    id: "qa-to-meeting",
    color: "#4FE0D1",
    points: [[-11.0, 0.13, 1.35], [-11.0, 0.13, 2.35], [-4.4, 0.13, 2.35], [-4.4, 0.13, 1.35]],
  },
  {
    id: "meeting-to-approval",
    color: "#E1B35A",
    points: [[-4.4, 0.13, 1.35], [-4.4, 0.13, 2.35], [-4.2, 0.13, 2.35], [-4.2, 0.13, 3.35]],
  },
  {
    id: "publishing-to-approval",
    color: "#4FE0D1",
    points: [[-10.8, 0.13, 3.35], [-10.8, 0.13, 2.35], [-4.2, 0.13, 2.35], [-4.2, 0.13, 3.35]],
  },
  {
    id: "dev-alert",
    color: "#F47B6A",
    points: [[6.2, 0.14, -3.4], [0, 0.14, -3.4], [0, 0.14, 2.35], [8.2, 0.14, 2.35], [8.2, 0.14, 1.35]],
  },
];

export function OfficeFlowPaths() {
  return (
    <group>
      {flowPaths.map((path) => {
        const endpoint = path.points[path.points.length - 1];
        return (
          <group key={path.id}>
            <Line
              points={path.points}
              color={path.color}
              lineWidth={1.05}
              dashed
              dashSize={0.18}
              gapSize={0.14}
              transparent
              opacity={0.48}
            />
            <mesh position={endpoint} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.12, 0.28, 4]} />
              <meshStandardMaterial color={path.color} emissive={path.color} emissiveIntensity={0.28} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
