// @vitest-environment node
import * as harness from "@ksp-gonogo/sitrep-testing";
import { describe, expect, it } from "vitest";

/**
 * `@ksp-gonogo/sitrep-testing` publishes the harness an Uplink's tests run on. This
 * asserts the things a test CONSTRUCTS or CALLS are present at runtime, not merely
 * assignable in a signature.
 *
 * The distinction is the whole point, and it was hit independently by three people
 * on this branch. `TelemetryClient` is exported by `@ksp-gonogo/sitrep-sdk` as a
 * MIRRORED TYPE: it satisfies a grep, it satisfies `let c: TelemetryClient`, and it
 * fails at `new TelemetryClient(transport)`, which is what every caller actually
 * writes. A type-only export is indistinguishable from a value export in the source
 * and in the `.d.ts`, and differs only at runtime.
 *
 * So this test imports the built package as a namespace and checks `typeof`. A
 * symbol that regressed to type-only disappears from the namespace object entirely
 * and fails here, which is the only place it can be caught before a consumer's
 * constructor call.
 *
 * It lives in `packages/app` because that is the only place it can. The harness
 * depends on `core` and `data`, so a test of it inside either is a cycle, and turbo
 * says so outright: "Circular package dependency detected: @ksp-gonogo/data,
 * @ksp-gonogo/sitrep-testing, @ksp-gonogo/core, @ksp-gonogo/ui". The app sits at
 * the top of the graph with nothing depending on it, so it is where a test that
 * needs to see everything belongs.
 */

/** Constructed with `new`, so they must be real classes. */
const CONSTRUCTORS = [
  "TelemetryClient",
  "TimelineStore",
  "ViewClock",
  "StubTransport",
  "MockDataSource",
  "BufferedDataSource",
  "MemoryStore",
  "FogMaskStore",
  "PerfBudget",
] as const;

/** Called directly. */
const FUNCTIONS = [
  "installRealTestHost",
  "setupStreamFixture",
  "installDomStubs",
  "createFakeWallClock",
  "clearRegistry",
  "clearAugments",
  "clearActionHandlers",
  "clearUplinkHandles",
  "clearFogRevealSources",
  "clearProcessorRuntime",
  "registerDataSource",
  "registerStockBodies",
  "getAugmentsForSlot",
  "getMapPoiProviders",
  "dispatchAction",
  "resetSettingsForTests",
  "setSetting",
  "render",
  "renderHook",
  "probeText",
] as const;

/** Read as data (channel definitions, constants) rather than called. */
const VALUES = [
  "vesselStateChannel",
  "spaceCenterStateChannel",
  "dvCurrentStageResourceChannel",
  "dvCurrentStageResourceMaxChannel",
  "DEFAULT_PROFILE_ID",
] as const;

describe("@ksp-gonogo/sitrep-testing: published surface", () => {
  /**
   * The instrument check. A namespace import that resolved to an empty object
   * passes every `typeof` assertion below by having nothing to disagree with, and
   * a broken `exports` map or an unbuilt `dist` produces exactly that.
   */
  it("actually imported the package", () => {
    expect(Object.keys(harness).length).toBeGreaterThan(40);
  });

  it("exports every constructor as a class, not a mirrored type", () => {
    const bad = CONSTRUCTORS.filter(
      (name) =>
        typeof (harness as Record<string, unknown>)[name] !== "function",
    );
    expect(
      bad,
      [
        "These are used as `new X(...)` and are not values at runtime.",
        "",
        "A type-only export looks identical in the source and in the .d.ts, and",
        "fails only at the constructor call in a consumer's test. Re-export the",
        "real class from @ksp-gonogo/sitrep-client or @ksp-gonogo/core, not the",
        "sdk's mirrored type of the same name.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("exports every helper as a callable", () => {
    const bad = FUNCTIONS.filter(
      (name) =>
        typeof (harness as Record<string, unknown>)[name] !== "function",
    );
    expect(bad, "Missing or non-callable harness helpers.").toEqual([]);
  });

  it("exports every data value as something defined", () => {
    const bad = VALUES.filter(
      (name) => (harness as Record<string, unknown>)[name] === undefined,
    );
    expect(bad, "Missing harness values.").toEqual([]);
  });

  /**
   * The Testing Library surface arrives through `@ksp-gonogo/sitrep-sdk/testing`
   * rather than being re-exported here a second time, and a star re-export drops a
   * name silently when two of them collide. These are the ones every Uplink test
   * calls, so a collision that swallowed one would be caught here rather than in
   * forty test files at once.
   */
  it("forwards the Testing Library surface without dropping a name", () => {
    const bad = ["screen", "waitFor", "within", "act", "fireEvent"].filter(
      (name) => (harness as Record<string, unknown>)[name] === undefined,
    );
    expect(bad, "A star re-export collision dropped these names.").toEqual([]);
  });
});
