// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act, render, setupStreamFixture } from "../testing";
import { PropagationHorizonKindLike, TrajectoryKindLike } from "./kepler";
import type { OrbitTrajectory } from "./orbit-trajectory";
import { useOrbitTrajectory } from "./use-orbit-trajectory";

const KERBIN_MU = 3.5316e12;

/** A fresh object per call, as a widget that merges a reckoned overlay over the observation builds one on every render. */
function orbit(untilUt = 3000) {
  return {
    sma: 850_000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: KERBIN_MU,
    horizon: {
      kind: PropagationHorizonKindLike.Until,
      trajectoryKind: TrajectoryKindLike.Integrated,
      untilUt,
    },
  };
}

function mount(pinnedUt: number) {
  const answers: (OrbitTrajectory | null)[] = [];
  const stream = setupStreamFixture({ pinnedUt });
  function Probe({ untilUt }: Readonly<{ untilUt?: number }>) {
    answers.push(useOrbitTrajectory(orbit(untilUt)));
    return null;
  }
  const view = render(
    <stream.Provider>
      <Probe />
    </stream.Provider>,
  );
  const rerender = (untilUt?: number) =>
    view.rerender(
      <stream.Provider>
        <Probe untilUt={untilUt} />
      </stream.Provider>,
    );
  return { answers, stream, rerender };
}

describe("useOrbitTrajectory holding", () => {
  it("returns the same answer for every render inside one UT second", () => {
    const { answers, stream, rerender } = mount(100.1);
    act(() => stream.store.clock.scrubTo(100.8));
    rerender();
    rerender();
    const [first, ...rest] = answers;
    expect(first?.shape).toBe("arc");
    for (const a of rest) expect(a).toBe(first);
  });

  it("answers afresh when the second turns over", () => {
    const { answers, stream, rerender } = mount(100.1);
    act(() => stream.store.clock.scrubTo(101.2));
    rerender();
    expect(answers.at(-1)).not.toBe(answers[0]);
  });

  it("answers afresh when the horizon moves", () => {
    const { answers, rerender } = mount(100.1);
    rerender(4000);
    expect(answers.at(-1)).not.toBe(answers[0]);
  });
});
