import type {
  PartResources,
  PartState,
  PartStateModule,
  PartThermal,
  TopologyPart,
} from "@ksp-gonogo/core";
import { KspPartCategory } from "@ksp-gonogo/sitrep-sdk";
import type { MeterTone } from "@ksp-gonogo/ui-kit";

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
  | "nose-cone"
  | "fin"
  | "rcs"
  | "capsule"
  | "solar"
  | "parachute"
  | "wheel"
  | "fuel-line"
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
  /**
   * Position along the collapsed depth axis (the lateral axis NOT picked
   * for the 2D side view). Not drawn, but it's the only depth cue we have:
   * the renderer sorts parts back-to-front by it so a front-facing radial
   * part (panel, winglet) paints over the fuselage instead of behind it.
   */
  depth: number;
  /**
   * Screen-space CCW rotation in radians applied to the part's body box
   * when rendering. Derived from the part's vessel-local `up` vector
   * projected into the same 2D plane the diagram uses for positions:
   * axial → screen-up, lateral (picked) → screen-right. A part with
   * `up=[0,1,0]` (axially mounted) renders with zero rotation; a part
   * with `up=[1,0,0]` rotates 90° clockwise; an inverted part rotates
   * 180°. Falls back to 0 when the fork didn't emit `up`.
   */
  rotationRad: number;
  /** Prefab bounds in metres: `{x, y, z}` from `v.topology.parts[].bounds.size`. */
  size: { x: number; y: number; z: number };
  /** Half-extent along the picked lateral axis (matches whatever `useX`
   *  chose when building this part). Always in metres. */
  latHalfExtent: number;
  /** Half-extent along the vessel-local Y axis (the spine). In metres. */
  axialHalfExtent: number;
  /** `Part.mass` from topology: dry mass, no resources. */
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
  /** Live resources from `usePartsLive` (sourced off the `vessel.parts`
   *  stream), normalised to the same `{n, a, c}` triplet shape the diagram
   *  uses for fuel-fill bars. */
  resources?: { n: string; a: number; c: number }[];
  /**
   * Net ElectricCharge flow sign on this part, drives a subtle producer /
   * consumer ring in the diagram. `null` when there's no live flow row
   * (the part doesn't contribute to EC). EC is the only resource tinted in
   * v1; other resources can be added behind a config later.
   */
  ecFlowSign?: "producer" | "consumer" | null;
  /**
   * Pass-through from `TopologyPart.fuelLineTarget`: the destination
   * tank's flightId for fuel-line parts. Used by the renderer to draw
   * source→target arrows.
   */
  fuelLineTarget?: number | null;
  /**
   * Per-module behavioural state from `usePartsLive` (sourced off the
   * `vessel.parts` stream). Carries deploy / activation status for solar
   * panels, radiators, antennas, parachutes, engines, drills, cargo bays,
   * and landing gear. Empty array when the part has no behavioural
   * modules; undefined when no `vessel.parts` payload has landed yet
   * (consumers should treat it as "unknown" rather than "all retracted").
   */
  partState?: PartStateModule[];
}

/**
 * One resource meter for a single part, aggregated from the
 * `ship-map.part-meters` contribution slot (the framework's self-
 * contribution flagship). Both the built-in `core` contribution
 * (the five classic drainable propellants, `ShipMap/partMetersContribution.ts`)
 * and a Kerbalism-style Uplink contribution (its supply tanks) emit this SAME
 * shape onto the SAME slot, so `ShipDiagramSvg`'s per-part fill bars and
 * `ShipDiagram`'s hover tooltip read one aggregated list regardless of which
 * contributor produced an entry. There is no hardcoded resource allowlist
 * left in ShipMap itself: which resource earns a meter on which part is
 * entirely the contributor's call.
 *
 * Identity is separate from status: the meter's FILL colour is the resource's
 * IDENTITY (`resourceColor(resource)`, derived by the renderer from
 * `resource`, not carried on the wire), and is entirely independent of
 * `status`. A contributor therefore never picks a colour at all, only a
 * name and a status.
 */
