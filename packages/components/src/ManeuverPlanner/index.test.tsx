import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  getComponent,
  registerAugment,
  registerDataSource,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { commandArgs, MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render as rtlRender, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

// Unmounted before disconnect() or clearAugments(), which would otherwise notify a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

// Captured at import, before a beforeEach's clearRegistry wipes the module-load registration.
const maneuverPlannerDef = getComponent("maneuver-planner");

// Carries `vessel.orbit` so the trigger editor's key picker offers the fields the trigger tests threshold on.
const UT_FIXTURE_VALUE = 1_000_000;
const utFixture = setupStreamFixture({
  pinnedUt: UT_FIXTURE_VALUE,
  // A free-running frame loop never lets a userEvent act() see an empty queue; frames come from emits and flushViewUt.
  suspendFrames: true,
});

/** Formats a dispatched `vessel.maneuver.add` as one comparable string. */
function formatManeuverAddCommand(args: unknown): string {
  const a = commandArgs<"vessel.maneuver.add">(args);
  return `o.addManeuverNode[${a?.ut},${a?.radialOut},${a?.normal},${a?.prograde}]`;
}

// StubTransport delivers only to subscribed channels, and the trigger service's non-hook reads subscribe to nothing.
utFixture.client.subscribe("vessel.orbit", () => {});
utFixture.client.subscribe("vessel.identity", () => {});
utFixture.client.subscribe("system.bodies", () => {});

/**
 * One frame, so frame-driven quantities (view UT, the trigger service's
 * re-evaluation) reach the render. Needed after a legacy-source emit or a time
 * advance; a stream emit mints its own frame.
 */
async function flushViewUt(): Promise<void> {
  await act(async () => {
    utFixture.emitFrame();
  });
}

// The widget shell over a real BufferedDataSource; the orbital math has its own tests in core.
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
  { key: "tar.name" },
  { key: "tar.o.inclination" },
  { key: "tar.o.lan" },
  { key: "dv.stages" },
  { key: "dv.summary" },
];

/** A self-consistent Keplerian orbit, at periapsis exactly at the pinned view UT. */
const VESSEL_ORBIT_STREAM_FIXTURE = {
  referenceBodyIndex: 1,
  sma: 700000,
  ecc: 0.01,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: UT_FIXTURE_VALUE,
  mu: 3.5316e12,
  patches: [],
  // Without a stated horizon the model withdraws, and the apsides solved from it go with it.
  horizon: ANALYTIC_UNBOUNDED_HORIZON,
};

const VESSEL_IDENTITY_STREAM_FIXTURE = {
  vesselId: "test-vessel",
  name: "Test Vessel",
  vesselType: 0,
  situation: 0,
};

/** Emits `vessel.maneuver`; `id` defaults to the node's index, since most callers care only about its delta-v. */
function emitManeuverNode(
  nodes: Array<{
    id?: string;
    ut: number;
    dvRadial?: number;
    dvNormal?: number;
    dvPrograde?: number;
  }>,
): void {
  utFixture.emit("vessel.maneuver", {
    nodes: nodes.map((n, index) => ({
      id: n.id ?? String(index),
      ut: n.ut,
      dvRadial: n.dvRadial ?? 0,
      dvNormal: n.dvNormal ?? 0,
      dvPrograde: n.dvPrograde ?? 0,
      dvTotal: Math.hypot(n.dvRadial ?? 0, n.dvNormal ?? 0, n.dvPrograde ?? 0),
      // The stock producer always states the basis that names the three positional slots.
      frame: ManeuverFrame.RadialNormalPrograde,
      patches: [],
    })),
  });
}

