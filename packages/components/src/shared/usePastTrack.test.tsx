import { PerfBudget } from "@ksp-gonogo/core";
import { pastTrack, type TrajectoryPoint } from "@ksp-gonogo/sitrep-client";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { usePastTrack } from "./usePastTrack";

const NOW = 1_000_000;
const WINDOW = 300;

const orbit = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0.01,
  inc: 0.3,
  lan: 0.2,
  argPe: 0.1,
  meanAnomalyAtEpoch: 0.4,
  epoch: NOW,
  mu: 3.5316e12,
};

let trail: readonly TrajectoryPoint[] = [];

function Probe({ frame }: { frame: typeof orbit }) {
  // A new object each render, as the widget's overlay of the reckoned phase makes it.
  trail = usePastTrack(WINDOW, { ...frame });
  return null;
}

function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: NOW - WINDOW - 1,
    suspendFrames: true,
  });
  fixture.client.subscribe("vessel.orbit", () => {});
  const view = render(
    <fixture.Provider>
      <Probe frame={orbit} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

function deliver(fixture: ReturnType<typeof setupStreamFixture>, utc: number) {
  fixture.transport.emit(
    "vessel.orbit",
    { ...orbit, epoch: utc, meanAnomalyAtEpoch: 0.4 + (utc - NOW) * 1e-4 },
    { validAt: utc, deliveredAt: utc },
  );
}

describe("usePastTrack", () => {
  it("solves a stored sample once, however many frames the window slides over it", async () => {
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("usePastTrack"),
    );
    if (!budget) throw new Error("the usePastTrack budget is not registered");
    const { fixture } = mount();
    // One sample every five seconds across the window and a little beyond.
    for (let t = NOW - WINDOW - 10; t <= NOW + 5; t += 5) deliver(fixture, t);
    act(() => fixture.scrubTo(NOW));
    expect(trail.length).toBeGreaterThan(40);
    budget.reset();
    for (let i = 1; i <= 60; i++) {
      act(() => fixture.scrubTo(NOW + i / 60));
    }
    // Nothing new arrived, and one sample leaving the window needs no solve.
    expect(budget.windowTotal()).toBe(0);
  });

  it("draws the same trail pastTrack does over the same samples, through a tombstone and a change of body", async () => {
    const { fixture } = mount();
    for (let t = NOW - WINDOW; t <= NOW; t += 10) {
      const meta = { validAt: t, deliveredAt: t };
      const lostOrbit = t === NOW - 200;
      const otherBody = t === NOW - 100 || t === NOW - 90;
      fixture.transport.emit(
        "vessel.orbit",
        lostOrbit ? null : { ...orbit, referenceBodyIndex: otherBody ? 2 : 1 },
        meta,
      );
    }
    act(() => fixture.scrubTo(NOW));
    const samples =
      fixture.store.sampleRange<Record<string, unknown>>(
        "vessel.orbit",
        NOW - WINDOW,
        NOW,
      ) ?? [];
    const expected = pastTrack(
      samples.map((s) => ({ payload: s.payload as never, validAt: s.validAt })),
      { frame: orbit, centreBodyIndex: 1 },
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(samples.length - 2);
    expect(trail).toEqual(expected);
  });
});
