import type { ReactNode } from "react";

type Vec3 = [number, number, number];

const COLORS = {
  accent: "#4FE0D1",
  blue: "#2D80B9",
  darkMetal: "#202C38",
  desk: "#485766",
  gold: "#D1A64A",
  lightMetal: "#AAB7C3",
  screen: "#071A2C",
  wood: "#684B38",
};

function Box({
  children,
  color,
  emissive,
  emissiveIntensity = 0,
  metalness = 0.08,
  opacity = 1,
  position,
  roughness = 0.58,
  size,
}: {
  children?: ReactNode;
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  opacity?: number;
  position: Vec3;
  roughness?: number;
  size: Vec3;
}) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        metalness={metalness}
        opacity={opacity}
        roughness={roughness}
        transparent={opacity < 1}
      />
      {children}
    </mesh>
  );
}

function Monitor({
  accent = COLORS.accent,
  position,
  rotation = 0,
  scale = 1,
}: {
  accent?: string;
  position: Vec3;
  rotation?: number;
  scale?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Box color="#1B2734" metalness={0.3} position={[0, 0, 0]} roughness={0.34} size={[0.64, 0.4, 0.07]} />
      <Box color={COLORS.screen} emissive="#123D5C" emissiveIntensity={0.55} position={[0, 0.015, 0.041]} roughness={0.24} size={[0.54, 0.31, 0.012]} />
      <Box color={accent} emissive={accent} emissiveIntensity={0.65} position={[-0.12, 0.04, 0.05]} size={[0.22, 0.025, 0.01]} />
      <Box color="#6B7C8D" metalness={0.4} position={[0, -0.28, 0]} size={[0.055, 0.18, 0.055]} />
      <Box color="#6B7C8D" metalness={0.4} position={[0, -0.37, 0.01]} size={[0.28, 0.035, 0.2]} />
    </group>
  );
}

