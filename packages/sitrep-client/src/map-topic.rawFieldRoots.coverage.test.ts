import { describe, expect, it } from "vitest";
import { TELEMACHUS_CLEAN_HOMES } from "./map-topic";

/**
 * M3 batch-1 harness hardening: guards the structural assumption
 * `TimelineStore.resolveRawFieldSubtopic` (`timeline-store.ts`) bakes in —
 * that any `mapTopic` target of the raw-field form `<domain>.<channel>.
 * <field...>` (3+ dot segments, NOT a derived-channel field subtopic) names
 * a REAL raw wire topic at its first two segments. `resolveRawFieldSubtopic`
 * mechanically splits a 3+-segment topic into `rawTopic = "<domain>.
 * <channel>"` + the rest as a field path to walk — it does NOT check that
 * `rawTopic` is anything a transport actually publishes. A future
 * `TELEMACHUS_CLEAN_HOMES` entry that gets the root wrong (typo, or a
 * channel that doesn't exist yet) would subscribe to a topic nothing ever
 * emits and resolve to a silent, permanent `undefined` — exactly the failure
 * class `sampleRawFieldSubtopic`'s own doc comment flags as NOT caught by
 * `isUnresolvableField` (that guard only covers the derived-channel phantom-
 * field case, see the comment there). This test is the missing static check
 * for the raw-field half of that same risk. The exact bug this test would
 * have caught: the M3 batch-1 `vessel.resources` fix (see `map-topic.ts`'s
 * doc comment on the resource regex) was a field-PATH bug inside a correct
 * root, one layer deeper than what this test checks — this test guards the
 * ROOT only, which is the cheap, mechanically-checkable half of the
 * contract.
 *
 * No canonical TypeScript list of raw wire topic roots exists anywhere in
 * the repo (unlike the sibling coverage tests, which derive their truth by
 * calling real production code — `deriveVesselState` for
 * `vessel-state-mapping.coverage.test.ts`, a source scan for
 * `mapTopic.coverage.test.ts` in `@gonogo/core`). The only source of truth
 * for "what does the mod actually publish" is C#:
 * `mod/Sitrep.Host/VesselViewProvider.cs`'s `Topics` (15 `vessel.*`/
 * `time.warp` constants) and `mod/Sitrep.Host/SystemViewProvider.cs`'s
 * `Topic` (`"system.bodies"`). Mirrored here as a hardcoded set — update it
 * if/when a new channel provider lands.
 */
const RAW_WIRE_TOPIC_ROOTS: ReadonlySet<string> = new Set([
  "vessel.identity",
  "vessel.orbit",
  "vessel.orbit.truth",
  "vessel.flight",
  "vessel.attitude",
  "vessel.resources",
  "vessel.thermal",
  "vessel.control",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.maneuver",
  "vessel.target",
  "vessel.crew",
  "vessel.structure",
  // M3 R3 capture-adds (VesselViewProvider.cs's DockTopic/SurfaceTopic).
  "vessel.dock",
  "vessel.surface",
  "time.warp",
  "system.bodies",
  // SystemViewProvider.cs's VesselsTopic (M3 vessel-gap batch roster add).
  "system.vessels",
  // CareerViewProvider.cs's Topic (M3 career batch).
  "career.status",
  // Comms uplink channels (CommsCoreUplink / RealAntennasUplink). comms.delay
  // is the TrueNow signal-delay channel behind comm.signalDelay.
  "comms.delay",
]);

/**
 * Derived-channel topics — `TimelineStore.collectSubscriptionTopics` routes
 * a topic through `resolveDerivedTopic` FIRST; only when that misses does a
 * 3+-segment topic ever reach `resolveRawFieldSubtopic`. A target under one
 * of these roots (`vessel.state.altitudeAsl`, etc.) is therefore out of this
 * convention's scope entirely — it's checked instead by
 * `vessel-state-mapping.coverage.test.ts`. Mirrors `context.tsx`'s
 * `PRODUCTION_DERIVED_CHANNELS` (not exported, so hardcoded here rather than
 * imported — `vesselStateChannel` (`"vessel.state"`) and `systemStateChannel`
 * (`"system.state"`)).
 */
const DERIVED_CHANNEL_ROOTS: ReadonlySet<string> = new Set([
  "vessel.state",
  "system.state",
]);

function firstTwoSegments(topic: string): string {
  return topic.split(".").slice(0, 2).join(".");
}

function isRawFieldForm(target: string): boolean {
  return (
    target.split(".").length >= 3 &&
    !DERIVED_CHANNEL_ROOTS.has(firstTwoSegments(target))
  );
}

describe("mapTopic raw-field-subtopic convention — every CLEAN_HOMES raw-field target has a real raw wire-topic root", () => {
  it("sanity: found a non-trivial number of raw-field-form targets (scan sanity check)", () => {
    const rawFieldTargets = Object.values(TELEMACHUS_CLEAN_HOMES).filter(
      isRawFieldForm,
    );
    expect(rawFieldTargets.length).toBeGreaterThan(10);
  });

  it("every raw-field target's <domain>.<channel> root is a real published wire topic", () => {
    const badRoots = Object.entries(TELEMACHUS_CLEAN_HOMES)
      .filter(([, target]) => isRawFieldForm(target))
      .map(([key, target]) => ({
        key,
        target,
        root: firstTwoSegments(target),
      }))
      .filter(({ root }) => !RAW_WIRE_TOPIC_ROOTS.has(root));

    expect(badRoots).toEqual([]);
  });
});
