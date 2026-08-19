// @vitest-environment node

import * as sdk from "@ksp-gonogo/sitrep-sdk";
import * as sdkSpine from "@ksp-gonogo/sitrep-sdk/spine";
import * as sdkTesting from "@ksp-gonogo/sitrep-sdk/testing";
import * as kit from "@ksp-gonogo/ui-kit";
import * as kitTesting from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";

/**
 * The harness an Uplink's tests run on is published across the two packages that own
 * its halves, and this asserts the things a test CONSTRUCTS or CALLS are present at
 * runtime, not merely assignable in a signature.
 *
 * The distinction is the whole point, and it was hit independently by three people.
 * `TelemetryClient` is exported as a MIRRORED TYPE: it satisfies a grep, it satisfies
 * `let c: TelemetryClient`, and it fails at `new TelemetryClient(transport)`, which is
 * what every caller actually writes. A type-only export is indistinguishable from a
 * value export in the source and in the `.d.ts`, and differs only at runtime.
 *
 * So this imports the built packages as namespaces and checks `typeof`. A symbol that
 * regressed to type-only disappears from the namespace object entirely and fails here,
 * which is the only place it can be caught before a consumer's constructor call.
 *
 * There is no third harness package any more. `@ksp-gonogo/sitrep-testing` existed to
 * hold a host builder that could not live in the sdk while the implementations were in
 * `@ksp-gonogo/core`; they are in the sdk now, so `installRealTestHost` is
 * `@ksp-gonogo/sitrep-sdk/testing`'s and `renderWidget` is
 * `@ksp-gonogo/ui-kit/testing`'s, each beside what it drives. The two do NOT re-export
 * each other: a design-system package fronting a generic test harness would be a
 * dependency inversion wearing a convenience.
 *
 * It lives in `packages/app` because that is the only place that can see everything
 * with nothing depending on it.
 */

/**
 * One lookup across the four entries an Uplink's tests import from, so a name can be
 * asserted present without this file also pinning WHICH entry it came from. Where it
 * lives is `docs/uplink-isolation.md`'s business and moves as things move; that it is
 * a callable at runtime is this file's.
 *
 * The two `/testing` subpaths are listed before their roots so a testing-only export
 * wins over a same-named root one, which is the precedence a test's own import would
 * get.
 */
const harness: Record<string, unknown> = {
  ...(sdk as Record<string, unknown>),
  ...(sdkSpine as Record<string, unknown>),
  ...(kit as Record<string, unknown>),
  ...(sdkTesting as Record<string, unknown>),
  ...(kitTesting as Record<string, unknown>),
};

/**
 * Constructed with `new`, so they must be real classes.
 *
 * `TelemetryClient` is deliberately NOT here. It is published as a TYPE only:
 * the class is spine plumbing and freezing it as public API would make every
 * future change to it someone else's breaking change. A test that wants a
 * stream calls `setupStreamFixture`. See `TYPE_ONLY` below.
 */
const CONSTRUCTORS = [
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
  "createTestTelemetryClient",
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
  "renderWidget",
  "registerComponent",
  "getComponent",
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

/**
 * The other half of the type-vs-value distinction: these must NOT be values on the
 * AUTHOR surface. Without this, re-exporting `TelemetryClient` as a class from a root
 * barrel would restore the surface nobody wants and no test would notice.
 *
 * Checked against the two roots only, deliberately, not the merged view.
 * `@ksp-gonogo/sitrep-sdk/spine` exports the real class and is meant to: that subpath
 * exists precisely so a TEST can reach unfrozen internals (`TimelineStore` is there
 * for the same reason, and says so) while an author composing a widget cannot get
 * them by reaching for the package they already import. Asserting against the merge
 * would have failed for the one arrangement everyone agreed on.
 */
const AUTHOR_SURFACE: Record<string, unknown> = {
  ...(sdk as Record<string, unknown>),
  ...(kit as Record<string, unknown>),
};

const TYPE_ONLY = ["TelemetryClient"] as const;

describe("the published testing entries: surface", () => {
  it("exports the type-only names as types, never as constructible values", () => {
    const leaked = TYPE_ONLY.filter(
      (name) => AUTHOR_SURFACE[name] !== undefined,
    );
    expect(
      leaked,
      [
        "These are published as TYPES on purpose and are values at runtime.",
        "",
        "`TelemetryClient` is spine plumbing: the transport, the store, command",
        "lifecycle and loss detection. Publishing the class from a ROOT barrel",
        "freezes all of that as third-party API. Give the fixture a verb instead;",
        "a test that genuinely needs the class reaches it through /spine.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The instrument check. A namespace import that resolved to an empty object
   * passes every `typeof` assertion below by having nothing to disagree with, and
   * a broken `exports` map or an unbuilt `dist` produces exactly that.
   */
  it("actually imported the package", () => {
    expect(Object.keys(harness).length).toBeGreaterThan(40);
    // Per entry as well as merged: a spread of an empty namespace object vanishes
    // silently into the merge, so the total above would still pass with one of the
    // four resolving to nothing.
    expect(Object.keys(sdk).length, "@ksp-gonogo/sitrep-sdk").toBeGreaterThan(
      40,
    );
    expect(Object.keys(kit).length, "@ksp-gonogo/ui-kit").toBeGreaterThan(40);
    expect(
      Object.keys(sdkTesting).length,
      "@ksp-gonogo/sitrep-sdk/testing",
    ).toBeGreaterThan(10);
    expect(
      Object.keys(kitTesting).length,
      "@ksp-gonogo/ui-kit/testing",
    ).toBeGreaterThan(2);
    expect(
      Object.keys(sdkSpine).length,
      "@ksp-gonogo/sitrep-sdk/spine",
    ).toBeGreaterThan(40);
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
