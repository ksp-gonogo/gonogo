import type { PartResources, TopologyPart } from "@ksp-gonogo/core";
import { KspPartCategory } from "@ksp-gonogo/sitrep-sdk";
import type { PartType } from "./shipTopology";

/**
 * Classify a part into one of the diagram's coarse `PartType` buckets. Module
 * names first, SolidFuel telling boosters from engines, then KSP's category,
 * then a name/title heuristic. `resources` is optional because it arrives
 * after the topology snapshot.
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
  // Cargo bays carry ModuleLiftingSurface for body lift but are boxes, not wings.
  const hasCargoBay = modules.some((m) => m.includes("CargoBay"));
  const hasWheel = modules.some((m) => m.includes("ModuleWheelBase"));
  const isFuelLine = modules.some((m) => m.includes("CModuleFuelLine"));

  const hasSolidFuel =
    !!resources &&
    Object.hasOwn(resources, "SolidFuel") &&
    (resources.SolidFuel?.maxAmount ?? 0) > 0;
  const hasAnyResource = resources && Object.keys(resources).length > 0;

  // Nose cones share the Aero category with wings but not the shape, and have no dedicated module.
  const isNoseCone = part.name.toLowerCase().includes("nose");

  if (hasEngine && hasSolidFuel) return "booster";
  if (hasEngine) return "engine";
  if (hasWheel) return "wheel";
  // Fuel-line bounds wrap the whole conduit run, so they bail out before the resource-based tank fallback.
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
 * KSP's `PartCategories` ordinal to a diagram glyph, switched on the ordinal
 * rather than KSP's spelling. Null (no ordinal, no distinct glyph, or a newer
 * category) falls through to the name heuristic; `Propulsion`, `Payload`,
 * `Cargo`, `Robotics` and `none` are left to it deliberately.
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
