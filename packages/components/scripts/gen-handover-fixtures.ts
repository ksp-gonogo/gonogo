#!/usr/bin/env tsx
/**
 * Write the `LandingStatus/__render_handover__` fixtures: one Kerbin descent,
 * sampled either side of the atmosphere interface.
 *
 * The scene these exist for is the HANDOVER. `vessel.flight` carries TWO
 * forward models of one altitude, selected by `withinAtmosphere`: above the
 * interface a conic advances it, below it `atmospheric-reckoning.ts` integrates
 * the OBSERVED vertical acceleration, and a picture of either regime alone says
 * nothing about the boundary. So every frame here is the same craft on the same
 * trajectory with the same 6-second gap since its last packet, and the only
 * thing that changes down the set is how far it has fallen.
 *
 * ## Generated, and this file is why
 *
 * Every frame has to be internally consistent for the model to run at all: the
 * history's `verticalSpeed` samples must have a least-squares slope that is the
 * acceleration the frame claims, that slope must sit inside
 * `(gravity + gForce * g0) * 1.5`, the gap must sit inside
 * `15 / max(1, gForce)`, and the conic frames need a `meanAnomalyAtEpoch` that
 * actually puts the craft at the stated radius on the DESCENDING branch. Those
 * are five arithmetic constraints per frame across six frames, and a fixture
 * hand-typed against them is a fixture that silently declines for a reason
 * nobody can see in a PNG. Here the arithmetic is the generator's, and
 * `handover-basis.test.tsx` checks the result against the real store rather
 * than trusting either.
 *
 * Run via `pnpm --filter @ksp-gonogo/components gen-handover-fixtures`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../src/LandingStatus/__render_handover__");

/** Kerbin, as `system.bodies` publishes it. */
const KERBIN = {
  radius: 600_000,
  atmosphereDepth: 70_000,
  mu: 3.5316e12,
} as const;

/** `atmospheric-reckoning.ts`'s own `STANDARD_GRAVITY`. */
const G0 = 9.80665;
/** `ATMOS_HORIZON_SECONDS`, the ceiling `gForce` closes. */
const HORIZON_CEILING = 15;
/** `SENSED_ENVELOPE_SLACK`. */
const ENVELOPE_SLACK = 1.5;

/**
 * How long since the craft's last packet, on every frame in the set.
 *
 * One number across the whole set on purpose: the set is a controlled
 * comparison, and a gap that moved with the altitude would leave the model
 * change and the elapsed time confounded. Six seconds is inside every frame's
 * own horizon except `05-peak-deceleration`, which is the frame that exists to
 * be outside it.
 */
const GAP_SECONDS = 6;

/** UT of the newest observation in every frame. */
const ANCHOR_UT = 1_000;

interface Frame {
  slug: string;
  /** Metres above sea level at {@link ANCHOR_UT}. */
  altitudeAsl: number;
  /** Metres per second at the anchor, signed: negative is descending. */
  verticalSpeed: number;
  /** Total vertical acceleration in m/s², the slope the history must produce. */
  verticalAcceleration: number;
  /** Multiples of standard gravity, SENSED (non-gravitational). */
  gForce: number;
  atmDensity: number;
  mach: number;
  /**
   * The mod's own terminal-velocity model for this frame, where the air is
   * doing enough for it to have one.
   *
   * `vessel.landing` is a SEPARATE topic with no reckoner, so nothing here is
   * carried forward; it is on the fixtures because without it the board draws
   * almost nothing at low altitude and the set becomes seven pictures of an
   * empty instrument. Omitted on the frames where the density is negligible,
   * which is what the mod does there.
   */
  landing?: Record<string, unknown>;
  /** Which model the selector should hand this frame to. */
  expect: "kepler-propagation" | "rate-integration" | "declined";
  /**
   * For a `declined` frame, the `reason` and `input` the withdrawal must carry.
   *
   * Required rather than optional because the set now holds TWO withdrawals and
   * they are not the same event: one is this model's horizon closing under
   * sensed deceleration, the other is the crossing band where neither model
   * answers. A test asserting only "no model" would pass on either and so could
   * not tell them apart.
   */
  decline?: { reason: string; input: string };
  note: string;
}

