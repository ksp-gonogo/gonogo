import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox, settleRendezvous } from "../test/rendezvousBox";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RendezvousComponent } from "./index";

let restoreBox: (() => void) | undefined;

beforeEach(() => {
  restoreBox = installRendezvousBox();
});

afterEach(() => {
  restoreBox?.();
  clearActionHandlers();
});

const ANALYTIC = 1;
const UNSPECIFIED = 0;
const INTEGRATED = 2;

function orbit(trajectoryKind: number) {
  return {
    referenceBodyIndex: 1,
    sma: 700_000,
    ecc: 0.0001,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 1,
    epoch: 0,
    mu: 3_531_600_000_000,
    timeToAp: null,
    timeToPe: null,
    encounter: null,
    patches: [],
    horizon: { kind: 1, trajectoryKind },
    meta: { source: "vessel:chaser", quality: 0 },
  };
}

async function mountApproach(flown: number, approach: number) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rdv-two-body" }}>
        <RendezvousComponent id="rdv-two-body" w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", orbit(flown));
    fixture.emit("vessel.target", {
      name: "Test Station",
      kind: 0,
      vesselId: "target-vessel",
      bodyIndex: null,
      relativePosition: { x: 0, y: 0, z: 1800 },
      relativeVelocity: { x: 0, y: 0, z: -4.7 },
      closestApproach: { time: 125, distance: 31.5, trajectoryKind: approach },
    });
  });
  await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
}

describe("Rendezvous: a closest approach under integrated physics", () => {
  it("marks a two-body approach on an integrated trajectory", async () => {
    await mountApproach(INTEGRATED, ANALYTIC);
    await waitFor(() => expect(screen.getByText("Two-body")).toBeTruthy());
    await settleRendezvous();
  });

  it("does not mark it where the craft flies its conic", async () => {
    await mountApproach(ANALYTIC, ANALYTIC);
    expect(screen.queryByText("Two-body")).toBeNull();
    await settleRendezvous();
  });

  it("does not mark the straight-line figure the mod gives under 2 km, which it labels unspecified", async () => {
    await mountApproach(INTEGRATED, UNSPECIFIED);
    expect(screen.queryByText("Two-body")).toBeNull();
    await settleRendezvous();
  });

  it("does not mark an approach taken from integrated trajectories", async () => {
    await mountApproach(INTEGRATED, INTEGRATED);
    expect(screen.queryByText("Two-body")).toBeNull();
    await settleRendezvous();
  });
});