export interface ShipMapPartMeterEntry {
  /**
   * `ShipMapPart.flightId`, stringified: contribution entries travel through
   * the generic per-slot aggregation store as plain data, so the key stays a
   * string rather than baking in a numeric-vs-string identity assumption.
   */
  partId: string;
  /** Resource name exactly as it appears on `vessel.parts` (e.g.
   *  "LiquidFuel", "Water"). Doubles as part of this meter's identity: a
   *  contributor should emit at most one entry per (partId, resource) pair.
   *  Also the renderer's key into `resourceColor` for the fill's identity
   *  colour, see this interface's own doc comment. */
  resource: string;
  /** Human label. Falls back to `resource` when the contributor has no nicer
   *  name (the built-in five don't; a Kerbalism profile's
   *  `KerbalismResourceDef.displayName` does). */
  displayName: string;
  /** Current stored amount, resource units. */
  amount: number;
  /** Max storage capacity, resource units. A renderer drops any entry with
   *  `capacity <= 0` (nothing to fill), the same guard the old hardcoded
   *  `renderResourceFill` applied. */
  capacity: number;
  /**
   * A SEPARATE status signal, never the fill hue: `"critical"` /
   * `"low"` draw a border tint or badge alongside the identity-coloured
   * fill; `null`/`undefined` means healthy, no status signal drawn. A
   * contributor decides its own low/critical thresholds (a Kerbalism
   * profile's `lowThreshold`, or the built-in contribution's own ratio
   * cutoffs); ShipMap only renders whichever of the two levels it's given.
   */
  status?: "low" | "critical" | null;
}

/**
 * One per-part status/metadata row for the `ship-map.part-meta` slot: things
 * about a part that aren't a fill-level meter. Today the Kerbalism
 * contribution only has real per-part data for a fitted process's
 * running/broken state (`KerbalismLifeSupport.processes[].flightId`); habitat
 * pressure, radiation dose, and reliability MTBF are NOT yet on the wire with
 * per-part granularity (only vessel-wide aggregates), so no contributor emits
 * a `"ratio"` entry yet. The shape reserves that case rather than leaving it
 * unmodelled, see the Kerbalism contribution's own doc comment for the exact
 * gap.
 */
export interface ShipMapPartMetaEntry {
  /** `ShipMapPart.flightId`, stringified (see `ShipMapPartMeterEntry.partId`). */
  partId: string;
  /** Short label, e.g. "Water Recycler". Doubles as part of this row's
   *  identity: a contributor should emit at most one entry per (partId,
   *  label) pair. */
  label: string;
  tone: MeterTone;
  /**
   * "ratio": a 0..1 reading, rendered as a `<Meter>` (reserved: see the
   * interface doc above, nothing emits this today). "text": a free-form
   * status string, rendered as a plain label/value row (fitted-process
   * running/broken/idle state today).
   */
  kind: "ratio" | "text";
  /** Present when `kind === "ratio"`. */
  value?: number;
  /** Present when `kind === "text"`. */
  text?: string;
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
  const hasWheel = modules.some((m) => m.includes("ModuleWheelBase"));
  const isFuelLine = modules.some((m) => m.includes("CModuleFuelLine"));

  const hasSolidFuel =
    !!resources &&
    Object.hasOwn(resources, "SolidFuel") &&
    (resources.SolidFuel?.maxAmount ?? 0) > 0;
  const hasAnyResource = resources && Object.keys(resources).length > 0;

  // Nose cones live under PartCategories.Aero alongside wings + control
  // surfaces, but they're shape-distinct (rounded dome vs. triangle) so
  // they get their own classification. Name-based detection because KSP
  // doesn't gate them with a dedicated module; convention is reliable
  // ("noseCone", "rocketNoseCone", "nosecone_v2", etc.).
  const isNoseCone = part.name.toLowerCase().includes("nose");