/**
 * One descent, six readings of it. Altitudes descend through 70 km, which is
 * where the selector changes hands.
 */
const FRAMES: Frame[] = [
  {
    slug: "01-above-interface-95km",
    altitudeAsl: 95_000,
    verticalSpeed: -210,
    verticalAcceleration: -8.0,
    gForce: 0.01,
    atmDensity: 0,
    mach: 0,
    expect: "kepler-propagation",
    note: "Vacuum, 25 km above the interface. Nothing is decelerating the craft and the conic owns the frame.",
  },
  {
    slug: "02-above-interface-78km",
    altitudeAsl: 78_000,
    verticalSpeed: -330,
    verticalAcceleration: -8.0,
    gForce: 0.02,
    atmDensity: 0.000_002,
    mach: 1.0,
    expect: "kepler-propagation",
    note: "Eight kilometres above the interface, and still far enough above it that the conic's own solution at the view time has not crossed. The last clean conic frame of the descent.",
  },
  {
    slug: "03-crossing-band-72km",
    altitudeAsl: 72_000,
    verticalSpeed: -400,
    verticalAcceleration: -7.9,
    gForce: 0.03,
    atmDensity: 0.000_01,
    mach: 1.2,
    expect: "declined",
    decline: { reason: "beyond-horizon", input: "@system.bodies" },
    note: "THE CROSSING BAND, and it is a hole neither model fills. The selector asks withinAtmosphere of the OBSERVED altitude, which is 2 km above the interface, so the frame goes to the conic; the conic's floor asks about the radius it SOLVES for at the view time, which is already below the interface because the craft fell 2.4 km during the gap. So the conic withdraws and the rate integration is never asked, and what an operator is told during a reentry is the conic's own sentence about drag it does not model.",
  },
  {
    slug: "04-just-inside-68km",
    altitudeAsl: 68_000,
    verticalSpeed: -430,
    verticalAcceleration: -7.4,
    gForce: 0.06,
    atmDensity: 0.000_04,
    mach: 1.3,
    expect: "rate-integration",
    note: "Two kilometres INSIDE the interface, out the far side of the crossing band. The conic has stood down and the rate integration has taken over; the craft is still accelerating downwards, so this carries a value the conic would have refused outright.",
  },
  {
    slug: "05-drag-biting-42km",
    landing: {
      outcome: "atmosphere-modelled",
      sampleSource: null,
      terminalVelocity: 240,
      projectedTouchdownSpeed: 110,
      atmosphericTimeToImpact: 96,
      descentRegime: "decelerating",
      parachuteState: "stowed",
      dragToWeightRatio: 1.66,
    },
    altitudeAsl: 42_000,
    verticalSpeed: -690,
    verticalAcceleration: 6.5,
    gForce: 1.45,
    atmDensity: 0.004,
    mach: 2.3,
    expect: "rate-integration",
    note: "Drag has taken hold: the observed vertical acceleration has changed SIGN, which is the whole reason this model reads the record rather than a drag coefficient.",
  },
  {
    slug: "06-peak-deceleration-30km",
    landing: {
      outcome: "atmosphere-modelled",
      sampleSource: null,
      terminalVelocity: 128,
      projectedTouchdownSpeed: 98,
      atmosphericTimeToImpact: 71,
      descentRegime: "decelerating",
      parachuteState: "stowed",
      dragToWeightRatio: 3.45,
    },
    altitudeAsl: 30_000,
    verticalSpeed: -520,
    verticalAcceleration: 24.0,
    gForce: 6.0,
    atmDensity: 0.02,
    mach: 1.7,
    expect: "declined",
    decline: { reason: "beyond-horizon", input: "gForce" },
    note: "Peak entry deceleration, 6 g sensed. horizonSecondsFor(6) is 2.5 seconds and the gap is six, so the model WITHDRAWS on its own horizon: this is the frame where the honest answer is that a carried altitude is no longer one.",
  },
  {
    slug: "07-under-chute-6km",
    landing: {
      outcome: "atmosphere-modelled",
      sampleSource: null,
      terminalVelocity: 66,
      projectedTouchdownSpeed: 6.4,
      atmosphericTimeToImpact: 88,
      descentRegime: "at-terminal",
      parachuteState: "deployed",
      dragToWeightRatio: 1.02,
    },
    altitudeAsl: 6_000,
    verticalSpeed: -68,
    verticalAcceleration: 0.9,
    gForce: 1.15,
    atmDensity: 0.6,
    mach: 0.2,
    expect: "rate-integration",
    note: "Under canopy near terminal velocity. The sensed magnitude is back near 1, so the horizon reopens to about thirteen seconds and the model carries the altitude again.",
  },
];

