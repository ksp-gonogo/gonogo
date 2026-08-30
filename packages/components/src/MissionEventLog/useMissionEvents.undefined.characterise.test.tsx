import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type { MissionEvent } from "./events";
import { useMissionEvents } from "./useMissionEvents";

/**
 * CHARACTERISATION. Records what `useMissionEvents` does TODAY when its
 * `useTelemetry` reads are `undefined`, ahead of the `Reading<T>` migration.
 * Nothing here is a statement about what the hook SHOULD do.
 *
 * The hook reads eleven topics and gives `undefined` three different meanings:
 *
 *   - `vessel.dock`: absence is a VALUE, "not docked", and after the migration
 *     only a CONFIRMED absence is (see that describe block)
 *   - `vessel.identity`: `isEvaType(undefined)` COERCES absence to type 0
 *   - `vessel.structure` / `vessel.orbit` / `career.status`: absence is
 *     "unknown", the detector declines to compare and no edge fires
 *
 * Under `Reading<T>` every one of those reads becomes a truthy object, so each
 * `?.` / `!= null` / `typeof` gate below stops gating. These tests fire the
 * gates, which is the only way the change becomes visible.
 */

const CARRIED = [
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
  "crash.lastCrash",
  "recovery.lastSummary",
  "vessel.structure",
  "vessel.orbit",
  "vessel.dock",
  "vessel.identity",
  "career.status",
  "system.vessels",
] as const;

const VIEW_UT = 1000;

const trees: Array<() => void> = [];

function renderEvents() {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  const hook = renderHook(() => useMissionEvents(), {
    wrapper: fixture.Provider,
  });
  trees.push(hook.unmount);
  return { fixture, hook };
}

/**
 * Emit, then open the next frame, both inside one `act`.
 *
 * `beginFrame` is not optional here: the store only re-samples on a frame, so
 * without it a "nothing was logged" assertion would pass because the sample had
 * not been read yet rather than because the gate declined.
 */
function feed(fixture: StreamFixture, topic: string, payload: unknown): void {
  act(() => {
    fixture.emit(topic, payload);
    fixture.store.beginFrame();
  });
}

function kinds(events: readonly MissionEvent[]): string[] {
  return events.map((e) => e.kind);
}

const DOCK_PAYLOAD = {
  relativePosition: { x: 1, y: 0, z: 0 },
  relativeVelocity: { x: 0, y: 0, z: 0 },
  distance: 12,
};

const ORBIT_PAYLOAD = {
  sma: 700000,
  ecc: 0,
  inc: 0,
  argPe: 0,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  referenceBodyIndex: 1,
};

afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
});

describe("useMissionEvents with nothing on the stream", () => {
  it("accumulates no events at all", () => {
    const { hook } = renderEvents();
    // Every Tier-A shaper takes `undefined` through `asObj` and answers null,
    // and every Tier-B detector declines, so the list is empty rather than
    // carrying a zero-stamped placeholder row.
    expect(hook.result.current).toEqual([]);
  });

  it("subscribes to no per-vessel reputation topic, because `roster?.vessels ?? []` is empty", () => {
    const { fixture, hook } = renderEvents();
    const guid = "aaaa-bbbb";
    // Pins `roster?.vessels ?? []`: with the roster read undefined there is no
    // guid to be sticky about, so not one `currency.<guid>.reputation`
    // subscription is opened. What the migration can break is the shape of the
    // read, so the assertion is on the subscription set the gate produces.
    expect(fixture.transport.isSubscribed(`currency.${guid}.reputation`)).toBe(
      false,
    );

    feed(fixture, "system.vessels", {
      vessels: [{ vesselId: guid, name: "Probe", vesselType: 3, situation: 3 }],
    });

    expect(fixture.transport.isSubscribed(`currency.${guid}.reputation`)).toBe(
      true,
    );
    // The roster itself logs nothing: it exists only to open those subscriptions.
    expect(hook.result.current).toEqual([]);
  });
});

