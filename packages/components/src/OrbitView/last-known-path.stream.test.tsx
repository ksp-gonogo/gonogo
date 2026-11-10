import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * Past the span its conic is vouched for, OrbitView draws the integrated path from
 * the state the command centre last heard. Under stock physics no such span exists,
 * so nothing is asked.
 */
const PINNED_UT = 1000;
const COMMAND = "vessel.trajectory.fromLastKnown";

function orbit(horizon: object) {
  return {
    referenceBodyIndex: 1,
    sma: 700000,
    ecc: 0.001,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: PINNED_UT,
    mu: 3.5316e12,
    horizon,
  };
}

function mount(horizon: object, answer: (args: unknown) => unknown) {
  const fixture = setupStreamFixture({ pinnedUt: PINNED_UT });
  const asked: unknown[] = [];
  fixture.transport.setCommandHandler((command, args) => {
    if (command === COMMAND) {
      asked.push(args);
      return answer(args);
    }
    return undefined;
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-path" }}>
        <OrbitViewComponent id="ov-path" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [{ name: "Kerbin", index: 1, radius: 600000 }],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Test Vessel",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", orbit(horizon));
  });
  return { ...view, asked, emit: fixture.emit };
}

/** A quarter of an orbit that does not lie on the conic, so drawing it shows it was used. */
const INTEGRATED_REPLY = {
  solved: true,
  seededAtUt: PINNED_UT - 40,
  vantage: "home",
  path: {
    solved: true,
    kind: 2,
    centreBodyIndex: 1,
    reachedUt: PINNED_UT + 500,
    states: [0, 1, 2, 3].map((i) => ({
      ut: PINNED_UT - 40 + i * 180,
      x: 712345 * Math.cos(i * 0.5),
      y: 712345 * Math.sin(i * 0.5),
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    })),
  },
};

function arcPoints(container: HTMLElement): number {
  const d =
    container.querySelector("svg path[data-trajectory]")?.getAttribute("d") ??
    "";
  return d === "" ? 0 : d.split("L").length;
}

describe("OrbitView past the span its conic is vouched for", () => {
  it("draws the integrated path in place of the stopped conic", async () => {
    const { container, asked } = mount(
      integratedHorizon(PINNED_UT + 200),
      () => INTEGRATED_REPLY,
    );
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await waitFor(() => expect(arcPoints(container)).toBe(4));
    await act(async () => {});
  });

  it("keeps the stopped conic when the provider refuses", async () => {
    const { container, asked } = mount(
      integratedHorizon(PINNED_UT + 200),
      () => ({
        solved: false,
        refusal: "The provider cannot run on this machine.",
      }),
    );
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await waitFor(() => expect(arcPoints(container)).toBeGreaterThan(8));
    await act(async () => {});
  });

  it("keeps drawing the path and asks again while the provider is still working", async () => {
    let calls = 0;
    const { container, asked } = mount(
      integratedHorizon(PINNED_UT + 200),
      () => {
        calls += 1;
        return calls === 1
          ? { solved: false, stillWorking: true, refusal: "Ask again shortly." }
          : INTEGRATED_REPLY;
      },
    );
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await waitFor(() => expect(arcPoints(container)).toBe(4), {
      timeout: 3000,
    });
    expect(asked.length).toBeGreaterThanOrEqual(2);
    await act(async () => {});
  });

  it("takes the path off as soon as the provider's Uplink reports trouble", async () => {
    let failed = false;
    const { container, asked, emit } = mount(
      integratedHorizon(PINNED_UT + 200),
      () =>
        failed
          ? { solved: false, refusal: "The provider stopped." }
          : INTEGRATED_REPLY,
    );
    await waitFor(() => expect(arcPoints(container)).toBe(4));
    const askedBefore = asked.length;

    failed = true;
    act(() => {
      emit("system.uplinks", {
        uplinks: [
          {
            id: "an-integrating-uplink",
            version: "1.0.0",
            available: true,
            reason: null,
            ownedPrefixes: [],
            health: { state: 1, detail: "The provider stopped.", facts: [] },
          },
        ],
      });
    });

    await waitFor(() => expect(arcPoints(container)).toBeGreaterThan(8));
    expect(asked.length).toBeGreaterThan(askedBefore);
    await act(async () => {});
  });

  it("asks for nothing under stock physics", async () => {
    const { container, asked } = mount(ANALYTIC_UNBOUNDED_HORIZON, () => {
      throw new Error("stock should not ask");
    });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    await act(async () => {});
    expect(asked).toEqual([]);
  });
});
