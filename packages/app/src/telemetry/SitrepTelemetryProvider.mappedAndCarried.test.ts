import {
  isTopicCarried,
  PRODUCTION_DERIVED_CHANNELS,
  TELEMACHUS_CLEAN_HOMES,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./SitrepTelemetryProvider";

/**
 * Mapped-AND-carried gate — extends the `mapTopic` coverage test
 * (`packages/core/src/hooks/mapTopic.coverage.test.ts`, which only proves
 * every widget key is mapped-or-gapped) with the other half of the
 * "mapped-but-not-carried" failure mode: a `TELEMACHUS_CLEAN_HOMES` target
 * that resolves via `mapTopic` but was never promoted into
 * `DEFAULT_SITREP_CARRIED_TOPICS` silently stays on the legacy `DataSource`
 * forever, because `useTelemetry`'s carried-channels gate refuses to route a
 * mapped-but-uncarried topic to the stream (see `carried-channels.ts`'s doc
 * comment — the "big-bang blank-out" guard). Two real instances of this bug
 * shipped before a test caught it: `contracts.completedRecent`'s parent
 * (`career.status`, fixed retroactively) and `science.experimentBreakdown`
 * (I2, fixed alongside this test). Both would have failed the assertion
 * below.
 *
 * Uses the real `isTopicCarried` + a `TimelineStore` seeded with
 * `PRODUCTION_DERIVED_CHANNELS` (the same derived-channel set
 * `TelemetryProvider`'s auto-built store registers) rather than naive
 * string-set membership, because most `TELEMACHUS_CLEAN_HOMES` targets are
 * DERIVED topics (`vessel.state.*`, `spaceCenter.state.*`, `career.status.*`,
 * `dv.summary.*`, `system.*`) whose own name never appears in
 * `DEFAULT_SITREP_CARRIED_TOPICS` — only their declared raw inputs do. A
 * literal-membership check would false-positive-fail every one of those.
 */

/**
 * Targets that resolve via `mapTopic` but are deliberately NOT expected to
 * be carried yet — each entry documents why, so this allowlist can't grow by
 * accident. Do not add an entry here to silence a real regression; fix the
 * carry gap instead (add the topic, or its derived channel's inputs, to
 * `DEFAULT_SITREP_CARRIED_TOPICS`).
 */
// I1 (`a.physicsMode` -> `vessel.physics.mode`) used to need an entry here —
// resolved instead by REMOVING the read entirely (the Principia mod-seam
// revert deleted `a.physicsMode`/`VesselPhysicsMode.IsPrincipiaActive` from
// core), so `vessel.physics.mode` no longer appears as a `TELEMACHUS_CLEAN_HOMES`
// target and there's nothing left to allowlist.
const KNOWN_UNCARRIED: ReadonlySet<string> = new Set([]);

describe("TELEMACHUS_CLEAN_HOMES targets are mapped AND carried", () => {
  function buildStore(): TimelineStore {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      store.registerDerivedChannel(channel);
    }
    return store;
  }

  it("found a non-trivial number of clean-home mappings (scan sanity check)", () => {
    // Guards against this test vacuously passing if TELEMACHUS_CLEAN_HOMES
    // ever moved or was accidentally emptied.
    expect(Object.keys(TELEMACHUS_CLEAN_HOMES).length).toBeGreaterThan(50);
  });

  it("every mapped target is carried, unless explicitly allowlisted", () => {
    const store = buildStore();
    const carriedChannels = new Set(DEFAULT_SITREP_CARRIED_TOPICS);

    const uncarried = Object.entries(TELEMACHUS_CLEAN_HOMES)
      .filter(([, target]) => !KNOWN_UNCARRIED.has(target))
      .filter(([, target]) => !isTopicCarried(store, carriedChannels, target))
      .map(([legacyKey, target]) => `${legacyKey} -> ${target}`)
      .sort();

    expect(uncarried).toEqual([]);
  });

  it("sanity check: the gate actually catches a regression", () => {
    // Removing science.experimentBreakdown (I2) from the carried list must
    // fail the assertion above — proves this test isn't vacuously green.
    const store = buildStore();
    const withoutScienceBreakdown = new Set(
      DEFAULT_SITREP_CARRIED_TOPICS.filter(
        (topic) => topic !== "science.experimentBreakdown",
      ),
    );
    expect(
      isTopicCarried(
        store,
        withoutScienceBreakdown,
        TELEMACHUS_CLEAN_HOMES["sci.experimentBreakdown"],
      ),
    ).toBe(false);
  });

  it("the allowlist contains no entry that is actually carried (no stale allowlisting)", () => {
    const store = buildStore();
    const carriedChannels = new Set(DEFAULT_SITREP_CARRIED_TOPICS);
    const staleAllowlisted = [...KNOWN_UNCARRIED].filter((target) =>
      isTopicCarried(store, carriedChannels, target),
    );
    expect(staleAllowlisted).toEqual([]);
  });
});
