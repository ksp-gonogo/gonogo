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
 * correction, the imaging-altitude window, and the exponential atmosphere
 * model that no `AtmosphereEntry` carries a scale height for. Those pass
 * straight through. One authority for the physics, with a named second-best
 * behind it for a stream too old to report a field.</p>
 */

import type { BodyDefinition } from "@ksp-gonogo/core";
import { getBody } from "@ksp-gonogo/core";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
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
 */
export function parentBodyFromTopics(
  topics: Readonly<Record<string, unknown>>,
): StreamBody | undefined {
  const identity = topics["vessel.identity"] as
    | { parentBodyIndex?: number | null }
    | undefined;
  const bodies = topics["system.bodies"] as StreamBodies | undefined;
  return bodyAtIndex(bodies, identity?.parentBodyIndex);
}
