import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * Pins the four meanings ManeuverPlanner gives an absent telemetry read:
 *
 *  1. "no orbit has arrived, wait"     -> the awaiting-orbit empty state
 *  2. "there is no target set"         -> a confident "No target selected in-game."
 *  3. "there is no delta-V"            -> coerced to 0, then 0 is a null-display sentinel
 *  4. "no stream node id yet"          -> refuses the command and says so
 */

const PINNED_UT = 1_000_000;

// Unmounted before the fixture goes, whose disposal would otherwise update a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

function renderTracked(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function setup(config: Record<string, unknown> = {}) {
  const fixture = setupStreamFixture({
    pinnedUt: PINNED_UT,
    suspendFrames: true,
  });
  const view = renderTracked(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-characterise" }}>
        <ManeuverPlannerComponent id="mnv-characterise" config={config} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** A full, plan-ready `vessel.orbit`, matching stream.test.tsx's own. */
function emitOrbitReady(
  fixture: ReturnType<typeof setupStreamFixture>,
  overrides: Record<string, unknown> = {},
) {
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 700000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: PINNED_UT,
    mu: 3.5316e12,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
    ...overrides,
  });
  fixture.emit("system.bodies", {
    bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
  });
}

/** The reference-body caption, queried directly rather than by position. */
function refBodyCaption(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-ref-body-caption]");
}

describe("ManeuverPlanner: nothing has arrived at all", () => {
  it("renders the awaiting-orbit empty state, and no preview or commit control", async () => {
    const { view } = setup();
    // Meaning 1: no orbit yet, so wait.
    expect(
      await screen.findByText("Awaiting orbit telemetry"),
    ).toBeInTheDocument();

    // Named absences, so a widget that renders nothing cannot pass.
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add node" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add Node When..." }),
    ).not.toBeInTheDocument();

    expect(screen.getByText("Planned nodes")).toBeInTheDocument();
    expect(screen.getByText("New maneuver")).toBeInTheDocument();
    expect(screen.getByText("No maneuver nodes planned")).toBeInTheDocument();

    // An absent ecc does not take the hyperbolic branch.
    expect(screen.queryByText("Hyperbolic trajectory")).not.toBeInTheDocument();
    expect(visibleText(view.container)).toContain("MANEUVER PLANNER");
  });

  it("omits the reference-body caption entirely: the gate is `refBody !== undefined`", async () => {
    const { view } = setup();
    await screen.findByText("Awaiting orbit telemetry");
    expect(refBodyCaption(view.container)).toBeNull();
  });
});

describe("ManeuverPlanner: the absence gates fire today", () => {
  it("reports 'No target selected in-game.' from a vessel.target that never arrived", async () => {
    // Meaning 2: absence reads as a statement about the game, not "we do not know".
    setup({ defaultPreset: "match-target-inclination" });
    expect(
      await screen.findByText("No target selected in-game."),
    ).toBeInTheDocument();
  });

  it("reports the SAME 'No target selected in-game.' for a confirmed vessel.target tombstone", async () => {
    // This site does not distinguish a tombstone from a never-arrived target.
    const { fixture } = setup({ defaultPreset: "match-target-inclination" });
    await screen.findByText("No target selected in-game.");
    act(() => {
      fixture.emit("vessel.target", null);
    });
    await waitFor(() =>
      expect(
        screen.getByText("No target selected in-game."),
      ).toBeInTheDocument(),
    );
  });

  it("drops that sentence once vessel.target actually arrives, proving the gate is what produced it", async () => {
    const { fixture } = setup({ defaultPreset: "match-target-inclination" });
    await screen.findByText("No target selected in-game.");
    act(() => {
      fixture.emit("vessel.target", {
        name: "Mun",
        kind: 1,
        orbit: { inc: 0, lan: 0, sma: 1.2e7, argPe: 0, ecc: 0 },
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByText("No target selected in-game."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Target: Mun/)).toBeInTheDocument();
  });

  it("reports 'or target LAN unavailable' for match-target-plane, folding two absences into one string", async () => {
    // One gate over two reads, so the operator cannot tell which is missing.
    setup({ defaultPreset: "match-target-plane" });
    expect(
      await screen.findByText(
        "No target selected in-game (or target LAN unavailable).",
      ),
    ).toBeInTheDocument();
  });

  it("renders an EMPTY reference-body caption when system.bodies is a confirmed tombstone", async () => {
    // A tombstoned roster resolves to null, which passes the caption's `!== undefined` gate.
    const { fixture, view } = setup();
    await screen.findByText("Awaiting orbit telemetry");
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("system.bodies", null);
    });
    await waitFor(() => {
      expect(refBodyCaption(view.container)).not.toBeNull();
      expect(refBodyCaption(view.container)?.textContent).toBe("");
    });
  });
});

describe("ManeuverPlanner: the reference-body caption's three states", () => {
  it("renders the body name once system.bodies resolves the index", async () => {
    const { fixture, view } = setup();
    await screen.findByText("Awaiting orbit telemetry");
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 1,
            name: "Kerbin",
            gravParameter: 3.5316e12,
            radius: 600000,
          },
        ],
      });
    });
    await waitFor(() => {
      expect(refBodyCaption(view.container)?.textContent).toBe("Kerbin");
    });
  });
});