  if (hasEngine && hasSolidFuel) return "booster";
  if (hasEngine) return "engine";
  if (hasWheel) return "wheel";
  // Fuel lines come back from KSP under PartCategories.FuelTank with
  // bounds that wrap the whole conduit run (per the 2026-05-15 audit),
  // neither the category nor the bounds are useful for rendering. Bail
  // out before the resource-based 'tank' fallback so they get the
  // dedicated source→target arrow treatment in the renderer.
  if (isFuelLine) return "fuel-line";
  if (hasDecouple) return "decoupler";
  if (hasRCSMod) return "rcs";
  if (hasCommand) return "capsule";
  if (hasSolar) return "solar";
  if (hasParachute) return "parachute";
  if (isNoseCone) return "nose-cone";
  if (hasFin && !hasCargoBay) return "fin";
  if (hasAnyResource) return "tank";

  // Fall back to KSP's `PartCategories` enum, then name/title heuristics.
  return (
    categoryFromKsp(part.categoryOrdinal) ??
    classifyByName(part.name, part.title)
  );
}

/**
 * KSP's `PartCategories` ORDINAL to a diagram glyph, or null for a category
 * this diagram has no distinct shape for.
 *
 * Switched on the NAME until 2026-08-21, which is KSP's spelling to change.
 * A renamed member did not break anything visibly: every part of that category
 * fell through to `classifyByName`, so engines got drawn as whatever their title
 * happened to match, and nothing said it had happened. Falling through to a
 * heuristic is the right behaviour for a category with no glyph; it is the wrong
 * behaviour for `Engine`.
 *
 * Null covers three cases that all want the heuristic underneath: no ordinal
 * sent, a category with no distinct glyph, and a category KSP has added since.
 * `Propulsion`, `Payload`, `Cargo`, `Robotics` and `none` are members with no
 * arm here, which is deliberate rather than an omission: a part in one of those
 * is better served by its modules and title than by a generic box.
 */
