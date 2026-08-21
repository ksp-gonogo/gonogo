import { useProcessor } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CREW_SURVIVAL } from "./CrewSurvival/processor";
import { SHIP_SYSTEMS } from "./processor";

// ---------------------------------------------------------------------------
// The two REAL registered processors, against the real spine, counting what a
// consumer is actually handed rather than whether the number in it is right.
//
// Both `compute`s allocate: `SHIP_SYSTEMS` builds a `Summary` plus a `levels`
// record, `CREW_SURVIVAL` builds a `kerbals` array. Under identity comparison
// that is a brand-new snapshot on every frame with nothing on the wire having
// moved, so every consumer of either one re-rendered at frame rate forever.
// A test asserting the CONTENT of those snapshots passes either way, which is
// why these count HANDOVERS: how many times the snapshot a mounted consumer
// holds was replaced with a different one.
// ---------------------------------------------------------------------------

const CARRIED = [
  "kerbalism.profile",
  "kerbalism.lifesupport",
  "vessel.resources",
  "vessel.crew",
  "kerbalism.crew",
];

const PROFILE = {
  name: "Test Profile",
  resources: {
    Oxygen: { flowMode: "ALL_VESSEL", displayName: "Oxygen", isSupply: true },
    ElectricCharge: {
      flowMode: "ALL_VESSEL_BALANCE",
      displayName: "Electric Charge",
      isSupply: true,
    },
  },
  rules: [],
  processes: [],
};

const LIFE_SUPPORT = {
  rates: { Oxygen: -0.0005, ElectricCharge: -0.05 },
  habitat: { pressure: 0.9, poisoning: 0.05, comfort: 0.6, livingSpace: 0.7 },
  processes: [],
  greenhouses: [],
};

// Per-test oxygen levels. The evaluator's runtime is a module singleton with no
// published reset, so a processor's last value survives into the next test in
// this file: identical payloads would leave the first frame's result EQUAL to
// the leftover one and silently swallow a handover that really happened. Every
// test therefore emits a level nothing before it emitted.
function resourcesAt(oxygen: number) {
  return {
    resources: {
      Oxygen: { current: oxygen, max: 400, active: true },
      ElectricCharge: { current: 20, max: 400, active: true },
    },
    meta: { source: "test", quality: 1 },
  };
}

const CREW = {
  count: 2,
  capacity: 4,
  crew: [
    { name: "Jebediah Kerman", trait: "Pilot" },
    { name: "Bill Kerman", trait: "Engineer" },
  ],
  meta: { source: "test", quality: 1 },
};

const KERBALISM_CREW = [
  {
    name: "Jebediah Kerman",
    rules: [{ name: "radiation", fraction: 0.1, fatal: true }],
    deathClockUt: 90_000,
  },
  {
    name: "Bill Kerman",
    rules: [{ name: "stress", fraction: 0.4, fatal: false }],
    deathClockUt: null,
  },
];

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
});

function newFixture(pinnedUt?: number) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt });
  for (const topic of CARRIED) fixture.subscribe(topic);
  return fixture;
}

function emitAll(fixture: ReturnType<typeof newFixture>, oxygen: number) {
  act(() => {
    fixture.emit("kerbalism.profile", PROFILE);
    fixture.emit("kerbalism.lifesupport", LIFE_SUPPORT);
    fixture.emit("vessel.resources", resourcesAt(oxygen));
    fixture.emit("vessel.crew", CREW);
    fixture.emit("kerbalism.crew", KERBALISM_CREW);
  });
}

/**
 * Mount a consumer of `handle` and count how many times the snapshot it holds
 * is replaced by a different one.
 *
 * Counting HANDOVERS rather than renders, because `useSyncExternalStore` can
 * re-run a render for reasons of its own; and rather than distinct values,
 * because the evaluator's runtime survives between tests in this file and the
 * absolute count would then depend on what ran before.
 */
function watch(
  fixture: ReturnType<typeof newFixture>,
  handle: { id: string },
): { readonly handovers: number } {
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useProcessor(handle));
    return null;
  }
  const result = render(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  unmounts.push(result.unmount);
  return {
    get handovers() {
      let count = 0;
      for (let i = 1; i < seen.length; i++) {
        if (seen[i] !== seen[i - 1]) count++;
      }
      return count;
    },
  };
}

function runFrames(fixture: ReturnType<typeof newFixture>, count: number) {
  for (let i = 0; i < count; i++) {
    act(() => {
      fixture.store.beginFrame();
    });
  }
}

describe("the registered Kerbalism processors, on a still wire", () => {
  it("hands SHIP_SYSTEMS' consumer one snapshot, not one per frame", () => {
    const fixture = newFixture(10);
    const watched = watch(fixture, SHIP_SYSTEMS);
    emitAll(fixture, 380);
    runFrames(fixture, 20);

    // The one derivation, and then nothing: twenty frames over an unmoving
    // wire is twenty chances to wake every consumer for no reason, and that is
    // the defect this counts.
    expect(watched.handovers).toBe(1);
  });

  it("hands CREW_SURVIVAL's consumer one snapshot, not one per frame", () => {
    const fixture = newFixture(10);
    const watched = watch(fixture, CREW_SURVIVAL);
    emitAll(fixture, 379);
    runFrames(fixture, 20);

    expect(watched.handovers).toBe(1);
  });

  it("still hands over a new snapshot when the wire actually moves", () => {
    const fixture = newFixture(10);
    const watched = watch(fixture, SHIP_SYSTEMS);
    emitAll(fixture, 378);
    runFrames(fixture, 5);

    act(() => {
      // Later than the first emission and still at-or-before the pinned view
      // time, so the store's confirmed edge actually reaches it. Re-emitting at
      // the same `validAt` is not a newer observation.
      fixture.emit("vessel.resources", resourcesAt(200), {
        validAt: 5,
        deliveredAt: 5,
      });
    });
    runFrames(fixture, 5);

    // The counterweight: silencing a processor whose input genuinely changed
    // would be a worse defect than the churn.
    expect(watched.handovers).toBe(2);
  });
});

describe("the registered Kerbalism processors, on an advancing wire", () => {
  it("keeps handing SHIP_SYSTEMS' consumer new snapshots when the SAME levels arrive at a later UT", () => {
    // The levels are byte-identical every time; only the observation's UT moves.
    // `SHIP_SYSTEMS` carries `levels.asOfUt`/`ageSec` precisely so a consumer
    // can tell a fresh reading from a twenty-minute-old one, so a later
    // observation of the same numbers IS a different answer and must be
    // delivered. Gating on the RESULT rather than on the inputs is what keeps
    // this true; it is also what keeps a view-time-driven countdown from
    // freezing.
    const fixture = newFixture();
    const watched = watch(fixture, SHIP_SYSTEMS);
    emitAll(fixture, 377);
    runFrames(fixture, 1);

    for (let ut = 1; ut <= 5; ut++) {
      act(() => {
        fixture.wall.advanceBy(1);
        fixture.emit("vessel.resources", resourcesAt(377), {
          validAt: ut,
          deliveredAt: ut,
        });
        fixture.store.beginFrame();
      });
    }

    // The first derivation, then one per later observation.
    expect(watched.handovers).toBe(6);
  });
});
