/**
 * The celestial body a widget draws against, taken from the stream first and
 * from the bundled static table only for what the stream does not carry.
 *
 * <p>The static registry is a table of STOCK bodies keyed by NAME, registered
 * at app startup. Under a planet pack the bodies are renamed (RSS calls Kerbin
 * "Earth" and Mun "Moon", which is the system RP-1 is played in), so a
 * name lookup misses, the radius or gravitational parameter comes back
 * undefined, and whatever needed it silently produces nothing: no error, no
 * fallback, just a feature that stops existing. Every physical fact here is
 * already reported per body on `system.bodies`, keyed by the INDEX a pack does
 * not change.</p>
 *
 * <p>What the table is still for is PRESENTATION, which is not on the wire at
 * all: the surface texture, the fallback colour, the map's longitude
 * correction and the imaging-altitude window. Those pass straight through.
 * One authority for the physics, with a named second-best behind it for a
 * stream too old to report a field.</p>
 *
 * <p>Its exponential atmosphere model is the last of the physics still living
 * here, and it is now the second-best rather than the answer: the stream
 * reports the game's own sampled pressure profile, which is what a body using
 * a pressure curve actually follows and what a planet pack's own atmosphere
 * is. The table's `P₀·exp(-h/H)` stays for a stream that reports no
 * profile.</p>
 */

import type { BodyDefinition, PressureProfile } from "@ksp-gonogo/core";
import { getBody } from "@ksp-gonogo/core";
import type { DepTopics, Value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, type Quantityish } from "@ksp-gonogo/ui-kit";

/**
 * A `BodyDefinition` plus the one reported fact it has no field for.
 *
 * <p>Surface gravity rides along rather than being rebuilt as μ/r², because the
 * stream states it and the game holds it that way: reconstructing it runs the
 * game's own arithmetic backwards. `BodyDefinition` is the static registry's
 * own declaration and is not widened for a value the registry never stores.</p>
 */
export type StreamBody = BodyDefinition & {
  /** Surface gravity in m/s², when the stream reported one. */
  surfaceGravity?: number;
  /** Breathable air: the stream's flag, or the stock fallback below it. */
  hasOxygen?: boolean;
  /**
   * The game's own pressure-versus-altitude answer, sampled host-side, when
   * the stream reported it.
   *
   * <p>Rides alongside `BodyDefinition.atmosphere` rather than replacing it,
   * because they are different claims from different authorities: the profile
   * is what `CelestialBody.GetPressure` returned, and `atmosphere` is the
   * bundled table's exponential approximation of a STOCK body. Collapsing them
   * would hide which one spoke, and not being able to tell is how a widget
   * came to draw an exponential over a curve body for a year.</p>
   */
  pressureProfile?: PressureProfile;
};

/**
 * The nested atmosphere block as `system.bodies` reports it.
 *
 * <p>`null` is the host saying AIRLESS, deliberately rather than by omission
 * (`SystemViewProvider.BuildAtmosphere`); the key being absent altogether means
 * a stream that does not report atmospheres, which is the only case the table
 * answers.</p>
 */
export interface StreamAtmosphere {
  depth?: Quantityish;
  /**
   * Whether the air is breathable, which decides how the atmosphere band is
   * shaded. The STATIC registry has no such field, so a widget wanting it used
   * to compare the body's name against the stock oxygen-bearing ones.
   */
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

/**
 * The stock bodies whose air is breathable, for a stream that does not report
 * the flag.
 *
 * <p>Kept as a NAMED second-best rather than deleted with the read it used to
 * back. `hasOxygen` reaches the wire per body, so the stream answers first and
 * a planet pack is served correctly; but a fixture or an older mod that omits
 * the block would otherwise fall to `false`, and false is not "unknown", it is
 * a positive claim that the air cannot be breathed. Drawing Kerbin's sky as
 * inert is a worse answer than the heuristic this replaced.</p>
 */
const STOCK_OXYGEN: ReadonlySet<string> = new Set(["Kerbin", "Laythe"]);

function stockOxygen(name: string | null | undefined): boolean {
  return name != null && STOCK_OXYGEN.has(name);
}

function reported(q: Quantityish): number | undefined {
  return magnitudeOf(q) ?? undefined;
}

/**
 * The reported surface gravity in m/s². The conversion goes through the unit
 * registry rather than a constant multiplied in by hand.
 */
function surfaceGravityMps2(g: Value<"g"> | null | undefined) {
  return g == null ? undefined : reported(g.in("m/s²"));
}

/**
 * The reported pressure profile in metres and pascals, or undefined when the
 * stream carried no usable one.
 *
 * <p>Both arrays or neither, and every entry a number: half a profile is worse
 * than none, because a consumer pairing them by index would read a pressure
 * against the wrong altitude and have no way to notice. The pressures arrive
 * in kPa and go out in pascals, converted through the unit registry rather
 * than by a thousand written down here.</p>
 */
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

/**
 * Merge a `system.bodies` entry over its static-table namesake, if it has one.
 *
 * <p>Returns the table entry alone when there is nothing on the wire to merge,
 * and `undefined` when neither source knows the body: a widget that gates on a
 * radius still gets to say it has no body data rather than draw against a
 * guess.</p>
 */
export function bodyFromStream(
  facts: StreamBodyFacts | null | undefined,
): StreamBody | undefined {
  const table = facts?.name ? getBody(facts.name) : undefined;
  if (!facts) return table;

  const radius = reported(facts.radius) ?? table?.radius;
  if (radius === undefined) return table;

  /*
   * An absent atmosphere block is not a claim of vacuum, so it defers to the
   * table; an explicit null is one, and wins over it.
   */
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

/**
 * The entry at a body INDEX, merged as above. The index is what
 * `vessel.identity.parentBodyIndex` and `vessel.orbit.referenceBodyIndex`
 * carry, and it is stable across a rename.
 */
export function bodyAtIndex(
  bodies: StreamBodies | null | undefined,
  index: number | null | undefined,
): StreamBody | undefined {
  if (index == null) return undefined;
  return bodyFromStream(bodies?.bodies.find((b) => b.index === index));
}

/**
 * The entry the stream itself calls `name`, merged as above.
 *
 * <p>Matching on a name is safe HERE and nowhere else: the names being compared
 * are both the running game's, so a pack that renames a body renames it on both
 * sides. It exists for the one caller that scopes by body rather than by
 * vessel, MapView's body picker, where no index is in hand.</p>
 */
export function bodyNamed(
  bodies: StreamBodies | null | undefined,
  name: string | null | undefined,
): StreamBody | undefined {
  if (!name) return undefined;
  const entry = bodies?.bodies.find((b) => b.name === name);
  return entry ? bodyFromStream(entry) : getBody(name);
}

/**
 * The parent body from the two Topics a CONTRIBUTION is handed.
 *
 * <p>A contribution gets Topic values and nothing else, so it does the
 * index-to-body join itself; `vessel.state.parentBodyRadius` is a derived
 * channel and not a Topic it may depend on.</p>
 *
 * <p>The parameter names the two topics it reads rather than taking an open
 * record, so a caller that did not declare them as `deps` fails here instead of
 * handing this `undefined` twice and getting no body with nothing said.</p>
 */
export function parentBodyFromTopics(
  topics: DepTopics<readonly ["vessel.identity", "system.bodies"]>,
): StreamBody | undefined {
  const identity = topics["vessel.identity"];
  const bodies = topics["system.bodies"];
  return bodyAtIndex(bodies, identity?.parentBodyIndex);
}
