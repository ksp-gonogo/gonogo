import { getDataSource, useDataValue } from "@gonogo/core";
import { useEffect, useReducer, useRef } from "react";

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
  trueAnomaly: number | null;
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
  ["trueAnomaly", "o.trueAnomaly"],
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
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (count <= 0) return;
    const source = getDataSource(sourceId);
    if (!source) return;

    // Reset the cache when the count changes — stale entries from a
    // previous, larger N would otherwise linger.
    valuesRef.current = new Map();
    bump();

    const unsubs: Array<() => void> = [];
    for (let i = 0; i < count; i++) {
      for (const [, telemKey] of BODY_FIELDS) {
        const key = telemachusKey(telemKey, i);
        unsubs.push(
          source.subscribe(key, (value) => {
            valuesRef.current.set(key, value);
            bump();
          }),
        );
      }
    }
    return () => {
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
      trueAnomaly: null,
    };
    for (const [localField, telemKey] of BODY_FIELDS) {
      const raw = valuesRef.current.get(telemachusKey(telemKey, i));
      if (raw === undefined) continue;
      if (localField === "hasAtmosphere") {
        body.hasAtmosphere = typeof raw === "boolean" ? raw : null;
      } else if (localField === "name" || localField === "referenceBody") {
        body[localField] = typeof raw === "string" ? raw : null;
      } else {
        body[localField] =
          typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      }
    }
    bodies.push(body);
  }
  return bodies;
}
