import { getDataSource, useDataValue } from "@gonogo/core";
import { logger } from "@gonogo/logger";
import { useEffect, useReducer, useRef } from "react";

// Tagged under `targets` because the user-facing symptom of any breakage
// here surfaces in the TargetPicker bodies tab; flip
// `localStorage.LOG_LEVEL = 'debug'` to see the diagnostic stream.
const log = logger.tag("targets");

/**
 * Fan-out subscription to Telemachus's indexed `b.*` bucket.
 *
 * `b.number` gives the total body count. For each integer in [0, b.number)
 * we subscribe to the per-body fields below and stitch them into a
 * `CelestialBody` record. The dashboard's shared Telemachus DS handles the
 * actual WS `+` subscribes; it already supports dynamic subscriptions, we
 * just need to call subscribe() for every key we care about.
 *
 * This is the "special hook pattern" for widgets that need all-of-N data
 * from Telemachus's indexed buckets. Widgets that render a full solar
 * system (SystemView), or a body picker, or a per-body dashboard should
 * use this instead of trying to call useDataValue for each field.
 */

export interface CelestialBody {
  index: number;
  name: string | null;
  referenceBody: string | null;
  radius: number | null;
  soi: number | null;
  hasAtmosphere: boolean | null;
  maxAtmosphere: number | null;
  semiMajorAxis: number | null;
  eccentricity: number | null;
  inclination: number | null;
  period: number | null;
  lan: number | null;
  argumentOfPeriapsis: number | null;
  trueAnomaly: number | null;
  // Almanac fields — unused by the orbit math, surfaced in the side panel.
  mass: number | null;
  geeASL: number | null;
  rotationPeriod: number | null;
  tidallyLocked: boolean | null;
  hasOxygen: boolean | null;
  hasOcean: boolean | null;
}

const BODY_FIELDS = [
  ["name", "name"],
  ["referenceBody", "referenceBody"],
  ["radius", "radius"],
  ["soi", "soi"],
  ["hasAtmosphere", "atmosphere"],
  ["maxAtmosphere", "maxAtmosphere"],
  ["semiMajorAxis", "o.sma"],
  ["eccentricity", "o.eccentricity"],
  ["inclination", "o.inclination"],
  ["period", "o.period"],
  ["lan", "o.lan"],
  ["argumentOfPeriapsis", "o.argumentOfPeriapsis"],
  ["trueAnomaly", "o.trueAnomaly"],
  ["mass", "mass"],
  ["geeASL", "geeASL"],
  ["rotationPeriod", "rotationPeriod"],
  ["tidallyLocked", "tidallyLocked"],
  ["hasOxygen", "atmosphereContainsOxygen"],
  ["hasOcean", "ocean"],
] as const satisfies ReadonlyArray<readonly [keyof CelestialBody, string]>;

function telemachusKey(field: string, index: number): string {
  return `b.${field}[${index}]`;
}

/**
 * Returns a list of body records with whatever data has streamed in so
 * far. Missing fields are null until Telemachus delivers them (first
 * sample typically lands within a few hundred ms of subscribe).
 *
 * The hook uses a ref-backed value map + `useReducer` bump so high-
 * frequency updates don't churn React state; the derived array is
 * rebuilt on each render (cheap — Kerbol has ~16 bodies).
 */
export function useCelestialBodies(sourceId = "data"): CelestialBody[] {
  const countRaw = useDataValue(sourceId, "b.number");
  const count = typeof countRaw === "number" ? countRaw : 0;
  const valuesRef = useRef<Map<string, unknown>>(new Map());
  const summaryRef = useRef<string>("");
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (count <= 0) {
      log.debug("count not yet positive; skipping subscribe", {
        sourceId,
        countRaw: count,
      });
      return;
    }
    const source = getDataSource(sourceId);
    if (!source) {
      // Real error — keep at warn so it surfaces without enabling debug.
      log.warn("data source not registered; cannot subscribe", { sourceId });
      return;
    }

    // Reset the cache when the count changes — stale entries from a
    // previous, larger N would otherwise linger.
    valuesRef.current = new Map();
    bump();

    log.debug("subscribing to body fields", {
      sourceId,
      bodyCount: count,
      fieldsPerBody: BODY_FIELDS.length,
      totalKeys: count * BODY_FIELDS.length,
    });

    const seen = new Set<string>();
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < count; i++) {
      for (const [, telemKey] of BODY_FIELDS) {
        const key = telemachusKey(telemKey, i);
        unsubs.push(
          source.subscribe(key, (value) => {
            if (!seen.has(key)) {
              seen.add(key);
              log.debug("first value for key", {
                key,
                value,
                seenSoFar: seen.size,
                expected: count * BODY_FIELDS.length,
              });
            }
            valuesRef.current.set(key, value);
            bump();
          }),
        );
      }
    }
    return () => {
      log.debug("unsubscribing body fields", {
        sourceId,
        bodyCount: count,
        seenKeys: seen.size,
      });
      for (const u of unsubs) u();
    };
  }, [count, sourceId]);

  const bodies: CelestialBody[] = [];
  for (let i = 0; i < count; i++) {
    const body: CelestialBody = {
      index: i,
      name: null,
      referenceBody: null,
      radius: null,
      soi: null,
      hasAtmosphere: null,
      maxAtmosphere: null,
      semiMajorAxis: null,
      eccentricity: null,
      inclination: null,
      period: null,
      lan: null,
      argumentOfPeriapsis: null,
      trueAnomaly: null,
      mass: null,
      geeASL: null,
      rotationPeriod: null,
      tidallyLocked: null,
      hasOxygen: null,
      hasOcean: null,
    };
    for (const [localField, telemKey] of BODY_FIELDS) {
      const raw = valuesRef.current.get(telemachusKey(telemKey, i));
      if (raw === undefined) continue;
      if (
        localField === "hasAtmosphere" ||
        localField === "tidallyLocked" ||
        localField === "hasOxygen" ||
        localField === "hasOcean"
      ) {
        body[localField] = typeof raw === "boolean" ? raw : null;
      } else if (localField === "name" || localField === "referenceBody") {
        // Telemachus emits the star's referenceBody as the empty string,
        // not as a missing field. Coerce to null so consumers can treat
        // "no parent" as a single state — otherwise tree-walks that key
        // off `referenceBody === null` skip the root and render nothing.
        const s = typeof raw === "string" ? raw : null;
        body[localField] = s === "" ? null : s;
      } else {
        body[localField] =
          typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      }
    }
    bodies.push(body);
  }

  // Summary log on meaningful changes only — render-frequency, but
  // gated by a ref so we don't spam the console every tick.
  const named = bodies.filter((b) => b.name !== null).length;
  const withRef = bodies.filter((b) => b.referenceBody !== null).length;
  const sig = `${bodies.length}|${named}|${withRef}`;
  if (summaryRef.current !== sig) {
    summaryRef.current = sig;
    log.debug("body data summary", {
      bodyCount: bodies.length,
      withName: named,
      withReferenceBody: withRef,
      names: bodies.map((b) => b.name).filter((n) => n !== null),
      referenceBodies: bodies
        .map((b) => b.referenceBody)
        .filter((r) => r !== null),
    });
  }

  return bodies;
}