/** Local `mu / r²` at an altitude ASL, which is what the envelope is built on. */
function gravityAt(altitudeAsl: number): number {
  const r = KERBIN.radius + altitudeAsl;
  return KERBIN.mu / (r * r);
}

/**
 * Every constraint the model imposes on a frame, checked before it is written.
 *
 * A frame that fails one of these renders as a board with no carried altitude
 * and no way to tell that from the model being broken, so the generator refuses
 * to write it.
 */
function assertConsistent(frame: Frame): void {
  const horizon = HORIZON_CEILING / Math.max(1, frame.gForce);
  const envelope =
    (gravityAt(frame.altitudeAsl) + frame.gForce * G0) * ENVELOPE_SLACK;
  const insideHorizon = GAP_SECONDS <= horizon;
  const insideEnvelope = Math.abs(frame.verticalAcceleration) <= envelope;
  if (!insideEnvelope) {
    throw new Error(
      `${frame.slug}: fitted slope ${frame.verticalAcceleration} is outside the envelope ${envelope.toFixed(2)}, so the model would decline as a change of regime`,
    );
  }
  if (frame.expect === "declined") {
    if (frame.decline === undefined) {
      throw new Error(`${frame.slug}: a declined frame must state its reason`);
    }
    /*
     * Only the gForce withdrawal is checkable here. The crossing band is a
     * property of what the CONIC solves for at the view time, which this file
     * does not solve, so `handover-basis.test.tsx` is the only thing that can
     * confirm it: hence the decline's `input` being asserted there rather than
     * assumed here.
     */
    if (frame.decline.input === "gForce" && insideHorizon) {
      throw new Error(
        `${frame.slug}: expects a horizon withdrawal but the gap ${GAP_SECONDS}s is inside the ${horizon.toFixed(1)}s horizon`,
      );
    }
    return;
  }
  if (frame.expect === "rate-integration" && !insideHorizon) {
    throw new Error(
      `${frame.slug}: gap ${GAP_SECONDS}s is past the ${horizon.toFixed(1)}s horizon, so the model would withdraw`,
    );
  }
  const inside = frame.altitudeAsl < KERBIN.atmosphereDepth;
  if (
    inside !==
    (frame.expect === "rate-integration" || frame.expect === "declined")
  ) {
    throw new Error(
      `${frame.slug}: altitude ${frame.altitudeAsl} m puts it ${inside ? "inside" : "outside"} the air, which is not the branch it expects`,
    );
  }
}

/**
 * The eccentric anomaly on the DESCENDING branch that puts the craft at
 * `radius`, and the mean anomaly that goes with it.
 *
 * `r = a(1 - e cos E)` has two solutions and only one of them is a craft coming
 * down. Taking `2π - E` is what picks it, and getting that wrong produces a
 * fixture that climbs.
 */
function descendingMeanAnomaly(
  sma: number,
  ecc: number,
  radius: number,
): number {
  const cosE = (1 - radius / sma) / ecc;
  if (cosE < -1 || cosE > 1) {
    throw new Error(
      `radius ${radius} is outside the orbit (sma ${sma}, ecc ${ecc})`,
    );
  }
  const e = 2 * Math.PI - Math.acos(cosE);
  return e - ecc * Math.sin(e);
}

