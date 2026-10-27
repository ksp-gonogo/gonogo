#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `keplerAdmissibility`
 * (`mod/sitrep-sdk/src/spine/kepler-reckoning.ts`).
 *
 * Runs the real function over every case below and writes what it returned to
 * `mod/golden-fixtures/kepler-admissibility.json`. The browser's vitest
 * (`kepler-admissibility.golden.test.ts`) and the mod's C# twin
 * (`Sitrep.Host.Tests/Comms/KeplerAdmissibilityGoldenFixtureTests.cs`) are both
 * held to that file.
 *
 * JSON has no NaN or infinity, so those are written as the strings "NaN",
 * "Infinity" and "-Infinity", and both readers turn them back. A key that is
 * missing is an absent input; `null` is a stated null.
 *
 * Run with:
 * `pnpm --filter @ksp-gonogo/sitrep-kernel exec tsx ../golden-fixtures/gen/kepler-admissibility.gen.ts`,
 * then `pnpm exec biome check --write mod/golden-fixtures/kepler-admissibility.json`.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Quality } from "../../sitrep-sdk/src/__generated__/contract.ts";
import {
  type ConicBodiesInput,
  type ConicOrbitInput,
  type ConicPendingInput,
  type ConicThrustInput,
  keplerAdmissibility,
  type LoadedCoastEvidence,
} from "../../sitrep-sdk/src/spine/kepler-reckoning.ts";
import type { TimelinePoint } from "../../sitrep-sdk/src/timeline.ts";

const OUT_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "kepler-admissibility.json",
);

type QualityName = "OnRails" | "Loaded";

interface FixtureCase {
  id: string;
  orbitPoint?: {
    validAt: number;
    quality: QualityName;
    payload: ConicOrbitInput | null;
  };
  bodies?: ConicBodiesInput;
  viewUt: number;
  coast?: {
    thrust?: ConicThrustInput;
    pending?: ConicPendingInput;
  };
}

const KERBIN = 1;
const MUN = 2;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;
/** Kerbin's surface radius plus its 70 km atmosphere. */
const KERBIN_FLOOR = 670_000;

const system: ConicBodiesInput = {
  bodies: [
    {
      index: KERBIN,
      radius: 600_000,
      atmosphere: { depth: 70_000 },
      sphereOfInfluence: 84_159_286,
    },
    {
      index: MUN,
      radius: 200_000,
      atmosphere: null,
      sphereOfInfluence: 2_429_559,
    },
  ],
};

const analytic = { kind: 1, trajectoryKind: 1 } as const;

function circle(
  sma: number,
  extra: Partial<ConicOrbitInput> = {},
): ConicOrbitInput {
  return {
    referenceBodyIndex: KERBIN,
    sma,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: KERBIN_MU,
    horizon: analytic,
    ...extra,
  };
}

/** Periapsis 650 km, under the 670 km floor; apoapsis 1,000 km, period about 2,505 s, first periapsis at about 1,879 s. */
const dipping: ConicOrbitInput = circle(825_000, {
  ecc: 175_000 / 825_000,
  meanAnomalyAtEpoch: Math.PI / 2,
});

/** An escape from Kerbin with periapsis 650 km, under the floor. */
const hyperbola = (meanAnomalyAtEpoch: number): ConicOrbitInput =>
  circle(-1_000_000, {
    ecc: 1.65,
    meanAnomalyAtEpoch,
  });

const onRails = (payload: ConicOrbitInput | null, validAt = 0) => ({
  validAt,
  quality: "OnRails" as const,
  payload,
});

const loaded = (payload: ConicOrbitInput | null, validAt = 0) => ({
  validAt,
  quality: "Loaded" as const,
  payload,
});

const coasting = { currentThrust: 0 };

const LOW = circle(700_000);

