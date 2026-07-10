import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  getComponent,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManeuverPlannerComponent } from "./index";

// Captured at import — before any `clearRegistry` in a beforeEach wipes the
// module-load `registerComponent`, so the augment-slot metadata is intact.
const maneuverPlannerDef = getComponent("maneuver-planner");

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

  it("raises a role=status shortfall banner and disables Add node when ΔV is insufficient", () => {
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

    // Two role="status" live-regions now coexist: the ΔV-shortfall banner
    // (asserted here) and the M3 title-row stream-status badge (which reads
    // "OFFLINE" in this no-TelemetryProvider legacy test, since the mock
    // source reports disconnected without a comm.connected emit). Scope to
    // the shortfall banner by its text rather than the bare role.
    const banner = screen
      .getByText(/shortfall/i)
      .closest('[role="status"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/shortfall/i);
    expect(banner.textContent).toMatch(/short\.?$/i);

    const addBtn = screen.getByRole("button", { name: /^add node$/i });
    expect(addBtn).toBeDisabled();
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

    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });

    // Open the trigger editor.
    await user.click(screen.getByRole("button", { name: /add node when/i }));

    // Pick the o.ApA telemetry key via the data-key search input.
    const picker = screen.getByPlaceholderText("Search telemetry…");
    await user.click(picker);
    await user.type(picker, "o.ApA{Enter}");

    // Set threshold above current ApA (107000) so it doesn't fire on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "200000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    // Armed row visible, no burn dispatched yet.
    expect(screen.getByText(/o\.ApA >= 200000/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    // Apoapsis climbs past the threshold — trigger fires and the burn is
    // dispatched with the frozen circularize-apo preset.
    await act(async () => {
      source.emit("o.ApA", 250000);
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^o\.addManeuverNode\[/);
    // Armed row removed after firing.
    expect(screen.queryByText(/o\.ApA >= 200000/)).toBeNull();
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

    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });

    await user.click(screen.getByRole("button", { name: /add node when/i }));
    const picker = screen.getByPlaceholderText("Search telemetry…");
    await user.click(picker);
    await user.type(picker, "o.ApA{Enter}");
    // Threshold below current ApA (107000) — should fire on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "50000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^o\.addManeuverNode\[/);
  });

  it("flashes a completed node green for 10s then auto-removes it from KSP", async () => {
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

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ManeuverPlannerComponent id="mnv" config={{}} />);
      act(() => {
        emitFullOrbit(source);
        // Plan a 30 m/s prograde burn — well above the 0.5 m/s threshold.
        source.emit("o.maneuverNodes", [
          { UT: 1_000_120, deltaV: [0, 0, 30], orbitPatch: null },
        ]);
      });

      // Initial render: live row shows "30 m/s", not the completion banner.
      expect(screen.getByText(/30 m\/s/)).toBeInTheDocument();
      expect(screen.queryByText(/Burn complete/i)).toBeNull();

      // Burn completes — remaining ΔV drops below threshold.
      act(() => {
        source.emit("o.maneuverNodes", [
          { UT: 1_000_120, deltaV: [0, 0, 0.1], orbitPatch: null },
        ]);
      });

      // Green-flash state visible, but no removal call yet.
      expect(screen.getByText(/Burn complete/i)).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      // Advance past the 10 s hold — auto-remove should fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(calls).toEqual(["o.removeManeuverNode[0]"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals per-preset custom inputs when a custom preset is selected", async () => {
    const user = userEvent.setup();
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
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
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "custom-apo");

    // Find the prograde input by walking up from its label.
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

  it("sends o.updateManeuverNode with edited values via the per-node editor", async () => {
    const user = userEvent.setup();
    // Edit flow: click Edit on a planned-node row, change the prograde, Save.
    // Verifies the action string and arg order: `o.updateManeuverNode[id, ut,
    // radial, normal, prograde]` — same vector convention as add.
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
      source.emit("o.maneuverNodes", [
        { UT: 1_000_120, deltaV: [0, 0, 30], orbitPatch: null },
      ]);
    });

    // Open the editor on the planned node.
    const editBtn = screen.getByRole("button", { name: /edit node/i });
    await user.click(editBtn);

    // The editor exposes a Prograde input pre-filled with the current value.
    // Multiple "Prograde" labels can exist (the custom-preset form has one too,
    // but the default preset doesn't show it). On the default preset, only the
    // editor's Prograde input is rendered.
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
    const match =
      /^o\.updateManeuverNode\[(\d+),([^,]+),([^,]+),([^,]+),([^\]]+)\]$/.exec(
        calls[0],
      );
    expect(match).not.toBeNull();
    if (!match) return;
    const [, id, ut, radial, normal, prograde] = match;
    expect(Number(id)).toBe(0);
    expect(Number(ut)).toBeCloseTo(1_000_120, 0);
    expect(Number(radial)).toBe(0);
    expect(Number(normal)).toBe(0);
    expect(Number(prograde)).toBe(45);
  });

  it("sends o.addManeuverNode args in [ut, radial, normal, prograde] order", async () => {
    const user = userEvent.setup();
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

    const addBtn = await screen.findByRole("button", { name: /^add node$/i });
    await user.click(addBtn);

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

describe("ManeuverPlanner — augment slots (Uplink §4)", () => {
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
    // The widget module registers no augments of its own, but a test may have
    // bound one into a slot — reset so it never leaks into a later test.
    clearAugments();
    buffered.disconnect();
  });

  it("declares both whole-widget append slots on its component definition", () => {
    expect(maneuverPlannerDef?.augmentSlots).toEqual([
      "maneuver-planner.sections",
      "maneuver-planner.badges",
    ]);
  });

  it("renders with both slots empty when no augment is registered", () => {
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });
    // The frame still renders normally — an unfilled slot contributes no DOM.
    expect(screen.getByText("MANEUVER PLANNER")).toBeInTheDocument();
    expect(screen.queryByText(/from-sections-augment/i)).toBeNull();
    expect(screen.queryByText(/from-badges-augment/i)).toBeNull();
  });

  it("renders an augment registered into the body sections slot", () => {
    registerAugment({
      id: "test-transfer-strategy",
      augments: "maneuver-planner.sections",
      component: () => <div>from-sections-augment</div>,
    });
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    act(() => {
      emitFullOrbit(source);
    });
    expect(screen.getByText("from-sections-augment")).toBeInTheDocument();
  });

  it("renders an augment registered into the header badges slot", () => {
    registerAugment({
      id: "test-header-badge",
      augments: "maneuver-planner.badges",
      component: () => <span>from-badges-augment</span>,
    });
    render(<ManeuverPlannerComponent id="mnv" config={{}} />);
    // Badges ride the title row, present regardless of telemetry readiness.
    expect(screen.getByText("from-badges-augment")).toBeInTheDocument();
  });
});
