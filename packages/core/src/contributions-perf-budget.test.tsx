import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WidgetMetaContext } from "./contexts/WidgetMetaContext";
import { clearContributions, registerContribution } from "./contributions";
import {
  ContributionsProvider,
  useContributions,
} from "./contributionsRuntime";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "fixture.perf": { entry: { id: string; label: string }; topics: never };
  }
}

/**
 * One second of animation frames. The budget's window is 1000 ms and the frame
 * clock is `requestAnimationFrame`, so this is exactly the load a widget puts on
 * the slot by sitting on screen for a second with nothing happening.
 */
const FRAMES_PER_SECOND = 60;

beforeEach(() => {
  clearContributions();
});

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const unmount of mounted) unmount();
  mounted.length = 0;
});

/** Every per-slot budget `getSlotPerfBudget` has lazily created so far. */
function contributionBudgets(): readonly PerfBudget[] {
  return PerfBudget.getAll().filter((b) => b.name.startsWith("Contributions "));
}

function budgetFor(slot: string): PerfBudget {
  const name = `Contributions "${slot}" entries recomputed/sec`;
  const budget = contributionBudgets().find((b) => b.name === name);
  if (!budget) throw new Error(`no budget registered for slot ${slot}`);
  return budget;
}

function Rows(): ReactElement {
  const rows = useContributions("fixture.perf");
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.contributionId}>{r.label}</li>
      ))}
    </ul>
  );
}

/** Mounts one widget declaring the fixture slot, with frames under the test's control. */
function mountWidget(): { frame: () => void } {
  const client = new TelemetryClient(new StubTransport());
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  // The clock's own rAF loop mints frames on its own schedule, which would make
  // the count this test asserts on a function of how long the machine took.
  clock.suspendFrames();
  const store = new TimelineStore(clock);

  const { unmount } = render(
    <TelemetryProvider client={client} store={store}>
      <WidgetMetaContext.Provider
        value={{
          componentId: "perf-fixture-widget",
          contributionSlots: ["fixture.perf"] as const,
        }}
      >
        <ContributionsProvider>
          <Rows />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </TelemetryProvider>,
  );
  mounted.push(unmount);
  // One `act` per frame: batched into a single one, React would coalesce the
  // sixty notifications into one render and the aggregation would run once.
  return { frame: () => act(() => store.beginFrame()) };
}

describe("the contribution slot perf budget", () => {
  it("does not fire on a widget that merely stays mounted for a second of frames", () => {
    registerContribution({
      id: "steady",
      contributes: "fixture.perf",
      compute: () => [{ id: "row", label: "steady" }],
    });

    const { frame } = mountWidget();
    for (let i = 0; i < FRAMES_PER_SECOND; i++) frame();

    // Every slot this widget aggregates, the universal segments included: a
    // widget with no contributions at all on a segment still ran the pipeline
    // for it, and that was the shape CI went red on. One record is allowed:
    // the seeding write that puts the slot's first entry set in the store.
    const busy = contributionBudgets()
      .filter((b) => b.rate() > 1 || b.getExceedanceCount() > 0)
      .map(
        (b) =>
          `${b.name}: rate=${b.rate()} exceedances=${b.getExceedanceCount()}`,
      );
    expect(busy).toEqual([]);
  });

  it("still fires on a slot whose entries genuinely change on every frame", () => {
    let n = 0;
    registerContribution({
      id: "spinning",
      contributes: "fixture.perf",
      compute: () => [{ id: "row", label: `spin ${n++}` }],
    });

    const budgetsBefore = new Map(
      contributionBudgets().map((b) => [b.name, b.getExceedanceCount()]),
    );
    const { frame } = mountWidget();
    for (let i = 0; i < FRAMES_PER_SECOND; i++) frame();

    const budget = budgetFor("fixture.perf");
    expect(budget.rate()).toBeGreaterThan(budget.threshold);
    expect(budget.getExceedanceCount()).toBeGreaterThan(
      budgetsBefore.get(budget.name) ?? 0,
    );

    // This test trips the budget on purpose, which is what the global gate in
    // `PerfBudget.installTestGate` exists to fail on. Resetting the one budget
    // this test drove is the sanctioned form (see that method's own doc). It is
    // not the harness-wide reset f3aa5adbd reverted: that one sat in the
    // snapshot harness and hid a genuine spin on every widget that ran through
    // it, and never even executed on the test that provoked it.
    budget.reset();
  });
});