const cases: FixtureCase[] = [
  { id: "orbit-point-absent", bodies: system, viewUt: 100 },
  {
    id: "orbit-payload-null",
    orbitPoint: onRails(null),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "on-rails-analytic-unbounded",
    orbitPoint: onRails(LOW),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "values-wrapped-as-quantities",
    orbitPoint: onRails(
      circle(700_000, {
        sma: { magnitude: 700_000 },
        mu: { magnitude: KERBIN_MU },
        epoch: { magnitude: 0 },
      }),
    ),
    bodies: {
      bodies: [
        {
          index: KERBIN,
          radius: { magnitude: 600_000 },
          atmosphere: { depth: { magnitude: 70_000 } },
          sphereOfInfluence: { magnitude: 84_159_286 },
        },
      ],
    },
    viewUt: 100,
  },

  // The n-body rule.
  {
    id: "unbounded-integrated",
    orbitPoint: onRails(
      circle(700_000, { horizon: { kind: 1, trajectoryKind: 2 } }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "unbounded-unspecified-trajectory",
    orbitPoint: onRails(
      circle(700_000, { horizon: { kind: 1, trajectoryKind: 0 } }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "unbounded-trajectory-kind-absent",
    orbitPoint: onRails(circle(700_000, { horizon: { kind: 1 } })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "integrated-bounded-inside-window",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: 500, trajectoryKind: 2 },
      }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "integrated-bounded-at-window-end",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: 500, trajectoryKind: 2 },
      }),
    ),
    bodies: system,
    viewUt: 500,
  },
  {
    id: "integrated-bounded-past-window-end",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: 500, trajectoryKind: 2 },
      }),
    ),
    bodies: system,
    viewUt: 500.001,
  },

  // The provider's horizon.
  {
    id: "horizon-absent",
    orbitPoint: onRails(circle(700_000, { horizon: undefined })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "horizon-unspecified",
    orbitPoint: onRails(
      circle(700_000, { horizon: { kind: 0, trajectoryKind: 1 } }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "horizon-until-without-ut",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: null, trajectoryKind: 1 },
      }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "horizon-until-nan",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: Number.NaN, trajectoryKind: 1 },
      }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "horizon-until-zero-is-a-bound",
    orbitPoint: onRails(
      circle(700_000, {
        horizon: { kind: 2, untilUt: 0, trajectoryKind: 1 },
      }),
    ),
    bodies: system,
    viewUt: 100,
  },

  // The next change of sphere of influence.
  {
    id: "encounter-before-view",
    orbitPoint: onRails(circle(700_000, { encounter: { transitionUt: 100 } })),
    bodies: system,
    viewUt: 99.999,
  },
  {
    id: "encounter-at-view",
    orbitPoint: onRails(circle(700_000, { encounter: { transitionUt: 100 } })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "encounter-transition-nan",
    orbitPoint: onRails(
      circle(700_000, { encounter: { transitionUt: Number.NaN } }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "encounter-transition-null",
    orbitPoint: onRails(circle(700_000, { encounter: { transitionUt: null } })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "encounter-locked",
    orbitPoint: onRails(
      circle(700_000, {
        encounter: { locked: ["trackingStation"] } as never,
      }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "encounter-zero-is-a-transition",
    orbitPoint: onRails(circle(700_000, { encounter: { transitionUt: 0 } })),
    bodies: system,
    viewUt: 100,
  },

  // Inside the sphere of influence.
  {
    id: "soi-exactly-on-boundary",
    orbitPoint: onRails(
      circle(2_429_559, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "soi-outside",
    orbitPoint: onRails(
      circle(2_429_560, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "soi-absent",
    orbitPoint: onRails(
      circle(3_000_000, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: { bodies: [{ index: MUN, radius: 200_000 }] },
    viewUt: 100,
  },
  {
    id: "soi-zero-is-absent",
    orbitPoint: onRails(
      circle(3_000_000, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: {
      bodies: [{ index: MUN, radius: 200_000, sphereOfInfluence: 0 }],
    },
    viewUt: 100,
  },
  {
    id: "soi-nan-is-absent",
    orbitPoint: onRails(
      circle(3_000_000, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: {
      bodies: [{ index: MUN, radius: 200_000, sphereOfInfluence: Number.NaN }],
    },
    viewUt: 100,
  },

  // Above the atmosphere, or the surface of an airless body.
  {
    id: "floor-exactly-at-interface",
    orbitPoint: onRails(circle(KERBIN_FLOOR)),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "floor-just-above-interface",
    orbitPoint: onRails(circle(KERBIN_FLOOR + 0.001)),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "floor-airless-surface",
    orbitPoint: onRails(
      circle(200_000, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "floor-airless-just-above-surface",
    orbitPoint: onRails(
      circle(200_000.001, { referenceBodyIndex: MUN, mu: MUN_MU }),
    ),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "floor-atmosphere-depth-zero-is-surface",
    orbitPoint: onRails(circle(650_000)),
    bodies: {
      bodies: [{ index: KERBIN, radius: 600_000, atmosphere: { depth: 0 } }],
    },
    viewUt: 100,
  },
  {
    id: "floor-atmosphere-depth-nan-is-surface",
    orbitPoint: onRails(circle(650_000)),
    bodies: {
      bodies: [
        {
          index: KERBIN,
          radius: 600_000,
          atmosphere: { depth: Number.NaN },
        },
      ],
    },
    viewUt: 100,
  },
  {
    id: "floor-body-radius-absent",
    orbitPoint: onRails(circle(650_000)),
    bodies: { bodies: [{ index: KERBIN, atmosphere: { depth: 70_000 } }] },
    viewUt: 100,
  },
  {
    id: "floor-body-radius-nan",
    orbitPoint: onRails(circle(650_000)),
    bodies: {
      bodies: [
        { index: KERBIN, radius: Number.NaN, atmosphere: { depth: 70_000 } },
      ],
    },
    viewUt: 100,
  },
  {
    id: "floor-body-not-listed",
    orbitPoint: onRails(circle(650_000)),
    bodies: { bodies: [{ index: MUN, radius: 200_000 }] },
    viewUt: 100,
  },
  {
    id: "floor-bodies-absent",
    orbitPoint: onRails(circle(650_000)),
    viewUt: 100,
  },
  {
    id: "dipping-before-periapsis",
    orbitPoint: onRails(dipping),
    bodies: system,
    viewUt: 1_500,
  },
  {
    id: "dipping-past-periapsis",
    orbitPoint: onRails(dipping),
    bodies: system,
    viewUt: 4_000,
  },
  {
    id: "dipping-past-periapsis-from-later-sample",
    orbitPoint: onRails(dipping, 3_900),
    bodies: system,
    viewUt: 4_000,
  },
  {
    id: "hyperbola-inbound-passes-periapsis",
    orbitPoint: onRails(hyperbola(-0.5)),
    bodies: system,
    viewUt: 2_000,
  },
  {
    id: "hyperbola-inbound-before-periapsis",
    orbitPoint: onRails(hyperbola(-2)),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "hyperbola-outbound",
    orbitPoint: onRails(hyperbola(0.5)),
    bodies: system,
    viewUt: 2_000,
  },
  {
    id: "parabola-on-rails",
    orbitPoint: onRails(circle(700_000, { ecc: 1 })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "sma-absent-on-rails",
    orbitPoint: onRails(circle(700_000, { sma: null })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "mu-absent-on-rails",
    orbitPoint: onRails(circle(650_000, { mu: Number.NaN })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "lan-null-is-undefined-node",
    orbitPoint: onRails(circle(700_000, { lan: null, argPe: null })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "lan-nan-places-nothing",
    orbitPoint: onRails(circle(650_000, { lan: Number.NaN })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "inc-absent",
    orbitPoint: onRails(circle(700_000, { inc: null })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "mean-anomaly-absent",
    orbitPoint: onRails(circle(700_000, { meanAnomalyAtEpoch: Number.NaN })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "epoch-absent",
    orbitPoint: onRails(circle(700_000, { epoch: null })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "arg-pe-nan-places-nothing",
    orbitPoint: onRails(circle(700_000, { argPe: Number.NaN })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "ecc-infinite-is-absent",
    orbitPoint: onRails(circle(700_000, { ecc: Number.POSITIVE_INFINITY })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "ecc-negative",
    orbitPoint: onRails(circle(700_000, { ecc: -0.1 })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "mu-zero",
    orbitPoint: onRails(circle(700_000, { mu: 0 })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "mu-negative",
    orbitPoint: onRails(circle(700_000, { mu: -KERBIN_MU })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "sma-zero",
    orbitPoint: onRails(circle(0)),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "closed-orbit-negative-sma",
    orbitPoint: onRails(circle(-700_000, { ecc: 0.1 })),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "hyperbola-positive-sma-reads-its-size",
    orbitPoint: onRails(
      circle(1_000_000, { ecc: 1.65, meanAnomalyAtEpoch: 0.5 }),
    ),
    bodies: system,
    viewUt: 2_000,
  },
  {
    id: "loaded-ecc-negative",
    orbitPoint: loaded(circle(700_000, { ecc: -0.1 })),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-parabola-under-thrust",
    orbitPoint: loaded(circle(700_000, { ecc: 1 })),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 1_000 } },
  },
  {
    id: "view-ut-nan",
    orbitPoint: onRails(LOW),
    bodies: system,
    viewUt: Number.NaN,
  },

  // The coast evidence for a loaded craft.
  {
    id: "loaded-coasting",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting, pending: { pending: [] } },
  },
  {
    id: "loaded-coast-absent",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
  },
  {
    id: "loaded-thrust-absent",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { pending: { pending: [] } },
  },
  {
    id: "loaded-under-thrust",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 0.001 } },
  },
  {
    id: "loaded-thrust-nan",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: Number.NaN } },
  },
  {
    id: "loaded-thrust-null",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: null } },
  },
  {
    id: "loaded-burn-in-progress-at-zero-thrust",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 0, thrustStartedUt: 40 } },
  },
  {
    id: "loaded-burn-ended-after-elements",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 0, lastThrustEndUt: 50.001 } },
  },
  {
    id: "loaded-burn-ended-at-elements",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 0, lastThrustEndUt: 50 } },
  },
  {
    id: "loaded-burn-end-nan",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: { thrust: { currentThrust: 0, lastThrustEndUt: Number.NaN } },
  },
  {
    id: "loaded-bodies-absent",
    orbitPoint: loaded(LOW),
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-parabola",
    orbitPoint: loaded(circle(700_000, { ecc: 1 })),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-at-interface",
    orbitPoint: loaded(circle(KERBIN_FLOOR)),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-just-above-interface",
    orbitPoint: loaded(circle(KERBIN_FLOOR + 0.001)),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-mu-absent",
    orbitPoint: loaded(circle(700_000, { mu: Number.NaN })),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-pending-absent",
    orbitPoint: loaded(LOW),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
  {
    id: "loaded-command-arrives-at-sample",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: 40, oneWaySeconds: 10 }] },
    },
  },
  {
    id: "loaded-command-arrives-just-after-sample",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: 40, oneWaySeconds: 10.001 }] },
    },
  },
  {
    id: "loaded-command-arrives-at-view",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: 90, oneWaySeconds: 10 }] },
    },
  },
  {
    id: "loaded-command-arrives-after-view",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: 90, oneWaySeconds: 10.001 }] },
    },
  },
  {
    id: "loaded-command-held-without-route",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: 60, oneWaySeconds: null }] },
    },
  },
  {
    id: "loaded-command-one-way-nan",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: {
        pending: [{ dispatchedAt: 60, oneWaySeconds: Number.NaN }],
      },
    },
  },
  {
    id: "loaded-command-dispatch-absent",
    orbitPoint: loaded(LOW, 50),
    bodies: system,
    viewUt: 100,
    coast: {
      thrust: coasting,
      pending: { pending: [{ dispatchedAt: null, oneWaySeconds: 10 }] },
    },
  },
  {
    id: "loaded-coasting-past-encounter",
    orbitPoint: loaded(circle(700_000, { encounter: { transitionUt: 80 } })),
    bodies: system,
    viewUt: 100,
    coast: { thrust: coasting },
  },
];