/**
 * The reentry ellipse every frame's `vessel.orbit` carries: apoapsis at 200 km,
 * periapsis 50 km BELOW sea level.
 *
 * Sub-surface periapsis because that is what a reentry actually is, and because
 * an ellipse that bottomed out inside the air could not express the low frames
 * at all: at 6 km the craft is long past a 25 km periapsis and there is no
 * anomaly on that orbit for it. KSP keeps recomputing these elements under
 * physics, so what the wire carries during a descent is the drag-free conic the
 * craft is instantaneously on, and that conic passes through the ground.
 *
 * The elements only decide the CONIC frames. Below the interface they are read
 * for `mu` alone, which `localGravity` needs for the envelope, and the branch is
 * chosen off the observed altitude rather than off anything solved here.
 */
const REENTRY = (() => {
  const peri = KERBIN.radius - 50_000;
  const apo = KERBIN.radius + 200_000;
  const sma = (peri + apo) / 2;
  return { sma, ecc: (apo - peri) / (apo + peri) };
})();

/**
 * The history the fit is taken over: four samples ending at the anchor, spaced
 * IRREGULARLY.
 *
 * Irregular on purpose, and it costs nothing: `verticalAccelerationOver` is a
 * least-squares fit over `(validAt, verticalSpeed)` pairs precisely because the
 * stream is change-gated, so an evenly spaced fixture would be the one shape
 * production never produces. The speeds are the anchor's speed walked backwards
 * at the frame's own acceleration, so the fitted slope IS that acceleration by
 * construction.
 */
const HISTORY_OFFSETS = [-11, -7, -3, 0] as const;

