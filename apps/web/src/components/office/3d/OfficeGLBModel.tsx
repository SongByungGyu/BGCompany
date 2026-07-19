"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { memo, Suspense, useEffect, useMemo } from "react";
import { Box3, Mesh, MeshStandardMaterial, Vector3, type Material } from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { officeModelUrls } from "./officeAssetCatalog";

type Vec3 = [number, number, number];

type OfficeGLBModelProps = {
  animation?: string;
  animationSpeed?: number;
  fit: Vec3;
  fitMode?: "contain" | "stretch";
  position?: Vec3;
  rotation?: Vec3;
  url: string;
};

function prepareMaterial(material: Material) {
  const prepared = material.clone();
  if (prepared instanceof MeshStandardMaterial) {
    prepared.envMapIntensity = 0.8;
    prepared.roughness = Math.max(0.3, prepared.roughness);
    prepared.metalness = Math.min(0.72, prepared.metalness);
  }
  return prepared;
}

function OfficeGLBModelAsset({
  animation,
  animationSpeed = 1,
  fit,
  fitMode = "contain",
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  url,
}: OfficeGLBModelProps) {
  const [fitX, fitY, fitZ] = fit;
  const { animations, scene } = useGLTF(url);
  const model = useMemo(() => {
    const cloned = cloneSkeleton(scene);
    cloned.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = Array.isArray(child.material)
        ? child.material.map(prepareMaterial)
        : prepareMaterial(child.material);
    });
    return cloned;
  }, [scene]);
  const { mixer } = useAnimations(animations, model);
  const transform = useMemo(() => {
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const safeSize = new Vector3(
      Math.max(size.x, 0.0001),
      Math.max(size.y, 0.0001),
      Math.max(size.z, 0.0001),
    );
    const scale = fitMode === "stretch"
      ? new Vector3(fitX / safeSize.x, fitY / safeSize.y, fitZ / safeSize.z)
      : new Vector3().setScalar(Math.min(fitX / safeSize.x, fitY / safeSize.y, fitZ / safeSize.z));

    return {
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
      scale,
    };
  }, [fitMode, fitX, fitY, fitZ, model]);

  useEffect(() => {
    if (!animation) return;
    const clip = animations.find((item) => item.name === animation)
      ?? animations.find((item) => item.name === "idle")
      ?? animations[0];
    if (!clip) return;
    const action = mixer.clipAction(clip, model);
    action.reset().setEffectiveTimeScale(animationSpeed).fadeIn(0.18).play();
    return () => {
      action.stop();
      mixer.uncacheAction(clip, model);
    };
  }, [animation, animationSpeed, animations, mixer, model]);

  return (
    <group position={position} rotation={rotation}>
      <group scale={transform.scale}>
        <primitive dispose={null} object={model} position={transform.offset} />
      </group>
    </group>
  );
}

function sameVec3(left?: Vec3, right?: Vec3) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

export const OfficeGLBModel = memo(function OfficeGLBModel(props: OfficeGLBModelProps) {
  return (
    <Suspense fallback={null}>
      <OfficeGLBModelAsset {...props} />
    </Suspense>
  );
}, (previous, next) => (
  previous.animation === next.animation
  && previous.animationSpeed === next.animationSpeed
  && previous.fitMode === next.fitMode
  && previous.url === next.url
  && sameVec3(previous.fit, next.fit)
  && sameVec3(previous.position, next.position)
  && sameVec3(previous.rotation, next.rotation)
));

officeModelUrls.forEach((url) => useGLTF.preload(url));
