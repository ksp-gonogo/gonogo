/**
 * The body a widget draws against: physics from `system.bodies`, keyed by an
 * index a planet pack does not change, and the stock name-keyed table only for
 * presentation and for a field the stream does not report.
 */

import type { BodyDefinition, PressureProfile } from "@ksp-gonogo/core";
import { getBody } from "@ksp-gonogo/core";
import type { DepTopics, Value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, type Quantityish } from "@ksp-gonogo/ui-kit";

/** A `BodyDefinition` plus the reported facts the static table has no field for. */
export type StreamBody = BodyDefinition & {
  /** Surface gravity in m/s2 as reported, never rebuilt from mu over r squared. */
  surfaceGravity?: number;
  /** Breathable air: the stream's flag, or the stock fallback below it. */
  hasOxygen?: boolean;
  /**
   * The game's own sampled pressure profile. Kept beside the table's
   * exponential `atmosphere` rather than replacing it, so a caller can tell
   * which authority spoke.
   */
  pressureProfile?: PressureProfile;
};

/**
 * The atmosphere block as `system.bodies` reports it: `null` means airless,
 * while an absent key means a stream that does not report atmospheres.
 */
export interface StreamAtmosphere {
  depth?: Quantityish;
  hasOxygen?: boolean | null;
  /** Metres above sea level, ascending, paired with `pressures`. */
  pressureAltitudes?: readonly Quantityish[] | null;
  /** Pressure in kPa at each `pressureAltitudes` entry, as the game answers it. */
  pressures?: readonly Value<"kPa">[] | null;
}

/** The fields of a `system.bodies` entry that describe the body physically. */
export interface StreamBodyFacts {
  index?: number;
  name?: string | null;
  radius?: Quantityish;
  gravParameter?: Quantityish;
  rotationPeriod?: Quantityish;
  /** Reported in g, which is how the game holds it. */
  surfaceGravity?: Value<"g"> | null;
  atmosphere?: StreamAtmosphere | null;
}

/** Breathable stock bodies, for a stream that omits the flag: `false` would claim the air is unbreathable. */
const STOCK_OXYGEN: ReadonlySet<string> = new Set(["Kerbin", "Laythe"]);

function stockOxygen(name: string | null | undefined): boolean {
  return name != null && STOCK_OXYGEN.has(name);
}

function reported(q: Quantityish): number | undefined {
  return magnitudeOf(q) ?? undefined;
}

function surfaceGravityMps2(g: Value<"g"> | null | undefined) {
  return g == null ? undefined : reported(g.in("m/s²"));
}

/** The profile in metres and pascals, all or nothing: half a profile pairs pressures with the wrong altitudes. */
function pressureProfile(
  atmosphere: StreamAtmosphere | null | undefined,
): PressureProfile | undefined {
  const rawAltitudes = atmosphere?.pressureAltitudes;
  const rawPressures = atmosphere?.pressures;
  if (!rawAltitudes || !rawPressures) return undefined;
  if (rawAltitudes.length === 0) return undefined;
  if (rawAltitudes.length !== rawPressures.length) return undefined;

  const altitudes: number[] = [];
  const pressures: number[] = [];
  for (let i = 0; i < rawAltitudes.length; i++) {
    const altitude = reported(rawAltitudes[i]);
    const pressure = reported(rawPressures[i].in("Pa"));
    if (altitude === undefined || pressure === undefined) return undefined;
    altitudes.push(altitude);
    pressures.push(pressure);
  }
  return { altitudes, pressures };
}

/** Merges a `system.bodies` entry over its table namesake; `undefined` when neither source knows the body's radius. */
export function bodyFromStream(
  facts: StreamBodyFacts | null | undefined,
): StreamBody | undefined {
  const table = facts?.name ? getBody(facts.name) : undefined;
  if (!facts) return table;

  const radius = reported(facts.radius) ?? table?.radius;
  if (radius === undefined) return table;

  // An absent atmosphere block defers to the table; an explicit null is a claim of vacuum.
  const hasAtmosphere =
    facts.atmosphere === undefined
      ? (table?.hasAtmosphere ?? false)
      : facts.atmosphere !== null;
  const depth = facts.atmosphere ? reported(facts.atmosphere.depth) : undefined;

  return {
    ...table,
    id: table?.id ?? facts.name ?? "",
    name: table?.name ?? facts.name ?? "",
    radius,
    gm: reported(facts.gravParameter) ?? table?.gm,
    rotationPeriod: reported(facts.rotationPeriod) ?? table?.rotationPeriod,
    surfaceGravity: surfaceGravityMps2(facts.surfaceGravity),
    hasAtmosphere,
    maxAtmosphere: hasAtmosphere ? (depth ?? table?.maxAtmosphere ?? 0) : 0,
    hasOxygen: hasAtmosphere
      ? (facts.atmosphere?.hasOxygen ?? stockOxygen(facts.name ?? table?.id))
      : false,
    pressureProfile: hasAtmosphere
      ? pressureProfile(facts.atmosphere)
      : undefined,
  };
}

/** A `system.bodies` payload, as much of it as this resolution needs. */
export interface StreamBodies {
  bodies: readonly StreamBodyFacts[];
}

/** The entry at a body index, which is stable across a rename. */
export function bodyAtIndex(
  bodies: StreamBodies | null | undefined,
  index: number | null | undefined,
): StreamBody | undefined {
  if (index == null) return undefined;
  return bodyFromStream(bodies?.bodies.find((b) => b.index === index));
}

/** Matching on name is safe only here, where both names come from the running game. */
export function bodyNamed(
  bodies: StreamBodies | null | undefined,
  name: string | null | undefined,
): StreamBody | undefined {
  if (!name) return undefined;
  const entry = bodies?.bodies.find((b) => b.name === name);
  return entry ? bodyFromStream(entry) : getBody(name);
}

/**
 * The parent body for a contribution, which gets Topic values and no hooks.
 * Typed on the two topics so a caller that did not declare them as `deps`
 * fails to compile.
 */
export function parentBodyFromTopics(
  topics: DepTopics<readonly ["vessel.identity", "system.bodies"]>,
): StreamBody | undefined {
  const identity = topics["vessel.identity"];
  const bodies = topics["system.bodies"];
  return bodyAtIndex(bodies, identity?.parentBodyIndex);
}
