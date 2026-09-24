import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import type { ReckoningDecline } from "../reading";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import { value } from "../unit-system/value";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import {
  type ConicBodiesInput,
  type ConicOrbitInput,
  keplerAdmissibility,
} from "./kepler-reckoning";

/**
 * Which reason each of `keplerAdmissibility`'s withdrawals carries, and that
 * `"under-physics"` means one condition and only one.
 *
 * A widget told a craft is under physics tells the operator the orbit exists
 * and the craft is loaded. That sentence is only true while the reason is
 * emitted for that condition alone, which is why the last case here scans every
 * production source rather than trusting this function to stay the only
 * emitter: a new withdrawal, anywhere, that reused the member would make every
 * consumer of it mislabel a craft with no type error to say so.
 */

const KERBIN_MU = 3.5316e12;
const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };

/** 800 km radius round a 600 km body: 200 km up, on rails, no encounter. */
function orbitPoint(
  overrides: Partial<ConicOrbitInput> = {},
  quality: Quality = Quality.OnRails,
): TimelinePoint<ConicOrbitInput> {
  return {
    validAt: 0,
    epoch: 0,
    meta: makeMeta({ validAt: 0, deliveredAt: 0, quality }),
    payload: {
      referenceBodyIndex: 1,
      sma: value("m", 800_000),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
      mu: value("m³/s²", KERBIN_MU),
      horizon: ANALYTIC,
      ...overrides,
    },
  };
}

function bodies(atmosphereDepth: number | null): ConicBodiesInput {
  return {
    bodies: [
      {
        index: 1,
        radius: value("m", 600_000),
        atmosphere: {
          depth: atmosphereDepth === null ? null : value("m", atmosphereDepth),
        },
      },
    ],
  };
}

function reasonOf(
  point: TimelinePoint<ConicOrbitInput> | undefined,
  air: number | null = null,
  viewUt = 300,
): ReckoningDecline["reason"] | "ok" {
  const answer = keplerAdmissibility(point, bodies(air), viewUt);
  return "ok" in answer ? "ok" : answer.declined.reason;
}

describe("keplerAdmissibility names each withdrawal", () => {
  it("advances an analytic coast above the air", () => {
    expect(reasonOf(orbitPoint())).toBe("ok");
  });

  it("gives every condition the reason it means", () => {
    expect({
      absent: reasonOf(undefined),
      integrated: reasonOf(
        orbitPoint({
          horizon: { kind: Reach.Unbounded, trajectoryKind: Shape.Integrated },
        }),
      ),
      unstated: reasonOf(
        orbitPoint({
          horizon: { kind: Reach.Unbounded, trajectoryKind: Shape.Unspecified },
        }),
      ),
      loaded: reasonOf(orbitPoint({}, Quality.Loaded)),
      pastTransition: reasonOf(
        orbitPoint({ encounter: { transitionUt: value("ut", 100) } }),
      ),
      pastReach: reasonOf(
        orbitPoint({
          horizon: {
            kind: Reach.Until,
            untilUt: 100,
            trajectoryKind: Shape.Analytic,
          },
        }),
      ),
      inAir: reasonOf(orbitPoint(), 250_000),
    }).toEqual({
      absent: "input-absent",
      integrated: "model-inapplicable",
      unstated: "model-inapplicable",
      loaded: "under-physics",
      pastTransition: "beyond-horizon",
      pastReach: "beyond-horizon",
      inAir: "beyond-horizon",
    });
  });

  /**
   * The ordering that matters for the label: a craft under physics that is
   * ALSO off an integrated provider is refused on the authority, which is the
   * permanent fact. Calling it under physics would be true and misleading.
   */
  it("does not call a craft under physics when the authority rules it out first", () => {
    expect(
      reasonOf(
        orbitPoint(
          {
            horizon: {
              kind: Reach.Unbounded,
              trajectoryKind: Shape.Integrated,
            },
          },
          Quality.Loaded,
        ),
      ),
    ).toBe("model-inapplicable");
  });
});

/* A whole-tree git grep: well under a second on a quiet machine, many
   seconds on a loaded one, and a timeout here would read as a finding. */
describe("under-physics has exactly one emitter", { timeout: 60_000 }, () => {
  const repo = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../..",
  );

  /**
   * Production TypeScript files matching `pattern`, a POSIX extended regex. `git grep --untracked` so a
   * file not yet committed is seen too; a walk of the tree reads the C# build
   * output as well and runs past the test timeout under a full suite.
   */
  function productionFilesMatching(pattern: string): string[] {
    let out: string;
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "--untracked",
          "-l",
          "-E",
          pattern,
          "--",
          "mod/*.ts",
          "mod/*.tsx",
          "packages/*.ts",
          "packages/*.tsx",
          ":!*.test.ts",
          ":!*.test.tsx",
          ":!*.test-d.ts",
          ":!*/dist/*",
        ],
        { cwd: repo, encoding: "utf8" },
      );
    } catch (error) {
      // Exit status 1 is git grep's "no match", which is an answer; anything
      // else is a search that did not run.
      if (error instanceof Error && "status" in error && error.status === 1)
        return [];
      throw error;
    }
    return out.split("\n").filter((line) => line !== "");
  }

  it("is raised by the not-on-rails arm and nowhere else", () => {
    const emitters = productionFilesMatching(
      'reason:[[:space:]]*"under-physics"',
    );

    expect(emitters).toEqual(["mod/sitrep-sdk/src/spine/kepler-reckoning.ts"]);
    const source = readFileSync(join(repo, emitters[0]), "utf8");
    expect(source.match(/reason:\s*"under-physics"/g)).toHaveLength(1);
  });

  it("can see an emitter, so an empty answer is not a blind scan", () => {
    // The control: the same search finds the general code's many emitters,
    // including the one file the rule above names.
    const general = productionFilesMatching(
      'reason:[[:space:]]*"model-inapplicable"',
    );
    expect(general).toContain("mod/sitrep-sdk/src/spine/kepler-reckoning.ts");
    expect(general.length).toBeGreaterThan(3);
  });
});