/** `bodyName` is the name reported at index 1; a planet pack changes only that, which a name lookup misses. */
function emitFullOrbit(source: MockDataSource, bodyName = "Kerbin"): void {
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
  // The trigger tests threshold on this orbit's sma and plan against its conic, which needs the body radius.
  utFixture.emit("vessel.orbit", VESSEL_ORBIT_STREAM_FIXTURE);
  utFixture.emit("vessel.identity", VESSEL_IDENTITY_STREAM_FIXTURE);
  utFixture.emit("system.bodies", {
    bodies: [
      {
        name: bodyName,
        index: 1,
        parentIndex: 0,
        radius: 600_000,
        orbit: null,
      },
    ],
  });
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
    unmountAll();
    buffered.disconnect();
  });

  it("shows an ordinary empty state until there is an orbit to plan against", () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    expect(screen.getByText(/Awaiting orbit telemetry/i)).toBeInTheDocument();
    // No wire keys on an operator surface.
    expect(screen.queryByText(/o\.sma|t\.universalTime/)).toBeNull();
    expect(screen.queryByText(/Hyperbolic trajectory/i)).toBeNull();
  });

  it("shows a distinct hyperbolic-trajectory notice (not the generic waiting panel) when ecc >= 1", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      // Hyperbolic: ecc >= 1, sma conventionally negative.
      utFixture.emit("vessel.orbit", {
        ...VESSEL_ORBIT_STREAM_FIXTURE,
        sma: -700_000,
        ecc: 1.5,
      });
    });
    await flushViewUt();
    expect(screen.getByText(/Hyperbolic trajectory/i)).toBeInTheDocument();
    expect(
      screen.getByText(/maneuver planning is not available/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Waiting for telemetry$/i)).toBeNull();
  });

  it("transitions out of the waiting state once telemetry lands", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    await flushViewUt();
    expect(screen.queryByText(/Waiting for telemetry/i)).toBeNull();
    // "Planned nodes" section is always present in the ready state.
    expect(screen.getByText("Planned nodes")).toBeInTheDocument();
    expect(screen.getByText("No maneuver nodes planned.")).toBeInTheDocument();
  });

  it("lists planned maneuver nodes when o.maneuverNodes arrives", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
      emitManeuverNode([{ ut: 1_000_120, dvRadial: 30 }]);
    });
    // The node list recomputes on a frame tick, and the shared store otherwise holds the prior test's frame.
    await flushViewUt();
    expect(screen.queryByText("No maneuver nodes planned.")).toBeNull();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("raises a role=status shortfall banner and disables Add node when ΔV is insufficient", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
      // ApR about 1_000_000 and PeR about 700_000: a real circularise cost against a tiny budget.
      utFixture.emit("vessel.orbit", {
        ...VESSEL_ORBIT_STREAM_FIXTURE,
        sma: 850000,
        ecc: 0.1765,
      });
      utFixture.emit("dv.stages", [
        {
          stage: 0,
          dryMass: 500,
          fuelMass: 500,
          startMass: 1000,
          endMass: 500,
          burnTime: 10,
          dvVac: 25, // far less than circularisation needs
          dvAsl: 25,
          dvActual: 25,
          twrVac: 1,
          twrAsl: 1,
          twrActual: 1,
          thrustVac: 1,
          thrustAsl: 1,
          thrustActual: 1,
        },
      ]);
      // The vessel total is the wire's own figure, never the sum of the rows above.
      utFixture.emit("dv.summary", {
        stageCount: 1,
        totalDvVac: 25,
        totalDvAsl: 25,
        totalDvActual: 25,
      });
    });
    await flushViewUt();

    // Scoped by text: the title row's stream badge is a second role="status" region.
    const banner = screen
      .getByText(/shortfall/i)
      .closest('[role="status"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(visibleText(banner)).toMatch(/shortfall/i);
    expect(visibleText(banner)).toMatch(/short\.?$/i);

    const addBtn = screen.getByRole("button", { name: /^add node$/i });
    expect(addBtn).toBeDisabled();
  });

  // Its own fixture: topic values on the shared one are sticky, and a zero budget would block every later dispatch.
  it("refuses the commit for a craft whose budget reports genuinely zero delta-v", async () => {
    const spent = setupStreamFixture({
      pinnedUt: UT_FIXTURE_VALUE,
      suspendFrames: true,
    });

    render(
      <spent.Provider>
        <ManeuverPlannerComponent id="mnv-spent" config={{}} />
      </spent.Provider>,
    );
    act(() => {
      spent.emit("vessel.orbit", {
        ...VESSEL_ORBIT_STREAM_FIXTURE,
        sma: 850000,
        ecc: 0.1765,
      });
      // The conic declares the roster as an input; without it there is no plan to judge.
      spent.emit("system.bodies", {
        bodies: [{ name: "Kerbin", index: 1, radius: 600_000 }],
      });
      // A real zero: a fact about the vessel, not the absence of one.
      spent.emit("dv.stages", [
        {
          stage: 0,
          dryMass: 500,
          fuelMass: 0,
          startMass: 500,
          endMass: 500,
          burnTime: 0,
          dvVac: 0,
          dvAsl: 0,
          dvActual: 0,
          twrVac: 0,
          twrAsl: 0,
          twrActual: 0,
          thrustVac: 0,
          thrustAsl: 0,
          thrustActual: 0,
        },
      ]);
      spent.emit("dv.summary", {
        stageCount: 1,
        totalDvVac: 0,
        totalDvAsl: 0,
        totalDvActual: 0,
      });
    });
    await flushViewUt();

    const banner = screen
      .getByText(/shortfall/i)
      .closest('[role="status"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(visibleText(banner)).toMatch(/short\.?$/i);
    expect(screen.getByRole("button", { name: /^add node$/i })).toBeDisabled();
  });

  it("arms a conditional trigger and dispatches the burn when the condition holds", async () => {
    const user = userEvent.setup();
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
    // A fired trigger dispatches over the stream, so it is captured off the transport.
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(formatManeuverAddCommand(args));
      }
      return null;
    });

    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    await flushViewUt();

    await user.click(screen.getByRole("button", { name: /add node when/i }));

    // The picker offers the path the trigger reads from, not a flat alias for it.
    const picker = screen.getByPlaceholderText("Search telemetry...");
    await user.click(picker);
    await user.type(picker, "vessel.orbit.sma{Enter}");

    // Set threshold above the current sma (700000) so it doesn't fire on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "800000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    expect(visibleText()).toMatch(/vessel\.orbit\.sma >= 800000/);
    expect(calls).toHaveLength(0);

    // The trigger reads sma off the stream, so the crossing has to be a stream emit.
    await act(async () => {
      source.emit("o.ApA", 250000);
      utFixture.emit("vessel.orbit", {
        ...VESSEL_ORBIT_STREAM_FIXTURE,
        sma: 900_000,
      });
    });
    await flushViewUt();

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^o\.addManeuverNode\[/);
    expect(screen.queryByText(/vessel\.orbit\.sma >= 800000/)).toBeNull();
  });

  it("fires immediately when the trigger condition is already true at arm time", async () => {
    const user = userEvent.setup();
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
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(formatManeuverAddCommand(args));
      }
      return null;
    });

    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    await flushViewUt();

    await user.click(screen.getByRole("button", { name: /add node when/i }));
    const picker = screen.getByPlaceholderText("Search telemetry...");
    await user.click(picker);
    await user.type(picker, "vessel.orbit.sma{Enter}");
    // Below the current sma (700000), so it fires on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "600000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^o\.addManeuverNode\[/);
  });

  it("flashes a completed node green for 10s then auto-removes it from KSP", async () => {
    // A guid, not the index-shaped default id, so a raw-index dispatch cannot pass for a correct one.
    const NODE_GUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    const calls: string[] = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.remove") {
        const a = commandArgs<"vessel.maneuver.remove">(args);
        calls.push(`o.removeManeuverNode[${a?.nodeId}]`);
      }
      return null;
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <utFixture.Provider>
          <ManeuverPlannerComponent id="mnv" config={{}} />
        </utFixture.Provider>,
      );
      act(() => {
        emitFullOrbit(source);
      });
      // Fake timers also fake requestAnimationFrame, so the frame tick needs an explicit advance.
      act(() => {
        emitManeuverNode([{ id: NODE_GUID, ut: 1_000_120, dvPrograde: 30 }]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(visibleText()).toMatch(/30 m\/s/);
      expect(screen.queryByText(/Burn complete/i)).toBeNull();

      act(() => {
        emitManeuverNode([{ id: NODE_GUID, ut: 1_000_120, dvPrograde: 0.1 }]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(screen.getByText(/Burn complete/i)).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(calls).toEqual([`o.removeManeuverNode[${NODE_GUID}]`]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Projected apsides are altitudes, so the body radius subtracted must be the reported one.
  it("subtracts the reported radius from the projected apsides under a rename", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source, "Earth");
    });
    await screen.findByText("New Ap");
    expect(visibleText()).toMatch(/107\.0 km/);
    expect(visibleText()).not.toMatch(/707\.0 km/);
  });

  it("reveals per-preset custom inputs when a custom preset is selected", async () => {
    const user = userEvent.setup();
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });

    // Default preset (circularize-apo) has no custom inputs.
    expect(screen.queryByText("Prograde")).toBeNull();
    expect(screen.queryByText("Target inc")).toBeNull();

    // custom-apo: prograde / normal / radial fields appear.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "custom-apo");
    expect(screen.getByText("Prograde")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Radial")).toBeInTheDocument();

    // match-inclination: target inc field, no prograde.
    await user.selectOptions(select, "match-inclination");
    expect(screen.getByText("Target inc")).toBeInTheDocument();
    expect(screen.queryByText("Prograde")).toBeNull();

    // hohmann-to-altitude: target altitude.
    await user.selectOptions(select, "hohmann-to-altitude");
    expect(screen.getByText("Target alt")).toBeInTheDocument();

    // hohmann-rendezvous-target: standoff.
    await user.selectOptions(select, "hohmann-rendezvous-target");
    expect(screen.getByText("Standoff")).toBeInTheDocument();
  });

  it("resets prograde/normal/radial to 0 when switching away from a custom preset", async () => {
    const user = userEvent.setup();
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "custom-apo");

    const progradeLabel = screen.getByText("Prograde");
    const progradeInput = progradeLabel.parentElement?.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(progradeInput).toBeTruthy();
    await user.clear(progradeInput);
    await user.type(progradeInput, "42");
    expect(progradeInput.value).toBe("42");

    // Switch to a non-custom-input preset; switch back; the value should be 0.
    await user.selectOptions(select, "circularize-apo");
    await user.selectOptions(select, "custom-apo");
    const reopenedLabel = screen.getByText("Prograde");
    const reopenedInput = reopenedLabel.parentElement?.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(reopenedInput.value).toBe("0");
  });

  it("sends vessel.maneuver.update with edited values via the per-node editor", async () => {
    const user = userEvent.setup();
    const calls: Array<{
      nodeId?: string;
      ut?: number;
      radialOut?: number;
      normal?: number;
      prograde?: number;
    }> = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.update") {
        calls.push(commandArgs<"vessel.maneuver.update">(args));
      }
      return null;
    });

    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
      emitManeuverNode([{ ut: 1_000_120, dvPrograde: 30 }]);
    });
    await flushViewUt();

    const editBtn = screen.getByRole("button", { name: /edit node/i });
    await user.click(editBtn);

    // The default preset shows no Prograde field, so the only one is the editor's.
    const progradeLabel = screen.getByText("Prograde");
    const progradeInput = progradeLabel.parentElement?.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(progradeInput).toBeTruthy();
    expect(progradeInput.value).toBe("30");
    await user.clear(progradeInput);
    await user.type(progradeInput, "45");

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveBtn);

    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent.nodeId).toBe("0");
    expect(sent.ut).toBeCloseTo(1_000_120, 0);
    expect(sent.radialOut).toBe(0);
    expect(sent.normal).toBe(0);
    expect(sent.prograde).toBe(45);
  });

  it("sends vessel.maneuver.add args with the [radialOut, normal, prograde] vector convention", async () => {
    const user = userEvent.setup();
    // KSP's node-local frame is (radialOut, normal, prograde); a mix-up turns a prograde burn radial.
    const calls: Array<{
      ut?: number;
      radialOut?: number;
      normal?: number;
      prograde?: number;
    }> = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(commandArgs<"vessel.maneuver.add">(args));
      }
      return null;
    });

    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });

    const addBtn = await screen.findByRole("button", { name: /^add node$/i });
    await user.click(addBtn);

    // Default preset is circularize-apo: a positive prograde burn, normal=0, radial=0.
    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent.radialOut).toBe(0);
    expect(sent.normal).toBe(0);
    expect(sent.prograde).toBeGreaterThan(0);
  });
});