interface Emit {
  channel: string;
  value: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

function flightEmit(frame: Frame, offset: number, newest: boolean): Emit {
  const validAt = ANCHOR_UT + offset;
  const verticalSpeed =
    frame.verticalSpeed + frame.verticalAcceleration * offset;
  /*
   * The altitude walked back the same way, second order, so the history is one
   * trajectory rather than a stack of the anchor's altitude. Only the anchor's
   * altitude is read by the model, but a history that disagreed with itself
   * would be a fixture nobody could reason about later.
   */
  const altitudeAsl =
    frame.altitudeAsl +
    frame.verticalSpeed * offset +
    0.5 * frame.verticalAcceleration * offset * offset;
  return {
    channel: "vessel.flight",
    value: {
      latitude: -0.05,
      longitude: -74.6,
      altitudeAsl,
      altitudeTerrain: altitudeAsl,
      verticalSpeed,
      surfaceSpeed: Math.abs(verticalSpeed) * 1.05,
      orbitalSpeed: Math.abs(verticalSpeed) * 1.05,
      gForce: frame.gForce,
      atmDensity: frame.atmDensity,
      atmosphericTemperature: 220.15,
      externalTemperature: frame.gForce > 3 ? 2600 : 300,
      mach: frame.mach,
    },
    meta: {
      validAt,
      deliveredAt: validAt,
      /*
       * Only the NEWEST point's staleness is read, and it has to say
       * `HeldStale` (1): `atmosphericAdmissibility`'s first withdrawal is "the
       * observation is current, so there is no gap to carry it across", so a
       * Fresh anchor gets no model at all and the whole set would render as six
       * live boards.
       */
      staleness: newest ? 1 : 0,
    },
  };
}

function fixtureFor(frame: Frame): unknown {
  const viewUt = ANCHOR_UT + GAP_SECONDS;
  const radius = KERBIN.radius + frame.altitudeAsl;
  const horizon = HORIZON_CEILING / Math.max(1, frame.gForce);
  return {
    _meta: {
      scenario: frame.slug,
      synthetic: true,
      /*
       * Which model this frame CLAIMS to reach, machine-readable, so
       * `handover-basis.test.tsx` can check the claim against the real store
       * rather than against a second copy of the table in the test file. A
       * fixture and a test that both hold the answer agree with each other
       * forever; a fixture that states its intent and a test that asks the
       * store cannot.
       */
      expectedBasis: frame.expect,
      ...(frame.decline ? { expectedDecline: frame.decline } : {}),
      notes: `SYNTHETIC, generated by scripts/gen-handover-fixtures.ts. ${frame.note} One Kerbin descent read ${GAP_SECONDS} s after its last packet (anchor UT ${ANCHOR_UT}, view UT ${viewUt}); ${frame.altitudeAsl} m ASL against a published atmosphere depth of ${KERBIN.atmosphereDepth} m, so withinAtmosphere is ${frame.altitudeAsl < KERBIN.atmosphereDepth}. Sensed ${frame.gForce} g closes the horizon to ${horizon.toFixed(1)} s. Four vessel.flight samples at irregular spacing whose least-squares slope is ${frame.verticalAcceleration} m/s². Expected model: ${frame.expect}.`,
    },
    _stream: {
      carriedChannels: [
        "system.bodies",
        "vessel.identity",
        "vessel.orbit",
        "vessel.flight",
        "vessel.surface",
        "vessel.propulsion",
        "vessel.control",
        "dv.summary",
        "comms.delay",
        "vessel.landing",
      ],
      pinnedUt: viewUt,
      emits: [
        {
          channel: "system.bodies",
          value: {
            bodies: [
              {
                name: "Kerbin",
                index: 1,
                parentIndex: 0,
                radius: KERBIN.radius,
                /*
                 * The one field the whole handover turns on. Every existing
                 * LandingStatus render fixture omits it, which is why every one
                 * of them takes the conic branch whatever altitude it is at.
                 */
                atmosphere: { depth: KERBIN.atmosphereDepth },
                orbit: null,
              },
            ],
          },
        },
        {
          channel: "vessel.identity",
          value: {
            vesselId: "handover",
            name: "Reentry Capsule",
            vesselType: 0,
            situation: 6,
            parentBodyIndex: 1,
            launchUt: null,
          },
        },
        {
          channel: "vessel.orbit",
          value: {
            referenceBodyIndex: 1,
            sma: REENTRY.sma,
            ecc: REENTRY.ecc,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: descendingMeanAnomaly(
              REENTRY.sma,
              REENTRY.ecc,
              radius,
            ),
            epoch: ANCHOR_UT,
            mu: KERBIN.mu,
            horizon: { kind: 1, trajectoryKind: 1 },
          },
          /*
           * `Quality.OnRails` (0), which `keplerAdmissibility` requires: its
           * FIRST withdrawal is a craft under physics. Held across the whole set
           * so the only thing that changes between frames is the altitude.
           */
          meta: { quality: 0 },
        },
        ...HISTORY_OFFSETS.map((offset, i) =>
          flightEmit(frame, offset, i === HISTORY_OFFSETS.length - 1),
        ),
        {
          channel: "vessel.surface",
          value: {
            biome: "Shores",
            landedAt: null,
            heightFromTerrain: frame.altitudeAsl,
          },
        },
        {
          channel: "vessel.propulsion",
          value: {
            totalMass: 5,
            dryMass: 3,
            currentThrust: 0,
            availableThrust: 18,
          },
        },
        {
          channel: "vessel.control",
          value: { gear: frame.altitudeAsl < 10_000, brakes: false },
        },
        {
          channel: "dv.summary",
          value: { totalDvActual: 400, totalDvVac: 450 },
        },
        ...(frame.landing
          ? [{ channel: "vessel.landing", value: frame.landing }]
          : []),
      ],
    },
  };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const frame of FRAMES) {
    assertConsistent(frame);
    await writeFile(
      join(OUT_DIR, `${frame.slug}.json`),
      `${JSON.stringify(fixtureFor(frame), null, 2)}\n`,
    );
    const horizon = HORIZON_CEILING / Math.max(1, frame.gForce);
    console.log(
      `${frame.slug.padEnd(30)} ${String(frame.altitudeAsl).padStart(6)} m ASL  ` +
        `g=${frame.gForce}  horizon=${horizon.toFixed(1)}s  expect=${frame.expect}`,
    );
  }
  console.log(`\nWrote ${FRAMES.length} fixtures to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