describe("useMissionEvents: vessel.dock absence is read as a value only once confirmed", () => {
  /**
   * Recorded prior behaviour: "treats the never-arrived dock read as not-docked,
   * so the first dock sample IS a docking edge".
   *
   * `const docked = dock != null` read "no sample yet" as the boolean FALSE, and
   * that false seeded `prev.docked`, so the first dock sample of a session read
   * as a false to true transition and logged a Docked row even though no
   * undocked state had ever been observed. The reading type separates the two,
   * and a `pending` dock channel now seeds `undefined`, which `detectDocking`
   * declines to compare, the same way staging and SOI already treat "no sample
   * yet". A log that invents a docking nobody saw is worse than a log missing
   * the one docking that happened before its first frame.
   */
  it("declines the first dock sample, because no undocked state was ever observed", () => {
    const { fixture, hook } = renderEvents();
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "vessel.dock", DOCK_PAYLOAD);

    expect(kinds(hook.result.current)).toEqual([]);
  });

  it("logs the docking once an undocked state has actually been confirmed", () => {
    const { fixture, hook } = renderEvents();
    // The other half of the case above, and the half that keeps it from being a
    // widget that simply never logs a docking. `vessel.dock` declares
    // `AbsenceIsData`, so a real session tombstones the channel on the first
    // tick the craft is not docking: that confirmed empty is a boolean false,
    // and the payload after it is a real observed edge.
    feed(fixture, "vessel.dock", null);
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "vessel.dock", DOCK_PAYLOAD);

    expect(kinds(hook.result.current)).toEqual(["docking"]);
    expect(hook.result.current[0].label).toBe("Docked");
    expect(hook.result.current[0].ut).toBe(VIEW_UT);
  });

  /**
   * Recorded prior behaviour: "does not distinguish a null tombstone from a
   * never-arrived read: both are not-docked".
   *
   * `dock != null` collapsed the confirmed tombstone and the never-arrived case
   * onto one answer, so a tombstone logged an Undocked row exactly as a
   * never-arrived read would. It still logs that row, and for the first time it
   * does so for the right reason: the tombstone is the subject saying it is not
   * docking, which is an observation, while `pending` is silence.
   */
  it("distinguishes a confirmed tombstone from a never-arrived read: only the tombstone is not-docked", () => {
    const { fixture, hook } = renderEvents();
    feed(fixture, "vessel.dock", DOCK_PAYLOAD);
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "vessel.dock", null);

    // An undocking with no docking above it is the honest reading of this
    // sequence: the craft was seen docked and then seen not docked, and the
    // transition INTO docked was never on the wire.
    expect(kinds(hook.result.current)).toEqual(["undocking"]);
    expect(hook.result.current.map((e) => e.label)).toEqual(["Undocked"]);
  });
});

describe("useMissionEvents: vessel.identity absence is coerced to vessel type 0", () => {
  it("logs an EVA on the first identity sample, because the absent read counted as not-EVA", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "vessel.identity", { vesselType: 7, launchUt: 0 });

    // `isEvaType(identity?.vesselType)` answers 0 for an absent read, so
    // `prev.vType` is a confident "Ship" before any identity has arrived and
    // the first sample of an EVA kerbal reads as a transition INTO EVA.
    expect(kinds(hook.result.current)).toEqual(["eva"]);
    expect(hook.result.current[0].label).toBe("Kerbal on EVA");
  });
});

describe("useMissionEvents: value topics whose absence declines the comparison", () => {
  it("logs no staging row for the first vessel.structure sample, only for the second", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "vessel.structure", { currentStage: 3, stageCount: 4 });
    // `typeof structure?.currentStage === "number"` fails on an absent read, so
    // `prev.stage` is undefined and `detectStaging` declines. Unlike dock
    // above, absence here means "cannot compare" rather than a value.
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "vessel.structure", { currentStage: 2, stageCount: 4 });
    expect(kinds(hook.result.current)).toEqual(["staging"]);
    expect(hook.result.current[0].label).toBe("Staged (stage 2)");
  });

  it("logs no SOI change for the first vessel.orbit sample, only when the body index moves", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "vessel.orbit", ORBIT_PAYLOAD);
    // Same "cannot compare" reading of absence as staging: being in a sphere of
    // influence when the widget mounts is not entering one.
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "vessel.orbit", { ...ORBIT_PAYLOAD, referenceBodyIndex: 2 });
    expect(kinds(hook.result.current)).toEqual(["soi-change"]);
  });

  it("reports no completed contract and no science gain on the first career.status sample", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "career.status", {
      contracts: { completedRecent: [{ id: "c1", title: "First Contract" }] },
      economy: { science: 10 },
    });
    // `career?.contracts?.completedRecent` is undefined before the first
    // sample, and `detectContractsCompleted` needs BOTH sides to be arrays, so
    // a contract already complete when the widget mounts is never logged.
    // `detectScienceCollected` declines on the same absent-prev reasoning.
    expect(kinds(hook.result.current)).toEqual([]);

    feed(fixture, "career.status", {
      contracts: {
        completedRecent: [
          { id: "c1", title: "First Contract" },
          { id: "c2", title: "Second Contract" },
        ],
      },
      economy: { science: 15 },
    });
    expect([...kinds(hook.result.current)].sort()).toEqual([
      "contract-completed",
      "science-collected",
    ]);
    const labels = hook.result.current.map((e) => e.label);
    expect(labels).toContain("Contract complete: Second Contract");
    expect(labels).toContain("Science collected (+5)");
  });
});

describe("useMissionEvents: a Tier-A record that arrived with an undefined field", () => {
  it("drops the whole event when flight.started carries no ut", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "flight.started", { vesselName: "Mun Tester" });

    // A PARTIAL payload, not an absent one: the record arrived and names its
    // vessel, but `num(p?.ut)` is null so `fromFlightStarted` answers null and
    // the launch is indistinguishable from never having happened.
    expect(hook.result.current).toEqual([]);
  });

  it("drops a crash whose ut is undefined while keeping one that has it", () => {
    const { fixture, hook } = renderEvents();

    feed(fixture, "crash.lastCrash", {
      vesselName: "Doomed",
      cause: "impact",
    });
    expect(hook.result.current).toEqual([]);

    feed(fixture, "crash.lastCrash", {
      ut: 900,
      vesselName: "Doomed",
      cause: "impact",
    });
    expect(kinds(hook.result.current)).toEqual(["crash"]);
    expect(hook.result.current[0].ut).toBe(900);
  });
});