describe("ManeuverPlanner: augment slots (Uplink §4)", () => {
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
    unmountAll();
    // A test may have bound an augment into the slot.
    clearAugments();
    buffered.disconnect();
  });

  it("declares its whole-widget append slot on its component definition", () => {
    expect(maneuverPlannerDef?.augmentSlots).toEqual([
      "maneuver-planner.sections",
    ]);
  });

  it("renders with the slot empty when no augment is registered", () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    expect(screen.getByText("MANEUVER PLANNER")).toBeInTheDocument();
    expect(screen.queryByText(/from-sections-augment/i)).toBeNull();
  });

  it("renders an augment registered into the body sections slot", () => {
    registerAugment({
      id: "test-transfer-strategy",
      augments: "maneuver-planner.sections",
      component: () => <div>from-sections-augment</div>,
    });
    render(
      <utFixture.Provider>
        {/* Panel builds its seam ids from the component id this context supplies. */}
        <WidgetMetaContext.Provider
          value={{ componentId: "maneuver-planner", contributionSlots: [] }}
        >
          <ManeuverPlannerComponent id="mnv" config={{}} />
        </WidgetMetaContext.Provider>
      </utFixture.Provider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    expect(screen.getByText("from-sections-augment")).toBeInTheDocument();
  });
});