function run(c: FixtureCase) {
  const point =
    c.orbitPoint === undefined
      ? undefined
      : ({
          validAt: c.orbitPoint.validAt,
          payload: c.orbitPoint.payload,
          meta: { quality: Quality[c.orbitPoint.quality] },
          epoch: 0,
        } as unknown as TimelinePoint<ConicOrbitInput>);
  const coast: LoadedCoastEvidence | undefined =
    c.coast === undefined
      ? undefined
      : { thrust: c.coast.thrust, pending: c.coast.pending };
  return keplerAdmissibility(point, c.bodies, c.viewUt, coast);
}

function nonFinite(_key: string, value: unknown): unknown {
  if (typeof value !== "number" || Number.isFinite(value)) return value;
  return Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
}

const ids = new Set<string>();
for (const c of cases) {
  if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
  ids.add(c.id);
}

const file = {
  $schema:
    "Cross-language fixture for keplerAdmissibility. Generated by gen/kepler-admissibility.gen.ts from the real TS function; never edit by hand.",
  cases: cases.map((c) => ({ ...c, expected: run(c) })),
};

writeFileSync(OUT_FILE, `${JSON.stringify(file, nonFinite, 2)}\n`);
console.log(`wrote ${cases.length} cases to ${OUT_FILE}`);
