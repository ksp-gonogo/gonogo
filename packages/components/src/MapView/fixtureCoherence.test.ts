import {
  geoFromInertial,
  getBody,
  type OrbitPatch,
  patchStateAt,
  predictGroundTrack,
  registerStockBodies,
  wrap180,
} from "@ksp-gonogo/core";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Whether each MapView fixture describes a scene that can exist.
 *
 * The DOM snapshots cannot answer this and never could. Everything the map
 * draws goes onto a `<canvas>`, so the only orbit-shaped thing the committed
 * HTML carries is a segment count, and a segment count is the same number for
 * an equatorial track and a polar one. Four fixtures shared one pasted
 * `vessel.orbit` (sma 700000, ecc 0.1, inc 0, and Kerbin's mu even on the Mun)
 * and every snapshot, a11y sweep and prediction check passed on all four: a
 * craft on the launchpad carried a 30x170 km orbit, `mun-polar-orbit` was
 * equatorial, and its ground track ran 65 degrees of latitude away from its own
 * vessel marker.
 *
 * So this reads the numbers rather than the render. It re-propagates each
 * fixture's own elements with the same `patchStateAt`/`predictGroundTrack` the
 * widget uses and asks whether the answer is the position the fixture claims,
 * which is the one question that separates the four scenarios.
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
    pinnedUt?: number;
    emits?: Array<{ channel?: string; value?: Record<string, unknown> }>;
  };
}

const MODULES = import.meta.glob<{ default: Fixture }>(
  "./__fixtures__/*.json",
  { eager: true },
);

interface Scene {
  slug: string;
  ut: number;
  orbit: WireOrbit;
  patches: WirePatch[];
  flight: WireFlight;
  bodyName: string;
  bodyRadius: number;
}

const scenes: Scene[] = [];
for (const [path, mod] of Object.entries(MODULES)) {
  const emits = mod.default._stream?.emits;
  const ut = mod.default._stream?.pinnedUt;
  if (!emits || ut === undefined) continue;
  const orbit = emits.find((e) => e.channel === "vessel.orbit")?.value as
    | WireOrbit
    | undefined;
  const flight = emits.find((e) => e.channel === "vessel.flight")?.value as
    | WireFlight
    | undefined;
  const bodies = emits.find((e) => e.channel === "system.bodies")?.value as
    | { bodies?: Array<{ name: string; radius: number }> }
    | undefined;
  const first = bodies?.bodies?.[0];
  if (!orbit || !flight || !first) continue;
  scenes.push({
    slug: path.replace("./__fixtures__/", "").replace(/\.json$/, ""),
    ut,
    orbit,
    patches: orbit.patches ?? [],
    flight,
    bodyName: first.name,
    bodyRadius: first.radius,
  });
}

const DEG = Math.PI / 180;
const round = (x: number): number => Number(x.toPrecision(6));
const periodOf = (sma: number, mu: number): number =>
  2 * Math.PI * Math.sqrt(sma ** 3 / mu);

/** The legacy shape `patchStateAt` consumes, off the wire shape a fixture carries. */
function toLegacy(p: WirePatch): OrbitPatch {
  return {
    startUT: p.startUt,
    endUT: p.endUt,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: p.peA,
    ApA: p.apA,
    inclination: p.inc,
    eccentricity: p.ecc,
    epoch: p.epoch,
    period: p.period,
    argumentOfPeriapsis: p.argPe,
    sma: p.sma,
    lan: p.lan,
    maae: p.meanAnomalyAtEpoch,
    referenceBody: p.referenceBody,
    semiLatusRectum: p.semiLatusRectum,
    semiMinorAxis: p.semiMinorAxis,
    closestEncounterBody: null,
  };
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
 * The elements without the bookkeeping that varies between two copies of one
 * pasted orbit: epoch and the patch window move with the fixture's own UT, so
 * comparing those would call two identical orbits different.
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
  ]);
}

function bodyOf(name: string) {
  const b = getBody(name);
  if (!b) throw new Error(`no registered body ${name}`);
  return b;
}

beforeAll(() => {
  registerStockBodies();
});

describe("MapView fixtures describe scenes that can exist", () => {
  it("found the fixtures to check, so an empty sweep cannot read as a clean one", () => {
    expect(scenes.map((s) => s.slug).sort()).toEqual([
      "kerbin-launchpad",
      "kerbin-lko-equator",
      "kerbin-reentry",
      "mun-polar-orbit",
    ]);
  });

  it("gives each scenario its own orbit, so four names are four pictures", () => {
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
        const patch = toLegacy(s.patches[0] ?? orbitAsPatch(s, b.radius, b.gm));
        const g = geoFromInertial(patchStateAt(patch, s.ut), b.radius);
        // A tenth of a degree is finer than the map can draw, and coarse enough
        // to survive the fixtures' rounded decimals.
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
          const patches = s.patches.map(toLegacy);
          const samples = predictGroundTrack(
            patches,
            s.bodyName,
            b.radius,
            b.rotationPeriod ?? 0,
            { ut: s.ut, lat: s.flight.latitude, lon: s.flight.longitude },
            Math.min(1.5 * patches[0].period, 21600),
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
      mun.patches.map(toLegacy),
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
    // Co-rotating rather than orbiting: apoapsis is the pad's own altitude and
    // periapsis is deep inside the planet, which is why there is no forward
    // ground track to draw.
    expect(pad.orbit.sma * (1 - pad.orbit.ecc) - b.radius).toBeLessThan(0);
    expect(pad.orbit.sma * (1 + pad.orbit.ecc) - b.radius).toBeCloseTo(
      pad.flight.altitudeAsl,
      0,
    );
    expect(pad.patches).toEqual([]);
  });
});