function OfficeChair({ color = "#46596C", position, rotation = 0 }: { color?: string; position: Vec3; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box color={color} position={[0, 0.26, 0]} size={[0.48, 0.16, 0.46]} />
      <Box color={color} position={[0, 0.58, 0.18]} size={[0.5, 0.52, 0.1]} />
      <Box color="#303C48" metalness={0.32} position={[0, 0.1, 0]} size={[0.08, 0.2, 0.08]} />
      {[[-0.24, -0.22], [0.24, -0.22], [-0.24, 0.22], [0.24, 0.22]].map(([x, z], index) => (
        <mesh key={index} position={[x, 0.03, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.05, 10]} />
          <meshStandardMaterial color="#1C2732" metalness={0.35} roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function Workstation({
  accent = COLORS.accent,
  executive = false,
  monitors = 2,
  position,
  rotation = 0,
  width = 1.7,
}: {
  accent?: string;
  executive?: boolean;
  monitors?: number;
  position: Vec3;
  rotation?: number;
  width?: number;
}) {
  const monitorOffsets = monitors === 3 ? [-0.58, 0, 0.58] : monitors === 2 ? [-0.34, 0.34] : [0];
  const depth = executive ? 1.05 : 0.86;
  const surfaceColor = executive ? COLORS.wood : COLORS.desk;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box color={surfaceColor} metalness={executive ? 0.04 : 0.18} position={[0, 0.43, 0]} roughness={0.52} size={[width, 0.16, depth]} />
      <Box color={executive ? "#493329" : COLORS.darkMetal} position={[0, 0.24, -depth / 2 + 0.08]} size={[width * 0.92, 0.38, 0.1]} />
      {[-1, 1].map((side) => (
        <Box key={side} color="#34424F" metalness={0.28} position={[side * (width / 2 - 0.1), 0.2, 0]} size={[0.09, 0.4, depth * 0.82]} />
      ))}
      {monitorOffsets.map((offset, index) => (
        <Monitor key={offset} accent={accent} position={[offset, 0.92, -0.15]} rotation={(index - (monitorOffsets.length - 1) / 2) * -0.12} scale={monitors === 3 ? 0.88 : 1} />
      ))}
      <Box color="#C8D2DC" position={[0, 0.54, 0.17]} size={[0.54, 0.035, 0.18]} />
      <Box color={accent} emissive={accent} emissiveIntensity={0.5} position={[width / 2 - 0.18, 0.53, 0.2]} size={[0.14, 0.025, 0.14]} />
      <OfficeChair color={executive ? "#4A5360" : "#40566B"} position={[0, 0, depth / 2 + 0.48]} />
    </group>
  );
}

function WallDashboard({ accent = COLORS.accent, position, rotation = 0, width = 2.6 }: { accent?: string; position: Vec3; rotation?: number; width?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box color="#172431" metalness={0.3} position={[0, 0, 0]} size={[width, 1.0, 0.09]} />
      <Box color={COLORS.screen} emissive="#123651" emissiveIntensity={0.46} position={[0, 0, 0.052]} size={[width - 0.16, 0.82, 0.012]} />
      {[-0.3, -0.1, 0.1, 0.3].map((offset, index) => (
        <Box key={offset} color={index % 2 ? accent : COLORS.blue} emissive={accent} emissiveIntensity={0.4} position={[offset * width, -0.2 + index * 0.11, 0.062]} size={[0.055, 0.22 + index * 0.08, 0.01]} />
      ))}
      <Box color={accent} emissive={accent} emissiveIntensity={0.6} position={[0, 0.28, 0.063]} size={[width * 0.62, 0.025, 0.01]} />
    </group>
  );
}

function Cabinet({ color = "#50606E", position, width = 1.7 }: { color?: string; position: Vec3; width?: number }) {
  return (
    <group position={position}>
      <Box color={color} position={[0, 0.48, 0]} size={[width, 0.96, 0.46]} />
      {[-0.25, 0, 0.25].map((offset) => (
        <Box key={offset} color="#23313E" position={[offset * width * 1.1, 0.5, 0.235]} size={[0.03, 0.82, 0.018]} />
      ))}
      <Box color="#C8A76B" position={[-0.04, 0.5, 0.25]} size={[0.04, 0.09, 0.025]} />
      <Box color="#C8A76B" position={[0.04, 0.5, 0.25]} size={[0.04, 0.09, 0.025]} />
    </group>
  );
}

function ServerRack({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Box color="#111820" metalness={0.48} position={[0, 0.78, 0]} roughness={0.32} size={[0.68, 1.56, 0.68]} />
      {Array.from({ length: 8 }).map((_, index) => (
        <group key={index}>
          <Box color="#293744" position={[0, 0.2 + index * 0.16, 0.35]} size={[0.54, 0.11, 0.025]} />
          <mesh position={[0.2, 0.2 + index * 0.16, 0.37]}>
            <sphereGeometry args={[0.025, 8, 6]} />
            <meshStandardMaterial color={index % 3 === 0 ? "#F26B55" : COLORS.accent} emissive={index % 3 === 0 ? "#F26B55" : COLORS.accent} emissiveIntensity={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh castShadow position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.17, 0.14, 0.34, 14]} />
        <meshStandardMaterial color="#475766" roughness={0.66} />
      </mesh>
      {[[-0.12, 0.48, 0], [0.12, 0.52, 0.03], [0, 0.68, 0], [-0.08, 0.61, 0.08]].map(([x, y, z], index) => (
        <mesh key={index} castShadow position={[x, y, z]} rotation={[0.25 * index, 0.4 * index, 0.18 * (index - 1)]}>
          <sphereGeometry args={[0.2, 12, 8]} />
          <meshStandardMaterial color={index % 2 ? "#3A8665" : "#4A9A73"} roughness={0.78} />
        </mesh>
      ))}
    </group>
  );
}

function Sofa({ position, rotation = 0, width = 2.5 }: { position: Vec3; rotation?: number; width?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box color="#596470" position={[0, 0.25, 0]} size={[width, 0.35, 0.86]} />
      <Box color="#626D79" position={[0, 0.61, -0.34]} size={[width, 0.55, 0.16]} />
      <Box color="#4A5560" position={[-width / 2 + 0.12, 0.43, 0]} size={[0.24, 0.4, 0.86]} />
      <Box color="#4A5560" position={[width / 2 - 0.12, 0.43, 0]} size={[0.24, 0.4, 0.86]} />
      {[-0.28, 0.28].map((offset, index) => (
        <Box key={offset} color={index ? "#788490" : "#3D4D5D"} position={[offset * width, 0.55, -0.18]} size={[0.42, 0.38, 0.18]} />
      ))}
    </group>
  );
}

function MeetingTable() {
  return (
    <group position={[-4.4, 0, -0.55]}>
      <Box color="#AEB8C2" metalness={0.16} position={[0, 0.45, 0]} roughness={0.42} size={[5.05, 0.16, 1.62]} />
      <Box color="#556575" metalness={0.22} position={[-1.65, 0.22, 0]} size={[0.22, 0.44, 1.18]} />
      <Box color="#556575" metalness={0.22} position={[1.65, 0.22, 0]} size={[0.22, 0.44, 1.18]} />
      <Box color="#142B3C" emissive="#174B65" emissiveIntensity={0.28} position={[0, 0.55, 0]} size={[0.85, 0.06, 0.55]} />
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.08, 24]} />
        <meshStandardMaterial color={COLORS.accent} emissive={COLORS.accent} emissiveIntensity={0.38} />
      </mesh>
    </group>
  );
}

function ApprovalGate() {
  return (
    <group position={[-4.2, 0, 5.35]}>
      <Box color="#6B512D" metalness={0.16} position={[0, 0.55, 0]} roughness={0.4} size={[3.1, 0.82, 0.92]} />
      <Box color="#B78B3C" emissive="#6C4B16" emissiveIntensity={0.28} position={[0, 0.98, 0]} size={[3.28, 0.08, 1.02]} />
      <Box color="#1A2733" position={[0, 0.55, 0.48]} size={[2.45, 0.52, 0.04]} />
      <mesh position={[0, 0.57, 0.52]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.32, 0.32, 0.04]} />
        <meshStandardMaterial color={COLORS.gold} emissive="#765117" emissiveIntensity={0.35} />
      </mesh>
      <Box color="#1A2733" position={[0, 0.57, 0.55]} size={[0.25, 0.25, 0.05]} />
      <Plant position={[-1.85, 0, 0.15]} scale={0.82} />
      <Plant position={[1.85, 0, 0.15]} scale={0.82} />
    </group>
  );
}

const meetingChairs: Array<[Vec3, number]> = [
  [[-7.2, 0, -0.55], Math.PI / 2],
  [[-6.4, 0, -1.65], 0],
  [[-5.1, 0, -1.65], 0],
  [[-3.7, 0, -1.65], 0],
  [[-2.35, 0, -1.65], 0],
  [[-1.55, 0, -0.55], -Math.PI / 2],
  [[-6.4, 0, 0.55], Math.PI],
  [[-4.4, 0, 0.55], Math.PI],
  [[-2.35, 0, 0.55], Math.PI],
];

export function ConceptOfficeFurniture() {
  return (
    <group>
      {/* 1. CEO Office */}
      <Workstation executive monitors={1} position={[-11.5, 0, -6.15]} width={2.55} />
      <Cabinet color="#594131" position={[-12.45, 0, -7.55]} width={1.75} />
      <Box color="#D1A64A" emissive="#6C4A15" emissiveIntensity={0.35} position={[-13.3, 0.72, -4.7]} size={[0.12, 1.42, 0.12]} />
      <OfficeChair color="#5B4638" position={[-12.2, 0, -4.65]} rotation={Math.PI} />
      <OfficeChair color="#5B4638" position={[-10.8, 0, -4.65]} rotation={Math.PI} />

      {/* 2. AI Director */}
      <Workstation accent="#4FE0D1" executive monitors={3} position={[-6.8, 0, -6.15]} width={2.6} />
      <WallDashboard position={[-6.8, 0.82, -7.75]} width={2.8} />

      {/* 3. Market analysis */}
      <Workstation accent="#3DA5E6" monitors={3} position={[-2.6, 0, -6.15]} width={2.45} />
      <WallDashboard accent="#3DA5E6" position={[-2.6, 0.82, -7.75]} width={2.75} />

      {/* 4. Content Studio */}
      <Workstation accent="#4FE0D1" monitors={2} position={[3.0, 0, -6.15]} width={2.0} />
      <Workstation accent="#D7A84F" monitors={2} position={[6.2, 0, -6.15]} width={2.0} />
      <Workstation accent="#68B9F0" monitors={2} position={[9.4, 0, -6.15]} width={2.0} />
      <WallDashboard position={[6.2, 0.82, -7.75]} width={5.8} />
      <Plant position={[11.25, 0, -4.45]} scale={0.85} />

      {/* 5. QA & Audit */}
      <Workstation accent="#9B86DB" monitors={2} position={[-11.0, 0, -0.65]} width={2.25} />
      <WallDashboard accent="#9B86DB" position={[-11.0, 0.82, -2.75]} width={3.15} />
      <Cabinet position={[-12.75, 0, 0.7]} width={1.3} />

      {/* 9. Central meeting */}
      <MeetingTable />
      {meetingChairs.map(([position, rotation], index) => <OfficeChair key={index} color="#4B5967" position={position} rotation={rotation} />)}
      <WallDashboard position={[-4.4, 0.82, -2.75]} width={4.0} />
      <Plant position={[-7.7, 0, 1.05]} scale={0.82} />
      <Plant position={[-1.1, 0, 1.05]} scale={0.82} />

      {/* 6. Finance */}
      <Workstation accent="#4FE0D1" monitors={3} position={[2.6, 0, -0.65]} width={2.45} />
      <WallDashboard position={[2.6, 0.82, -2.75]} width={2.75} />

      {/* 7. Dev & Server */}
      <Workstation accent="#F26B55" monitors={3} position={[7.6, 0, -0.65]} width={2.5} />
      <ServerRack position={[10.35, 0, -1.05]} />
      <ServerRack position={[11.15, 0, -1.05]} />
      <WallDashboard accent="#F26B55" position={[7.6, 0.82, -2.75]} width={3.4} />
      <pointLight color="#F26B55" intensity={2.2} position={[10.75, 2.2, -0.5]} distance={3.8} />

      {/* 8. Publishing station */}
      <group position={[-10.8, 0, 5.45]}>
        <Box color="#344657" metalness={0.24} position={[0, 0.42, 0]} size={[3.8, 0.2, 1.05]} />
        {[-1.1, 0, 1.1].map((offset) => <Monitor key={offset} position={[offset, 0.92, -0.08]} scale={0.88} />)}
        <Box color={COLORS.accent} emissive={COLORS.accent} emissiveIntensity={0.55} position={[0, 0.55, 0.51]} size={[2.7, 0.035, 0.02]} />
      </group>
      <WallDashboard position={[-10.8, 0.82, 7.25]} rotation={Math.PI} width={3.6} />

      {/* 10. Approval gate */}
      <ApprovalGate />

      {/* 11. Lounge */}
      <Box color="#344656" position={[6.2, 0.025, 5.45]} roughness={0.92} size={[7.6, 0.05, 3.4]} />
      <Sofa position={[6.0, 0, 4.7]} width={3.15} />
      <Sofa position={[3.5, 0, 5.8]} rotation={Math.PI / 2} width={2.05} />
      <group position={[6.0, 0, 6.15]}>
        <mesh castShadow position={[0, 0.32, 0]}>
          <cylinderGeometry args={[0.85, 0.85, 0.18, 28]} />
          <meshStandardMaterial color="#76543E" roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.44, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.08, 20]} />
          <meshStandardMaterial color="#D0B58E" roughness={0.72} />
        </mesh>
      </group>
      <Cabinet color="#705B47" position={[10.2, 0, 6.45]} width={2.1} />
      <Box color="#CBD4DA" metalness={0.32} position={[10.2, 1.12, 6.38]} size={[0.62, 0.82, 0.48]} />
      <Plant position={[10.9, 0, 4.45]} />
      <Plant position={[1.25, 0, 6.85]} scale={0.9} />

      {/* Architectural ambient fixtures */}
      {[[-11.5, -6.0], [-6.8, -6.0], [-2.6, -6.0], [6.2, -6.0], [-11.0, -0.55], [-4.4, -0.55], [2.6, -0.55], [8.2, -0.55], [-10.8, 5.25], [-4.2, 5.25], [6.2, 5.25]].map(([x, z], index) => (
        <pointLight key={index} color={index === 9 ? "#D1A64A" : "#A8DDF4"} distance={5.4} intensity={1.4} position={[x, 3.0, z]} />
      ))}
    </group>
  );
}
