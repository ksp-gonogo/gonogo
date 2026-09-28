import {
  getBody,
  predictGroundTrack,
  registerStockBodies,
  wrap180,
} from "@ksp-gonogo/core";
import { geoFromInertial, patchStateAt } from "@ksp-gonogo/sitrep-client";
import {
  type OrbitPatch,
  TransitionType,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Whether each MapView fixture describes a scene that can exist. The map
 * draws on a canvas, so a DOM snapshot carries only a segment count, which is
 * the same for an equatorial track and a polar one. This re-propagates each
 * fixture's own elements with the widget's `patchStateAt`/`predictGroundTrack`
 * and checks the answer is the position the fixture claims.
 */

interface WirePatch {
  sma: number;
  ecc: number;
  inc: number;
  lan: number;
  argPe: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  period: number;
  startUt: number;
  endUt: number;
  peA: number;
  apA: number;
  semiLatusRectum: number;
  semiMinorAxis: number;
  referenceBody: string;
  mu: number;
}

interface WireOrbit {
  sma: number;
  ecc: number;
  inc: number;
  lan: number;
  argPe: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
  patches?: WirePatch[];
}

interface WireFlight {
  latitude: number;
  longitude: number;
  altitudeAsl: number;
  surfaceSpeed: number;
  verticalSpeed: number;
}

interface Fixture {
  _stream?: {
    stopsArriving?: boolean;
    pinnedUt?: number;
    emits?: Array<{
      channel?: string;
      value?: Record<string, unknown>;
      meta?: { validAt?: number };
    }>;
  };
}

const MODULES = import.meta.glob<{ default: Fixture }>(
  "./__fixtures__/*.json",
  { eager: true },
);

interface WireManeuver {
  nodes?: Array<{ ut: number; patches?: WirePatch[] }>;
}

interface Scene {
  slug: string;
  ut: number;
  orbit: WireOrbit;
  patches: WirePatch[];
  flight: WireFlight;
  bodyName: string;
  bodyRadius: number;
  /** The planned burns, which are half of what a map scene shows. */
  maneuver: WireManeuver | undefined;
}

const scenes: Scene[] = [];
for (const [path, mod] of Object.entries(MODULES)) {
  // A stale twin is its live twin's scene staged later, judged by `staleScenes.test.tsx`.
  if (path.endsWith("-stopped-arriving.json")) continue;
  const emits = mod.default._stream?.emits;
  const ut = mod.default._stream?.pinnedUt;
  if (!emits || ut === undefined) continue;
  const orbit = emits.find((e) => e.channel === "vessel.orbit")?.value as
    | WireOrbit
    | undefined;
  /*
   * The newest flight sample and the instant it was taken, from the same emit:
   * a scene whose link is down pins the view past its last sample, and at
   * 210 m/s a few seconds is hundreds of metres.
   */
  const flightEmit = [...emits]
    .filter((e) => e.channel === "vessel.flight")
    .sort((a, b) => (a.meta?.validAt ?? ut) - (b.meta?.validAt ?? ut))
    .at(-1);
  const flight = flightEmit?.value as WireFlight | undefined;
  const flightUt = flightEmit?.meta?.validAt ?? ut;
  const bodies = emits.find((e) => e.channel === "system.bodies")?.value as
    | { bodies?: Array<{ name: string; radius: number }> }
    | undefined;
  const first = bodies?.bodies?.[0];
  if (!orbit || !flight || !first) continue;
  scenes.push({
    slug: path.replace("./__fixtures__/", "").replace(/\.json$/, ""),
    ut: flightUt,
    orbit,
    patches: orbit.patches ?? [],
    flight,
    bodyName: first.name,
    bodyRadius: first.radius,
    maneuver: emits.find((e) => e.channel === "vessel.maneuver")?.value as
      | WireManeuver
      | undefined,
  });
}

const DEG = Math.PI / 180;
const round = (x: number): number => Number(x.toPrecision(6));
const periodOf = (sma: number, mu: number): number =>
  2 * Math.PI * Math.sqrt(sma ** 3 / mu);

/** A fixture's patch as the stream decodes it, units attached. */
function decoded(p: WirePatch): OrbitPatch {
  return wrapTypePayload<OrbitPatch>("OrbitPatch", {
    ...p,
    patchStartTransition: TransitionType.Initial,
    patchEndTransition: TransitionType.Final,
  });
}

/** The top-level elements as a patch, for the fixture that carries no chain. */
function orbitAsPatch(s: Scene, radius: number, mu: number): WirePatch {
  const { sma, ecc } = s.orbit;
  return {
    ...s.orbit,
    period: periodOf(sma, mu),
    startUt: s.ut,
    endUt: s.ut + periodOf(sma, mu),
    peA: sma * (1 - ecc) - radius,
    apA: sma * (1 + ecc) - radius,
    semiLatusRectum: sma * (1 - ecc ** 2),
    semiMinorAxis: sma * Math.sqrt(1 - ecc ** 2),
    referenceBody: s.bodyName,
  };
}

/**
 * The elements without the epoch and patch window, which move with the
 * fixture's own UT. The planned burns are included: `kerbin-plane-change-node`
 * is `kerbin-lko-equator` plus a node, and the burn is the only difference.
 */
function elementFingerprint(s: Scene): string {
  return JSON.stringify([
    s.orbit.sma,
    s.orbit.ecc,
    s.orbit.inc,
    s.orbit.lan,
    s.orbit.argPe,
    s.orbit.mu,
    s.bodyName,
    (s.maneuver?.nodes ?? []).map((n) => [
      n.ut,
      (n.patches ?? []).map((p) => [p.sma, p.ecc, p.inc, p.lan, p.argPe]),
    ]),
  ]);
}

/** The registered body, with `gm` asserted present: the arithmetic needs it, so a body stating none fails the fixture. */
function bodyOf(name: string) {
  const b = getBody(name);
  if (!b) throw new Error(`no registered body ${name}`);
  const { gm } = b;
  if (gm === undefined) throw new Error(`registered body ${name} states no gm`);
  return { ...b, gm };
}

beforeAll(() => {
  registerStockBodies();
});

describe("MapView fixtures describe scenes that can exist", () => {
  it("found the fixtures to check, so an empty sweep cannot read as a clean one", () => {
    expect(scenes.map((s) => s.slug).sort()).toEqual([
      "kerbin-launchpad",
      "kerbin-lko-equator",
      "kerbin-mun-encounter",
      "kerbin-plane-change-node",
      "kerbin-reentry",
      "kerbin-reentry-held",
      "mun-polar-orbit",
    ]);
  });

  it("gives each scenario its own scene, so a name is a picture", () => {
    const byFingerprint = new Map<string, string[]>();
    for (const s of scenes) {
      const key = elementFingerprint(s);
      byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), s.slug]);
    }
    expect([...byFingerprint.values()].filter((v) => v.length > 1)).toEqual([]);
  });

  for (const s of scenes) {
    describe(s.slug, () => {
      it("orbits the body it names, with that body's own radius and mu", () => {
        const b = bodyOf(s.bodyName);
        expect({ radius: s.bodyRadius, mu: s.orbit.mu }).toEqual({
          radius: b.radius,
          mu: b.gm,
        });
        for (const p of s.patches) {
          expect({ referenceBody: p.referenceBody, mu: p.mu }).toEqual({
            referenceBody: s.bodyName,
            mu: b.gm,
          });
        }
      });

      it("carries apsides, period and conic scalars that follow from its own sma and ecc", () => {
        const b = bodyOf(s.bodyName);
        for (const p of s.patches) {
          expect({
            peA: round(p.peA),
            apA: round(p.apA),
            semiLatusRectum: round(p.semiLatusRectum),
            semiMinorAxis: round(p.semiMinorAxis),
            period: round(p.period),
          }).toEqual({
            peA: round(p.sma * (1 - p.ecc) - b.radius),
            apA: round(p.sma * (1 + p.ecc) - b.radius),
            semiLatusRectum: round(p.sma * (1 - p.ecc ** 2)),
            semiMinorAxis: round(p.sma * Math.sqrt(1 - p.ecc ** 2)),
            period: round(periodOf(p.sma, b.gm)),
          });
          // The chain and the summary elements are one conic, not two.
          expect({ sma: p.sma, ecc: p.ecc, inc: p.inc }).toEqual({
            sma: s.orbit.sma,
            ecc: s.orbit.ecc,
            inc: s.orbit.inc,
          });
        }
      });

      it("puts the vessel where the marker says it is when its own elements are propagated", () => {
        const b = bodyOf(s.bodyName);
        const patch = decoded(s.patches[0] ?? orbitAsPatch(s, b.radius, b.gm));
        const g = geoFromInertial(patchStateAt(patch, s.ut), b.radius);
        // A tenth of a degree is finer than the map draws and survives the fixtures' rounded decimals.
        expect(g.lat).toBeCloseTo(s.flight.latitude, 1);
        expect(g.alt / 1000).toBeCloseTo(s.flight.altitudeAsl / 1000, 2);
      });

      it("reaches its own latitude, rather than claiming one its inclination forbids", () => {
        const inc = s.patches[0]?.inc ?? s.orbit.inc;
        expect(Math.abs(Math.sin(s.flight.latitude * DEG))).toBeLessThanOrEqual(
          Math.abs(Math.sin(inc * DEG)) + 1e-6,
        );
      });

      if (s.patches.length > 0) {
        it("draws a predicted track that starts at the vessel marker", () => {
          const b = bodyOf(s.bodyName);
          const samples = predictGroundTrack(
            s.patches.map(decoded),
            s.bodyName,
            b.radius,
            b.rotationPeriod ?? 0,
            { ut: s.ut, lat: s.flight.latitude, lon: s.flight.longitude },
            Math.min(1.5 * s.patches[0].period, 21600),
            10,
          );
          expect(samples.length).toBeGreaterThan(0);
          expect(samples[0].lat).toBeCloseTo(s.flight.latitude, 1);
          expect(wrap180(samples[0].lon - s.flight.longitude)).toBeCloseTo(
            0,
            1,
          );
        });
      }
    });
  }

  it("mun-polar-orbit is polar, and its track visits latitudes an equatorial one cannot", () => {
    const mun = scenes.find((s) => s.slug === "mun-polar-orbit");
    if (!mun) throw new Error("mun-polar-orbit missing");
    const inc = mun.patches[0]?.inc;
    expect(inc).toBeGreaterThan(80);
    expect(inc).toBeLessThan(100);
    const b = bodyOf("Mun");
    const samples = predictGroundTrack(
      mun.patches.map(decoded),
      "Mun",
      b.radius,
      b.rotationPeriod ?? 0,
      { ut: mun.ut, lat: mun.flight.latitude, lon: mun.flight.longitude },
      1.5 * mun.patches[0].period,
      10,
    );
    expect(Math.max(...samples.map((x) => Math.abs(x.lat)))).toBeGreaterThan(
      80,
    );
  });

  it("kerbin-launchpad is on the launchpad, not in orbit", () => {
    const pad = scenes.find((s) => s.slug === "kerbin-launchpad");
    if (!pad) throw new Error("kerbin-launchpad missing");
    const b = bodyOf("Kerbin");
    expect(pad.flight.altitudeAsl).toBeLessThan(1000);
    expect(pad.flight.surfaceSpeed).toBe(0);
    expect(pad.flight.verticalSpeed).toBe(0);
    // Co-rotating, not orbiting: periapsis is inside the planet, so there is no forward ground track.
    expect(pad.orbit.sma * (1 - pad.orbit.ecc) - b.radius).toBeLessThan(0);
    expect(pad.orbit.sma * (1 + pad.orbit.ecc) - b.radius).toBeCloseTo(
      pad.flight.altitudeAsl,
      0,
    );
    expect(pad.patches).toEqual([]);
  });
});