describe("ManeuverPlanner: a partial vessel.orbit payload", () => {
  it("stays on the awaiting-orbit empty state when the record arrived but ecc did not", async () => {
    // Any one missing field reads as no telemetry at all.
    const { fixture } = setup();
    await screen.findByText("Awaiting orbit telemetry");
    act(() => {
      emitOrbitReady(fixture, { ecc: undefined });
    });
    expect(screen.getByText("Awaiting orbit telemetry")).toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
  });

  it("shows the hyperbolic notice instead when ecc IS present and >= 1", async () => {
    const { fixture } = setup();
    await screen.findByText("Awaiting orbit telemetry");
    act(() => {
      emitOrbitReady(fixture, { ecc: 1.5 });
    });
    expect(
      await screen.findByText("Hyperbolic trajectory"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Awaiting orbit telemetry"),
    ).not.toBeInTheDocument();
  });
});

describe("ManeuverPlanner: an absent node id refuses instead of guessing", () => {
  it("dispatches nothing, and says why, when the node arrived without an id", async () => {
    // Meaning 4: the node arrived without an id, and removal resolves only an exact guid.
    const { fixture } = setup();
    const dispatched: Array<[string, unknown]> = [];
    fixture.transport.setCommandHandler((command, args) => {
      dispatched.push([command, args]);
      return { ok: true };
    });
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            ut: PINNED_UT + 120,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 30,
            dvTotal: 30,
            patches: [],
          },
        ],
      });
    });
    const deleteBtn = await screen.findByRole("button", {
      name: "Delete node",
    });
    // Waits on the raw read, so a pass cannot come from the whole record being absent.
    await waitFor(() => {
      const point = fixture.store.sample(
        "vessel.maneuver",
        fixture.store.currentFrame(),
      );
      if (!point) throw new Error("vessel.maneuver frame not ready");
    });
    act(() => {
      deleteBtn.click();
    });
    await waitFor(() =>
      expect(screen.getByText(/arrived without an id/i)).toBeInTheDocument(),
    );
    expect(dispatched).toEqual([]);
  });
});

describe("ManeuverPlanner: dv.stages absent is coerced to zero", () => {
  it("renders the null-display dash for Available and no feasibility chip", async () => {
    // Meaning 3: an absent delta-v renders like a genuine zero, with no feasibility chip.
    const { fixture } = setup();
    act(() => {
      emitOrbitReady(fixture);
    });
    expect(await screen.findByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.queryByText("SHORT")).not.toBeInTheDocument();
    // Only an explicit `feasible === false` disables the commit button.
    expect(screen.getByRole("button", { name: "Add node" })).toBeEnabled();
  });
});
