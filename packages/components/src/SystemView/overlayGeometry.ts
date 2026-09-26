import { diagramPlotScale, maxApoapsis } from "./diagramGeometry";
import type { Placement } from "./projection";
import type { SystemEntitiesContext } from "./systemEntities";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * SystemDiagram's auto-fit projection, through the same scale the diagram
 * uses, so an augment or a contributed entity draws in the SVG's coordinate
 * space. `null` until there is a frame and a measured diagram.
 */
export function overlayGeometry({
  parentName,
  children,
  vesselOrbit,
  size,
  projection,
}: {
  parentName: string | null;
  children: readonly CelestialBody[];
  vesselOrbit: { parentName: string; sma: number; ecc: number } | null;
  size: { w: number; h: number };
  projection: Placement | null;
}): SystemEntitiesContext | null {
  if (parentName === null || size.w <= 0 || size.h <= 0) return null;
  return {
    parentName,
    width: size.w,
    height: size.h,
    plotScale: diagramPlotScale({
      width: size.w,
      height: size.h,
      extent: projection?.extent ?? { kind: "auto-fit-metres" },
      maxRadius: maxApoapsis(children),
      vessel: vesselOrbit,
      parentName,
    }),
    // A contributed entity's metres are measured from the frame body's drawn position.
    center: { x: 0, y: 0 },
    placement: projection ?? undefined,
  };
}
