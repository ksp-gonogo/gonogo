import {
  PropagationHorizonKindLike,
  TrajectoryFrameKindLike,
  TrajectoryKindLike,
  trajectoryFrameLabel,
} from "@ksp-gonogo/sitrep-client";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useOrbitPlaneTrajectory } from "./useOrbitPlaneTrajectory";

const SMA = 900_000;
const ECC = 0.3;

/** A steeply inclined, rotated orbit, where an arc left in the parent's axes would sit tilted against the flat conic. */
const INCLINED = {
  sma: SMA,
  ecc: ECC,
  inc: 63,
  lan: 40,
  argPe: 110,
  meanAnomalyAtEpoch: 1.1,
  epoch: 0,
  mu: 3.5316e12,
  horizon: {
    kind: PropagationHorizonKindLike.Until,
    trajectoryKind: TrajectoryKindLike.Integrated,
    untilUt: 5_000,
  },
};

function answers(): ReturnType<typeof useOrbitPlaneTrajectory>[] {
  const seen: ReturnType<typeof useOrbitPlaneTrajectory>[] = [];
  const fixture = setupStreamFixture({ pinnedUt: 0 });
  function Probe() {
    seen.push(useOrbitPlaneTrajectory({ ...INCLINED }));
    return null;
  }
  const view = render(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  view.rerender(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  return seen;
}

describe("useOrbitPlaneTrajectory", () => {
  it("keeps an inclined orbit's arc on its own conic, flat in the plane, named the orbit plane", () => {
    const [first] = answers();
    if (first?.shape !== "arc") throw new Error("expected an arc");
    const b = SMA * Math.sqrt(1 - ECC ** 2);
    for (const p of first.points) {
      expect(Math.abs(p.z)).toBeLessThan(1e-6);
      expect(((p.x + SMA * ECC) / SMA) ** 2 + (p.y / b) ** 2).toBeCloseTo(1, 9);
    }
    expect(first.frame.kind).toBe(TrajectoryFrameKindLike.Perifocal);
    expect(trajectoryFrameLabel(first.frame, undefined)).toBe("orbit plane");
  });

  it("hands back the same in-plane arc for every render inside one UT second", () => {
    const [first, second] = answers();
    expect(second).toBe(first);
  });
});