function categoryFromKsp(ordinal: number | null | undefined): PartType | null {
  if (ordinal == null) return null;
  switch (ordinal) {
    case KspPartCategory.Engine:
      return "engine";
    case KspPartCategory.FuelTank:
      return "tank";
    case KspPartCategory.Coupling:
      return "decoupler";
    case KspPartCategory.Control:
      return "rcs";
    case KspPartCategory.Pods:
      return "capsule";
    case KspPartCategory.Electrical:
      return "solar";
    case KspPartCategory.Aero:
      return "fin";
    case KspPartCategory.Utility:
    case KspPartCategory.Science:
    case KspPartCategory.Structural:
    case KspPartCategory.Communication:
    case KspPartCategory.Thermal:
    case KspPartCategory.Ground:
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
 * other lateral axis still project onto the spine and overlap, the
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
  partState?: PartState | null,
  parentOrgPos?: readonly [number, number, number] | null,
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
  // Project the part's vessel-local up vector into screen space. The
  // diagram maps vessel +axial → screen-up (smaller y) and vessel
  // +picked-lateral → screen-right (larger x), so the rotation angle
  // is `atan2(lateral, axial)` from screen-up. Without fork-emitted up,
  // default to axially-aligned (zero rotation).
  //
  // Edge-on guard: when both projected components are near zero the
  // part's up points along the collapsed depth axis, atan2 in that
  // case would flip 0 vs π depending on the sign of -0 (Unity routinely
  // emits -0.0 for components that are floating-point zero). Render
  // unrotated rather than picking a meaningless angle.
  const up = part.up;
  const upLat = up ? (useX ? up[0] : up[2]) : 0;
  const upAxial = up ? up[1] : 1;
  const projectedMagSq = upLat * upLat + upAxial * upAxial;
  const rotationRad = projectedMagSq < 0.01 ? 0 : Math.atan2(upLat, upAxial);
  // Mesh-centre offset (pre-rotated to vessel frame on the fork side).
  // orgPos is the attach-node anchor; for radial-mount parts the mesh
  // centre sits some distance away. The diagram positions the body box
  // on the mesh centre, not the anchor, so radial decouplers don't
  // appear to sink into the parent stack. Defaults to zero so fixtures
  // captured before the fork started emitting bounds.center still
  // render identically (correct for axially-stacked parts where mesh
  // centre = anchor).
  const center = part.bounds.center;
  const meshLat =
    (useX ? orgPos[0] : orgPos[2]) +
    (center ? (useX ? center.x : center.z) : 0);
  const meshDepth =
    (useX ? orgPos[2] : orgPos[0]) +
    (center ? (useX ? center.z : center.x) : 0);
  const meshAxial = orgPos[1] + (center?.y ?? 0);
  const type = classifyPart(part, resources);
  // Lateral half-extent along the picked axis: normally just the picked-
  // axis half of the prefab bounds. Flat radial plates (solar panels and
  // fins) are the exception: a 2D side view reads better when each is
  // foreshortened by how face-on it is to the viewer. One on the collapsed
  // depth axis shows its full broad silhouette; one on the picked axis
  // collapses toward its thin edge. Azimuth comes from the part's offset
  // from its parent; true proportions from `size`. The mount rotation isn't
  // on the wire (only near-axial `up` is), so we assume the ring convention
  // that the thin axis faces radially out (panels) / tangentially (fins).
  // Exact for evenly clocked rings, a good approximation otherwise. Parent-
  // relative (not root-relative): a plate on a docked or offset sub-stack
  // must foreshorten by its mount direction on that stack, not by the
  // stack's distance from the vessel root.
  let latHalfExtent = (useX ? size.x : size.z) / 2;
  if (type === "solar" || type === "fin") {
    const parentLat = parentOrgPos
      ? useX
        ? parentOrgPos[0]
        : parentOrgPos[2]
      : 0;
    const parentDepth = parentOrgPos
      ? useX
        ? parentOrgPos[2]
        : parentOrgPos[0]
      : 0;
    const pickedPos = (useX ? orgPos[0] : orgPos[2]) - parentLat;
    const depthPos = (useX ? orgPos[2] : orgPos[0]) - parentDepth;
    const radius = Math.hypot(pickedPos, depthPos);
    if (radius > 0.05) {
      // Project the flat plate onto the picked axis. The two lateral-plane
      // extents are the broad dimension and the thin edge (size.y is the
      // axial height, handled separately). A solar panel's broad face is
      // tangential and its thin (cell-normal) axis is radial; a fin's broad
      // dimension is its radial span and its thin (blade-normal) axis is
      // tangential: so the two swap which extent rides the radial vs the
      // tangential direction.
      const broad = Math.max(size.x, size.z);
      const thin = Math.min(size.x, size.z);
      const ru = Math.abs(pickedPos / radius);
      const rd = Math.abs(depthPos / radius);
      // A fin reads full when side-on (ru=1) and edge-on when it points at
      // the camera (ru=0). The true orthographic falloff is linear in `ru`,
      // but that's subtle at a glance: a 45° fin still shows ~71% span. We
      // square it so angled fins read clearly shorter, leaving the side-on
      // and camera-facing extremes untouched. (A panel's broad face is
      // tangential, so it foreshortens on `rd` instead and isn't exaggerated.)
      latHalfExtent =
        type === "fin"
          ? (broad / 2) * ru * ru + (thin / 2) * rd
          : (broad / 2) * rd + (thin / 2) * ru;
    }
  }
  return {
    flightId: part.flightId,
    parentFlightId: part.parentFlightId,
    name: part.name,
    title: part.title,
    type,
    lat: meshLat,
    axial: meshAxial,
    depth: meshDepth,
    rotationRad,
    size,
    latHalfExtent,
    axialHalfExtent: size.y / 2,
    dryMass: part.dryMass,
    stage: part.inverseStage,
    maxTemp: part.maxTemp,
    temperatureK: thermal?.temperatureK,
    maxTemperatureK: thermal?.maxTemperatureK,
    resources: normaliseResources(resources),
    ecFlowSign,
    fuelLineTarget: part.fuelLineTarget ?? null,
    partState: partState?.modules,
  };
}
