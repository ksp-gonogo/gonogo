import { describe, expect, it } from "vitest";
import { TELEMACHUS_CLEAN_HOMES } from "./map-topic";

/**
 * Harness hardening: guards the structural assumption
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
 * have caught: the `vessel.resources` fix (see `map-topic.ts`'s
 * doc comment on the resource regex) was a field-PATH bug inside a correct
 * root, one layer deeper than what this test checks — this test guards the
 * ROOT only, which is the cheap, mechanically-checkable half of the
 * contract.
 *
 * No canonical TypeScript list of raw wire topic roots exists anywhere in
 * the repo (unlike the sibling coverage tests, which derive their truth by
 * calling real production code — `deriveVesselState` for
 * `vessel-state-mapping.coverage.test.ts`, a source scan for
 * `mapTopic.coverage.test.ts` in `@ksp-gonogo/core`). The only source of truth
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
  // VesselViewProvider.cs's DockTopic/SurfaceTopic capture-adds.
  "vessel.dock",
  "vessel.surface",
  "time.warp",
  "system.bodies",
  // SystemViewProvider.cs's VesselsTopic (roster add).
  "system.vessels",
  // CareerViewProvider.cs's Topic.
  "career.status",
  // CareerViewProvider.cs's ModeTopic (client-derivations, D1).
  "career.mode",
  // Comms uplink channels (CommsCoreUplink / RealAntennasUplink). comms.delay
  // is the TrueNow signal-delay channel behind comm.signalDelay.
  "comms.delay",
  // Remaining raw-field-walk roots.
  // SystemViewProvider.cs's DlcTopic (deployed.available).
  "game.dlc",
  // PartsViewProvider.cs's RoboticsAvailableTopic (robotics.available).
  "robotics.available",
  // SystemViewProvider.cs's RevertTopic (ksp.canRevertToEditor/Launch).
  "ksp.revertAvailability",
  // SpaceCenterViewProvider.cs's SceneTopic (kc.scene).
  "spaceCenter.scene",
  // StageDeltaVViewProvider.cs's summary topic (dv.stageCount/totalDV*).
  "dv.summary",
  // SpaceCenterViewProvider.cs's PartsAvailableTopic (kc.partsAvailable).
  "spaceCenter.partsAvailable",
]);

/**
 * Derived-channel topics — `TimelineStore.collectSubscriptionTopics` routes
 * a topic through `resolveDerivedTopic` FIRST; only when that misses does a
 * 3+-segment topic ever reach `resolveRawFieldSubtopic`. A target under one
 * of these roots (`vessel.state.altitudeAsl`, etc.) is therefore out of this
 * convention's scope entirely — it's checked instead by
 * `vessel-state-mapping.coverage.test.ts`. Mirrors `context.tsx`'s
 * `PRODUCTION_DERIVED_CHANNELS` (not exported, so hardcoded here rather than
 * imported — `vesselStateChannel` (`"vessel.state"`), `systemStateChannel`
 * (`"system.state"`), `spaceCenterStateChannel` (`"spaceCenter.state"`) and
 * `dvLegacyScalarsChannel` (`"dv.legacyScalars"`)).
 */
const DERIVED_CHANNEL_ROOTS: ReadonlySet<string> = new Set([
  "vessel.state",
  "system.state",
  // spaceCenterStateChannel ("spaceCenter.state") — the kc.padOccupied/
  // kc.padVesselTitle pair derived off spaceCenter.launchSites.
  "spaceCenter.state",
  // dvLegacyScalarsChannel ("dv.legacyScalars") — the
  // total/current/currentFuelMass/totalMass rollup off dv.stages +
  // vessel.structure.currentStage (dv-legacy-scalars.ts).
  "dv.legacyScalars",
]);

/**
 * Raw topics whose OWN registered `[SitrepTopic(...)]` name is already 3
 * segments — the rare exception to every other raw topic's `domain.channel`
 * convention (`VesselViewProvider.PhysicsModeTopic` is literally
 * `"vessel.physics.mode"`, not `"vessel.physics"` + a `mode` field). A
 * `TELEMACHUS_CLEAN_HOMES` target that is EXACTLY one of these strings (no
 * further field suffix) is a WHOLE-topic identity read — `sample()`'s literal
 * `timelineFor(topic)` lookup (`timeline-store.ts`) matches it directly
 * before `resolveRawFieldSubtopic` is ever consulted, so `firstTwoSegments`'s
 * "first two segments are the real topic" assumption doesn't apply here.
 * Checked by EXACT match, not prefix — a genuine field suffix beyond one of
 * these (e.g. a hypothetical `"vessel.physics.mode.someField"`) is NOT
 * expressible through this convention at all and would still correctly fail
 * this test if attempted. No current `TELEMACHUS_CLEAN_HOMES` target maps to
 * `"vessel.physics.mode"` (the Principia mod-seam revert removed the one
 * that did — see `map-topic.ts`'s `a.physicsMode` comment) — this set stays
 * as the general 3-segment-topic exception mechanism for whichever mapping
 * lands next.
 */
const THREE_SEGMENT_WHOLE_TOPICS: ReadonlySet<string> = new Set([
  "vessel.physics.mode",
]);

function firstTwoSegments(topic: string): string {
  return topic.split(".").slice(0, 2).join(".");
}

function isRawFieldForm(target: string): boolean {
  return (
    target.split(".").length >= 3 &&
    !DERIVED_CHANNEL_ROOTS.has(firstTwoSegments(target)) &&
    !THREE_SEGMENT_WHOLE_TOPICS.has(target)
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
