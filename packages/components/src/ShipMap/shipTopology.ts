import type { PartResources, PartThermal, TopologyPart } from "@gonogo/core";

/**
 * Diagram-side categories. Narrower than KSP's `PartCategories` enum
 * because the renderer only cares about visually distinct shapes
 * (engine / booster / tank / decoupler / fin / rcs / capsule / solar /
 * parachute / other). All other KSP categories collapse to "other".
 */
export type PartType =
  | "engine"
  | "booster"
  | "tank"
  | "decoupler"
  | "fin"
  | "rcs"
  | "capsule"
  | "solar"
  | "parachute"
  | "other";

/**
 * Flattened per-part view consumed by `<ShipDiagram>`. Combines the static
 * topology fields with whatever live data has landed so far. Live data is
 * optional: the diagram falls back to topology values (e.g. `dryMass`)
 * when the corresponding `r.resourceFor` / `therm.part` push hasn't
 * arrived yet.
 */
export interface ShipMapPart {
  flightId: number;
  parentFlightId: number | null;
  name: string;
  title: string;
  type: PartType;
  /** Position component along the picked lateral axis (x or y). */
  lat: number;
  /** Position along the spine (orgPos z). */
  axial: number;
  /** Prefab bounds in metres — `{x, y, z}` from `v.topology.parts[].bounds.size`. */
  size: { x: number; y: number; z: number };
  /** Half-extent along the picked lateral axis (matches whatever `useX`
   *  chose when building this part). Always in metres. */
  latHalfExtent: number;
  /** Half-extent along the vessel-local Y axis (the spine). In metres. */
  axialHalfExtent: number;
  /** `Part.mass` from topology — dry mass, no resources. */
  dryMass: number;
  /** `Part.inverseStage` from topology. */
  stage: number;
  /** Internal-part max temperature (K) from topology. */
  maxTemp: number;
  /** Live temperature in Kelvin from `therm.part[flightId]`, if available. */
  temperatureK?: number;
  /** Live max temperature in Kelvin (matches topology `maxTemp` unless the
   *  game adjusts it mid-flight). */
  maxTemperatureK?: number;
  /** Live resources from `r.resourceFor[flightId]`, normalised to the same
   *  `{n, a, c}` triplet shape the diagram uses for fuel-fill bars. */
  resources?: { n: string; a: number; c: number }[];
  /**
   * Net ElectricCharge flow sign on this part — drives a subtle producer /
   * consumer ring in the diagram. `null` when there's no live flow row
   * (the part doesn't contribute to EC). EC is the only resource tinted in
   * v1; other resources can be added behind a config later.
   */
  ecFlowSign?: "producer" | "consumer" | null;
}

/**
 * Classify a part into one of the diagram's coarse `PartType` buckets.
 * Mirrors the kerboscript's old derivation (which lived in
 * `shipMapScript.ts`): module names are the primary signal, with a
 * SolidFuel resource pass distinguishing solid boosters from liquid
 * engines.
 *
 * `resources` is optional because resource data arrives asynchronously
 * after the topology snapshot. Booster classification needs it; tank
 * classification is also resource-driven. Falls back to KSP's
 * `PartCategories` enum (the `category` field) and finally to a
 * name/title heuristic so first-frame renders look sensible before live
 * resource data arrives.
 */
export function classifyPart(
  part: TopologyPart,
  resources?: PartResources,
): PartType {
  const modules = part.modules;
  const hasEngine = modules.some((m) => m.includes("Engine"));
  const hasDecouple = modules.some(
    (m) => m.includes("Decouple") || m.includes("Separator"),
  );
  const hasRCSMod = modules.some((m) => m.includes("RCS"));
  const hasCommand = modules.some((m) => m.includes("Command"));
  const hasSolar = modules.some((m) => m.includes("SolarPanel"));
  const hasParachute = modules.some((m) => m.includes("Parachute"));
  const hasFin = modules.some(
    (m) =>
      m.includes("LiftingSurface") ||
      m.includes("AeroSurface") ||
      m.includes("ControlSurface"),
  );
  // Cargo bays / service bays carry ModuleLiftingSurface for the body-
  // lift bonus, but visually they're boxes, not wings. Disqualify the
  // fin classification when we see a ModuleCargoBay so a 2.5 m bay
  // doesn't render as a giant triangle (this was the rover's mk2CargoBayS
  // dominating every harness render before the gate was added).
  const hasCargoBay = modules.some((m) => m.includes("CargoBay"));

  const hasSolidFuel =
    !!resources &&
    Object.hasOwn(resources, "SolidFuel") &&
    (resources.SolidFuel?.maxAmount ?? 0) > 0;
  const hasAnyResource = resources && Object.keys(resources).length > 0;

  if (hasEngine && hasSolidFuel) return "booster";
  if (hasEngine) return "engine";
  if (hasDecouple) return "decoupler";
  if (hasRCSMod) return "rcs";
  if (hasCommand) return "capsule";
  if (hasSolar) return "solar";
  if (hasParachute) return "parachute";
  if (hasFin && !hasCargoBay) return "fin";
  if (hasAnyResource) return "tank";

  // Fall back to KSP's `PartCategories` enum, then name/title heuristics.
  return (
    categoryFromKsp(part.category) ?? classifyByName(part.name, part.title)
  );
}

