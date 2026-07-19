"use client";

import { useTexture } from "@react-three/drei";
import { RepeatWrapping, SRGBColorSpace, Vector2, type Texture } from "three";
import { officeMaterialTextures } from "./officeAssetCatalog";
import type { OfficeLayout } from "./types";

type Surface = {
  accent: string;
  base: string;
  clearcoat: number;
  metalness: number;
  roughness: number;
  surface: string;
};

const DEFAULT_SURFACE: Surface = {
  accent: "#42647C",
  base: "#111D2B",
  clearcoat: 0.14,
  metalness: 0.18,
  roughness: 0.5,
  surface: "#21384A",
};

const ROOM_SURFACES: Record<string, Surface> = {
  "approval-zone": { accent: "#CFA650", base: "#211C16", clearcoat: 0.16, metalness: 0.1, roughness: 0.54, surface: "#4A3B25" },
  "break-lounge": { accent: "#73998D", base: "#172425", clearcoat: 0.08, metalness: 0.04, roughness: 0.72, surface: "#304342" },
  "ceo-office": { accent: "#B98457", base: "#1D1817", clearcoat: 0.24, metalness: 0.05, roughness: 0.48, surface: "#4B3329" },
  "content-zone": { accent: "#3D9C9B", base: "#111C2A", clearcoat: 0.18, metalness: 0.2, roughness: 0.44, surface: "#24384A" },
  "dev-ops-zone": { accent: "#A54E4B", base: "#17171D", clearcoat: 0.2, metalness: 0.28, roughness: 0.38, surface: "#302834" },
  "director-room": { accent: "#398E94", base: "#101D27", clearcoat: 0.22, metalness: 0.2, roughness: 0.42, surface: "#254352" },
  "finance-room": { accent: "#3D8D9A", base: "#111D28", clearcoat: 0.2, metalness: 0.22, roughness: 0.42, surface: "#294454" },
  "knowledge-audit-zone": { accent: "#7468A8", base: "#151A28", clearcoat: 0.14, metalness: 0.16, roughness: 0.52, surface: "#29334A" },
  "market-analysis-room": { accent: "#3476A9", base: "#101A28", clearcoat: 0.22, metalness: 0.24, roughness: 0.4, surface: "#203B55" },
  "meeting-room": { accent: "#4C9D99", base: "#151C22", clearcoat: 0.08, metalness: 0.08, roughness: 0.72, surface: "#33414D" },
  "review-zone": { accent: "#3F9994", base: "#102325", clearcoat: 0.16, metalness: 0.18, roughness: 0.48, surface: "#234247" },
};

const WOOD_NORMAL_SCALE = new Vector2(0.62, 0.62);

function configureTexture(texture: Texture, repeat: [number, number], isColor = false) {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(...repeat);
  if (isColor) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
}

function FloorBorder({ accent, depth, width }: { accent: string; depth: number; width: number }) {
  return (
    <group>
      {[
        [0, -depth / 2 + 0.09, width - 0.14, 0.035],
        [0, depth / 2 - 0.09, width - 0.14, 0.035],
      ].map(([x, z, itemWidth, itemDepth], index) => (
        <mesh key={`h-${index}`} position={[x, 0.092, z]}>
          <boxGeometry args={[itemWidth, 0.016, itemDepth]} />
          <meshBasicMaterial color={accent} opacity={0.45} transparent toneMapped={false} />
        </mesh>
      ))}
      {[
        [-width / 2 + 0.09, 0],
        [width / 2 - 0.09, 0],
      ].map(([x, z], index) => (
        <mesh key={`v-${index}`} position={[x, 0.092, z]}>
          <boxGeometry args={[0.035, 0.016, depth - 0.14]} />
          <meshBasicMaterial color={accent} opacity={0.32} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function OfficeRooms({ layout }: { layout: OfficeLayout }) {
  const darkWoodMaps = useTexture(officeMaterialTextures.darkWood);
  const parquetMaps = useTexture(officeMaterialTextures.parquet);

  configureTexture(darkWoodMaps.map, [3.6, 2.4], true);
  configureTexture(darkWoodMaps.normalMap, [3.6, 2.4]);
  configureTexture(darkWoodMaps.roughnessMap, [3.6, 2.4]);
  configureTexture(parquetMaps.map, [4.2, 3.2], true);
  configureTexture(parquetMaps.normalMap, [4.2, 3.2]);
  configureTexture(parquetMaps.roughnessMap, [4.2, 3.2]);

  return (
    <group>
      {layout.rooms.map((room) => {
        const [width, depth] = room.size;
        const [x, y, z] = room.position;
        const surface = ROOM_SURFACES[room.id] ?? DEFAULT_SURFACE;
        const materialMaps = room.id === "ceo-office"
          ? darkWoodMaps
          : room.id === "break-lounge"
            ? parquetMaps
            : null;
        return (
          <group key={room.id} position={[x, y, z]}>
            <mesh receiveShadow position={[0, 0.03, 0]}>
              <boxGeometry args={[width - 0.04, 0.06, depth - 0.04]} />
              <meshStandardMaterial color={surface.base} metalness={0.12} roughness={0.7} />
            </mesh>
            <mesh receiveShadow position={[0, 0.066, 0]}>
              <boxGeometry args={[width - 0.22, 0.026, depth - 0.22]} />
              {materialMaps ? (
                <meshPhysicalMaterial
                  clearcoat={surface.clearcoat}
                  clearcoatRoughness={0.42}
                  color="#B7C1C7"
                  map={materialMaps.map}
                  metalness={0.02}
                  normalMap={materialMaps.normalMap}
                  normalScale={WOOD_NORMAL_SCALE}
                  roughness={0.82}
                  roughnessMap={materialMaps.roughnessMap}
                />
              ) : (
                <meshPhysicalMaterial
                  clearcoat={surface.clearcoat}
                  clearcoatRoughness={0.38}
                  color={surface.surface}
                  metalness={surface.metalness}
                  roughness={surface.roughness}
                />
              )}
            </mesh>
            <FloorBorder accent={surface.accent} depth={depth} width={width} />
            {room.id === "dev-ops-zone" ? (
              <mesh receiveShadow position={[2.25, 0.09, 0]}>
                <boxGeometry args={[2.15, 0.018, depth - 0.48]} />
                <meshStandardMaterial color="#171B22" metalness={0.42} roughness={0.4} />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
