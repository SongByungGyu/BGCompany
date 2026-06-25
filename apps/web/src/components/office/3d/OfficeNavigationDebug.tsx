import { Html, Line } from "@react-three/drei";
import type { OfficeLayout, Vec3 } from "./types";

const DEBUG_HEIGHT = 0.16;

function elevated([x, , z]: Vec3): Vec3 {
  return [x, DEBUG_HEIGHT, z];
}

export function OfficeNavigationDebug({
  layout,
}: {
  layout: OfficeLayout;
}) {
  if (
    process.env.NODE_ENV !== "development" ||
    !layout.debug.showNavigationDebug
  ) return null;

  const positions = new Map<string, Vec3>([
    ...layout.navNodes.map((node) => [node.id, node.position] as const),
    ...layout.destinations.map(
      (destination) => [destination.id, destination.position] as const,
    ),
    ...layout.seats.map((seat) => [seat.id, seat.position] as const),
    ...layout.workPoints.map((point) => [point.id, point.position] as const),
    ...layout.standPoints.map((point) => [point.id, point.position] as const),
  ]);
  const renderedEdges = new Set<string>();
  const edges = layout.navNodes.flatMap((node) =>
    node.connectsTo.flatMap((targetId) => {
      const target = positions.get(targetId);
      if (!target) return [];
      const edgeId = [node.id, targetId].sort().join("--");
      if (renderedEdges.has(edgeId)) return [];
      renderedEdges.add(edgeId);
      return [{ id: edgeId, points: [elevated(node.position), elevated(target)] }];
    }),
  );

  return (
    <group>
      {layout.walkableAreas.map((area) => {
        const [width, depth] = area.size;
        return (
          <mesh
            key={area.id}
            position={area.position}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
          >
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial
              color="#63D6C2"
              depthWrite={false}
              opacity={0.1}
              transparent
            />
          </mesh>
        );
      })}

      {edges.map((edge) => (
        <Line
          key={edge.id}
          points={edge.points}
          color="#4B9FD8"
          dashed
          dashSize={0.22}
          gapSize={0.16}
          lineWidth={1}
          opacity={0.34}
          transparent
        />
      ))}

      {layout.doors.map((door) => {
        const [width, depth] = door.size;
        const [x, , z] = door.position;
        return (
          <mesh key={door.id} position={[x, 0.18, z]}>
            <boxGeometry args={[width, 0.035, depth]} />
            <meshBasicMaterial
              color="#79D5CD"
              depthWrite={false}
              opacity={0.3}
              transparent
            />
          </mesh>
        );
      })}

      {layout.navNodes.map((node) => (
        <group key={node.id}>
          <mesh position={elevated(node.position)}>
            <sphereGeometry args={[0.11, 12, 12]} />
            <meshBasicMaterial color="#2479B8" depthWrite={false} />
          </mesh>
          <Html
            center
            position={[node.position[0], DEBUG_HEIGHT + 0.22, node.position[2]]}
            occlude={false}
            zIndexRange={[7, 0]}
          >
            <span className="office-debug-label nav-node">{node.id}</span>
          </Html>
        </group>
      ))}

      {[...layout.seats, ...layout.workPoints, ...layout.standPoints, ...layout.destinations].map((destination) => (
        <group key={destination.id}>
          <mesh
            position={elevated(destination.position)}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[0.16, 0.055, 8, 16]} />
            <meshBasicMaterial color={destination.type === "seat" || destination.type === "meetingSeat" ? "#3FB6A6" : destination.type === "workPoint" ? "#8B6EDC" : "#F09A3E"} depthWrite={false} />
          </mesh>
          <Html
            center
            position={[destination.position[0], DEBUG_HEIGHT + 0.16, destination.position[2]]}
            occlude={false}
            zIndexRange={[6, 0]}
          >
            <span className="office-debug-label destination">{destination.id}</span>
          </Html>
        </group>
      ))}

      {layout.debug.showPlacementDebug ? layout.blockedAreas.map((area) => {
        const [width, depth] = area.size;
        return (
          <mesh
            key={area.id}
            position={area.position}
            rotation={[-Math.PI / 2, 0, area.rotation ?? 0]}
            renderOrder={3}
          >
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial color="#EF4444" depthWrite={false} opacity={0.12} transparent />
          </mesh>
        );
      }) : null}
    </group>
  );
}