function categoryFromKsp(category: string): PartType | null {
  switch (category) {
    case "Engine":
      return "engine";
    case "FuelTank":
      return "tank";
    case "Coupling":
      return "decoupler";
    case "Control":
      return "rcs";
    case "Pods":
      return "capsule";
    case "Electrical":
      return "solar";
    case "Aero":
      return "fin";
    case "Utility":
    case "Science":
    case "Structural":
    case "Communication":
    case "Thermal":
    case "Ground":
      return "other";
    default:
      return null;
  }
}

function classifyByName(name: string, title: string): PartType {
  const n = `${name} ${title}`.toLowerCase();
  if (n.includes("solid") && n.includes("booster")) return "booster";
  if (n.includes("engine") || n.includes("liquidengine")) return "engine";
  if (n.includes("decoupler") || n.includes("separator")) return "decoupler";
  if (n.includes("rcs") || n.includes("monoprop") || n.includes("thruster"))
    return "rcs";
  if (n.includes("winglet") || n.includes("wing") || n.includes("fin"))
    return "fin";
  if (
    n.includes("capsule") ||
    n.includes("pod") ||
    n.includes("command") ||
    n.includes("cockpit")
  )
    return "capsule";
  if (n.includes("solar") || n.includes("photovoltaic")) return "solar";
  if (n.includes("parachute")) return "parachute";
  if (
    n.includes("tank") ||
    n.includes("fuel") ||
    n.includes("fl-t") ||
    n.includes("fl-r") ||
    n.includes("rocketmax")
  )
    return "tank";
  return "other";
}

/** Normalise `r.resourceFor` output into the `{n, a, c}` shape the diagram
 *  uses for fuel-fill rendering. Drops resources with zero capacity. */
export function normaliseResources(
  resources: PartResources | undefined,
): ShipMapPart["resources"] {
  if (!resources) return undefined;
  const out: { n: string; a: number; c: number }[] = [];
  for (const [name, slot] of Object.entries(resources)) {
    if (!slot || slot.maxAmount <= 0) continue;
    out.push({ n: name, a: slot.amount, c: slot.maxAmount });
  }
  return out;
}

/**
 * Pick whichever vessel-local lateral axis (X or Z) has the wider spread,
 * so the side-view shows the actual silhouette rather than edge-on. In KSP
 * the vessel's local Y axis is the stack/spine direction (parts run from
 * pod at y≈0 down to engines at y<<0); X and Z are the two horizontal
 * lateral axes that radial-mounted parts spread across. Parts on the
 * other lateral axis still project onto the spine and overlap — the
 * known 2D-projection limitation of this widget.
 */
export function pickLateralAxis(parts: readonly TopologyPart[]): {
  useX: boolean;
} {
  if (parts.length === 0) return { useX: true };
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of parts) {
    const [x, , z] = p.orgPos;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  return { useX: xMax - xMin >= zMax - zMin };
}

/**
 * Build a `ShipMapPart` from one topology entry + the live slice. Live
 * temperature uses `therm.part`'s Kelvin reading; resources are
 * normalised to the diagram's `{n, a, c}` triple. The caller picks the
 * lateral axis (see `pickLateralAxis`) once per vessel and threads the
 * decision through `useX`.
 */
export function buildShipMapPart(
  part: TopologyPart,
  thermal: PartThermal | null | undefined,
  resources: PartResources | undefined,
  useX: boolean,
): ShipMapPart {
  const orgPos = part.orgPos;
  const ecFlow = resources?.ElectricCharge?.flow;
  const ecFlowSign: "producer" | "consumer" | null =
    typeof ecFlow === "number" && Math.abs(ecFlow) > 1e-6
      ? ecFlow > 0
        ? "producer"
        : "consumer"
      : null;
  const size = part.bounds.size;
  return {
    flightId: part.flightId,
    parentFlightId: part.parentFlightId,
    name: part.name,
    title: part.title,
    type: classifyPart(part, resources),
    lat: useX ? orgPos[0] : orgPos[2],
    axial: orgPos[1],
    size,
    // Vessel-local Y is the spine; the bounds emit in part-local frame
    // where Y is also the axial extent, so this maps 1:1 for axially
    // aligned parts (the majority). Lateral picks the picked axis to
    // match the projected silhouette — using max(x,y) like the previous
    // implementation mistook a part's axial extent for lateral, blowing
    // up wing-shaped parts (e.g. radial solar panels would render as
    // 1.6m wings instead of 0.16m thin strips).
    latHalfExtent: (useX ? size.x : size.z) / 2,
    axialHalfExtent: size.y / 2,
    dryMass: part.dryMass,
    stage: part.inverseStage,
    maxTemp: part.maxTemp,
    temperatureK: thermal?.temperatureK,
    maxTemperatureK: thermal?.maxTemperatureK,
    resources: normaliseResources(resources),
    ecFlowSign,
  };
}
