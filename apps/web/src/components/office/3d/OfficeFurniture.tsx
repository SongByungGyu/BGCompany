import { FurnitureRenderer } from "./furniture/FurnitureRenderer";
import type { OfficeLayout } from "./types";

export function OfficeFurniture({ layout }: { layout: OfficeLayout }) {
  return <FurnitureRenderer layout={layout} />;
}
