// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, setupStreamFixture } from "../testing";
import { deriveCelestialFacts } from "./celestial-facts";
import { PropagationHorizonKindLike, TrajectoryKindLike } from "./kepler";
import type { OrbitTrajectory } from "./orbit-trajectory";
import { useOrbitCurve } from "./use-orbit-curve";

function entry(
  index: number,
  name: string,
  parentIndex: number | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    index,
    name,
    parentIndex,
    gravParameter: { magnitude: index === 0 ? 1.3e20 : 3.9e14 },
    orbit:
      parentIndex === undefined
        ? undefined
        : {
            sma: { magnitude: 3.8e8 },
            ecc: { magnitude: 0.05 },
            inc: { magnitude: 5 },
            lan: { magnitude: 0 },
            argPe: { magnitude: 0 },
            meanAnomalyAtEpoch: { magnitude: 0 },
            epoch: { magnitude: 0 },
          },
    ...extra,
  };
}

const FACTS = deriveCelestialFacts([
  entry(0, "Star", undefined),
  entry(1, "Home", 0),
  entry(2, "Moon", 1, {
    horizon: {
      kind: PropagationHorizonKindLike.Until,
      trajectoryKind: TrajectoryKindLike.Integrated,
      untilUt: 200_000,
    },
  }),
] as never);

function mount(index: number) {
  const answers: (OrbitTrajectory | null)[] = [];
  const stream = setupStreamFixture({ pinnedUt: 10.2 });
  function Probe() {
    answers.push(useOrbitCurve({ kind: "body", facts: FACTS, index }));
    return null;
  }
  const tree = () => (
    <stream.Provider>
      <Probe />
    </stream.Provider>
  );
  const view = render(tree());
  view.rerender(tree());
  return answers;
}

describe("useOrbitCurve for a catalogue body", () => {
  it("answers an integrating body with an arc to its horizon, held between renders", () => {
    const [first, second] = mount(2);
    expect(first?.shape).toBe("arc");
    if (first?.shape !== "arc") return;
    expect(first.farEnd).toBe("horizon");
    expect(first.frame.centreBodyIndex).toBe(1);
    expect(second).toBe(first);
  });

  it("answers a fixed-orbit body with the conic", () => {
    expect(mount(1)[0]?.shape).toBe("conic");
  });

  it("has no curve for the root star", () => {
    expect(mount(0)[0]).toBeNull();
  });
});
