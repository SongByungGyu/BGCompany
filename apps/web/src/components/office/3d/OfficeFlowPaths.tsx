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
    points: [[6.7, 0.13, -3.45], [6.7, 0.13, -2.95], [1.0, 0.13, -2.95], [1.0, 0.13, -1.4], [0.25, 0.13, -1.4]],
  },
  {
    id: "qa-to-meeting",
    color: "#4FE0D1",
    points: [[-7.2, 0.13, -0.65], [-7.2, 0.13, 2.15], [-5.25, 0.13, 2.15], [-5.25, 0.13, 0.75]],
  },
  {
    id: "meeting-to-approval",
    color: "#E1B35A",
    points: [[-2.6, 0.13, 2.0], [-2.6, 0.13, 3.05], [-3.85, 0.13, 3.05], [-3.85, 0.13, 4.15]],
  },
  {
    id: "publishing-to-approval",
    color: "#4FE0D1",
    points: [[-7.35, 0.13, 5.25], [-6.8, 0.13, 5.25], [-6.8, 0.13, 3.4], [-5.1, 0.13, 3.4]],
  },
  {
    id: "dev-alert",
    color: "#F47B6A",
    points: [[9.6, 0.14, -3.45], [9.6, 0.14, -2.85], [11.4, 0.14, -2.85], [11.4, 0.14, -1.65]],
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
              lineWidth={1.4}
              dashed
              dashSize={0.22}
              gapSize={0.12}
              transparent
              opacity={0.72}
            />
            <mesh position={endpoint} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.12, 0.28, 4]} />
              <meshStandardMaterial color={path.color} emissive={path.color} emissiveIntensity={0.45} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
