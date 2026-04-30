import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManeuverPlannerComponent } from "./index";

/**
 * ManeuverPlanner component test.
 *
 * The orbital math (circularize/match-plane/etc.) is covered exhaustively in
 * packages/core/src/calc/maneuver.test.ts. This test exercises the widget
 * shell: waiting → ready transitions, Principia gating, and the planned-node
 * list. We drive a real BufferedDataSource (not mocks of our own hooks) to
 * catch regressions in how data flows into the widget.
 */

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "comm.connected" },
  { key: "o.sma" },
  { key: "o.eccentricity" },
  { key: "o.ApR" },
  { key: "o.PeR" },
  { key: "o.ApA" },
  { key: "o.PeA" },
  { key: "o.argumentOfPeriapsis" },
  { key: "o.trueAnomaly" },
  { key: "o.timeToAp" },
  { key: "o.timeToPe" },
  { key: "o.inclination" },
  { key: "o.period" },
  { key: "o.orbitalSpeed" },
  { key: "o.radius" },
  { key: "o.referenceBody" },
  { key: "o.lan" },
  { key: "o.maneuverNodes" },
  { key: "t.universalTime" },
  { key: "a.physicsMode" },
  { key: "tar.name" },
  { key: "tar.o.inclination" },
  { key: "tar.o.lan" },
  { key: "dv.stages" },
];

function emitFullOrbit(source: MockDataSource): void {
  source.emit("comm.connected", true);
  source.emit("v.name", "Test Vessel");
  source.emit("v.missionTime", 0);
  source.emit("v.body", "Kerbin");
  source.emit("o.referenceBody", "Kerbin");
  source.emit("o.sma", 700000);
  source.emit("o.eccentricity", 0.01);
  source.emit("o.ApR", 707000);
  source.emit("o.PeR", 693000);
  source.emit("o.ApA", 107000);
  source.emit("o.PeA", 93000);
  source.emit("o.argumentOfPeriapsis", 0);
  source.emit("o.trueAnomaly", 0);
  source.emit("o.timeToAp", 900);
  source.emit("o.timeToPe", 1800);
  source.emit("o.inclination", 0);
  source.emit("o.period", 3600);
  source.emit("o.orbitalSpeed", 2300);
  source.emit("o.radius", 700000);
  source.emit("t.universalTime", 1_000_000);
  source.emit("a.physicsMode", "stock");
}

describe("ManeuverPlannerComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS, affectedBySignalLoss: true });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("shows the diagnostic waiting panel until every required field arrives", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();
    // Per-field checklist rows appear with the underlying data-key labels.
    expect(screen.getByText("o.sma")).toBeInTheDocument();
    expect(screen.getByText("t.universalTime")).toBeInTheDocument();
  });

  it("transitions out of the waiting state once telemetry lands", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });
    expect(screen.queryByText(/Waiting for telemetry/i)).toBeNull();
    // "Planned nodes" section is always present in the ready state.
    expect(screen.getByText("Planned nodes")).toBeInTheDocument();
    expect(screen.getByText("No maneuver nodes planned.")).toBeInTheDocument();
  });

  it("shows the Principia banner when n-body physics is reported", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
      source.emit("a.physicsMode", "n_body");
    });
    expect(screen.getByText(/N-body physics detected/i)).toBeInTheDocument();
  });

  it("lists planned maneuver nodes when o.maneuverNodes arrives", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
      source.emit("o.maneuverNodes", [
        {
          UT: 1_000_120,
          deltaV: [30, 0, 0],
          orbitPatch: null,
        },
      ]);
    });
    // Empty-state copy should be gone.
    expect(screen.queryByText("No maneuver nodes planned.")).toBeNull();
    // Node list contains a Delete button per-node.
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("raises a role=alert shortfall banner and disables Add node when ΔV is insufficient", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
      // Highly eccentric orbit with non-trivial circularise cost, paired with
      // a tiny vessel ΔV budget — the planner should refuse the commit.
      source.emit("o.ApR", 1_000_000);
      source.emit("o.PeR", 700_000);
      source.emit("o.eccentricity", 0.1765);
      source.emit("dv.stages", [
        {
          stage: 0,
          stageMass: 1000,
          dryMass: 500,
          fuelMass: 500,
          startMass: 1000,
          endMass: 500,
          burnTime: 10,
          deltaVVac: 25, // far less than circularisation needs
          deltaVASL: 25,
          deltaVActual: 25,
          TWRVac: 1,
          TWRASL: 1,
          TWRActual: 1,
          ispVac: 300,
          ispASL: 300,
          ispActual: 300,
          thrustVac: 1,
          thrustASL: 1,
          thrustActual: 1,
        },
      ]);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/shortfall/i);
    expect(alert.textContent).toMatch(/short\.?$/i);

    const addBtn = screen.getByRole("button", { name: /add node/i });
    expect(addBtn).toBeDisabled();
  });

  it("sends o.addManeuverNode args in [ut, radial, normal, prograde] order", async () => {
    // KSP's ManeuverNode.DeltaV is a Vector3d(radialOut, normal, prograde) —
    // confirmed by kOS's Node.cs. Telemachus passes its `[ut,x,y,z]` args
    // straight to OnGizmoUpdated(Vector3d(x,y,z), ut), so the on-wire
    // order is [ut, radial, normal, prograde]. Mixing this up turns a
    // pure-prograde Hohmann burn into a pure-radial one — vessel ends
    // up pointing straight up instead of along velocity.
    buffered.disconnect();
    clearRegistry();
    const calls: string[] = [];
    source = new MockDataSource({
      keys: KEYS,
      affectedBySignalLoss: true,
      onExecute: (action) => {
        calls.push(action);
      },
    });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();

    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });

    const addBtn = await screen.findByRole("button", { name: /add node/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });

    // Default preset is circularize-apo: a positive prograde burn,
    // normal=0, radial=0. So the action string should have the
    // prograde value in the LAST slot, not the first.
    expect(calls).toHaveLength(1);
    const match =
      /^o\.addManeuverNode\[([^,]+),([^,]+),([^,]+),([^\]]+)\]$/.exec(calls[0]);
    expect(match).not.toBeNull();
    if (!match) return;
    const [, , radial, normal, prograde] = match;
    expect(Number(radial)).toBe(0);
    expect(Number(normal)).toBe(0);
    expect(Number(prograde)).toBeGreaterThan(0);
  });
});
