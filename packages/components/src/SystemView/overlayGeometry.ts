import { frameNameMatches } from "./frame";
import type { Placement } from "./projection";
import type { SystemEntitiesContext } from "./systemEntities";
import type { CelestialBody } from "./useCelestialBodies";

/** Mirrors `SystemDiagram`'s own `PAD`, so the overlay's metres → px scale matches the diagram's. */
const DIAGRAM_PAD = 20;

function plotScaleFor(
  baseRadius: number,
  extent: Placement["extent"],
  autoFitMetres: number,
): number {
  if (extent.kind === "fixed-units") {
    return extent.units > 0 ? baseRadius / extent.units : 1;
  }
  return autoFitMetres > 0 ? baseRadius / autoFitMetres : 1;
}

/**
 * SystemDiagram's auto-fit projection reconstructed exactly, so an augment or
 * a contributed entity draws in the SVG's coordinate space. `null` until there
 * is a frame and a measured diagram.
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
  let maxRadius = 0;
  for (const child of children) {
    const ecc = Math.min(Math.max(child.eccentricity ?? 0, 0), 0.999);
    const apo = (child.semiMajorAxis ?? 0) * (1 + ecc);
    if (apo > maxRadius) maxRadius = apo;
  }
  const vesselExtent =
    vesselOrbit && frameNameMatches(vesselOrbit.parentName, parentName)
      ? vesselOrbit.sma * (1 + Math.min(vesselOrbit.ecc, 0.999))
      : 0;
  const baseRadius = Math.min(size.w, size.h) / 2 - DIAGRAM_PAD;
  return {
    parentName,
    width: size.w,
    height: size.h,
    plotScale: plotScaleFor(
      baseRadius,
      projection?.extent ?? { kind: "auto-fit-metres" },
      Math.max(maxRadius, vesselExtent),
    ),
    // A contributed entity's metres are measured from the frame body's drawn position.
    center: { x: 0, y: 0 },
    placement: projection ?? undefined,
  };
}
