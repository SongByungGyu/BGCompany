import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import {
  MathUtils,
  OrthographicCamera as ThreeOrthographicCamera,
  Vector3,
} from "three";
import type { OfficeLayout } from "./types";

export function OfficeCamera({ layout }: { layout: OfficeLayout }) {
  const cameraRef = useRef<ThreeOrthographicCamera>(null);
  const { height, width } = useThree((state) => state.size);
  const target = layout.camera.target;

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera || width === 0 || height === 0) {
      return;
    }

    camera.position.set(...layout.camera.position);
    camera.up.set(...layout.camera.up);
    camera.lookAt(...target);
    camera.updateMatrixWorld(true);

    const [officeWidth, officeDepth] = layout.office.size;
    const halfWidth = officeWidth / 2;
    const halfDepth = officeDepth / 2;
    const maxHeight = Math.max(
      layout.dimensions.outerWallHeight,
      layout.dimensions.innerWallHeight,
      layout.dimensions.glassWallHeight,
    ) + 0.35;
    const corners = [0, maxHeight].flatMap((y) => [
      new Vector3(-halfWidth, y, -halfDepth),
      new Vector3(halfWidth, y, -halfDepth),
      new Vector3(-halfWidth, y, halfDepth),
      new Vector3(halfWidth, y, halfDepth),
    ]).map((corner) => corner.applyMatrix4(camera.matrixWorldInverse));

    const projectedWidth =
      Math.max(...corners.map((corner) => corner.x)) -
      Math.min(...corners.map((corner) => corner.x));
    const projectedHeight =
      Math.max(...corners.map((corner) => corner.y)) -
      Math.min(...corners.map((corner) => corner.y));

    // Fit the full dollhouse silhouette, including wall height. This keeps the
    // isometric depth without clipping the front lounge or the top-room signs.
    const fittedZoom =
      Math.min(width / projectedWidth, height / projectedHeight) *
      layout.camera.coverage;

    camera.zoom = MathUtils.clamp(
      fittedZoom,
      layout.camera.minZoom,
      layout.camera.maxZoom,
    );
    camera.updateProjectionMatrix();
  }, [height, layout, target, width]);

  return (
    <>
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        position={layout.camera.position}
        zoom={layout.camera.zoom}
        near={0.1}
        far={120}
      />
      <OrbitControls
        makeDefault
        target={target}
        enableRotate={false}
        enablePan={false}
        enableZoom
        minZoom={layout.camera.minZoom}
        maxZoom={layout.camera.maxZoom}
        zoomSpeed={0.65}
      />
    </>
  );
}
