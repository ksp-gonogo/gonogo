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
import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

// Captured at import — before any `clearRegistry` in a beforeEach wipes the
// module-load `registerComponent`, so the augment-slot metadata is intact.
const maneuverPlannerDef = getComponent("maneuver-planner");

// currentUT now reads off `useViewUt()` (the `t.universalTime` client
// migration) instead of the legacy `DataSource` — every test below still
// emits `t.universalTime` (now a dead, harmless emit) so this constant
// mirrors that same value via a minimal pinned `TelemetryProvider`. Nothing
// is carried, so every other read/command stays on the legacy source
// exactly as before — the two trigger-fire tests below mount their OWN
// `<TelemetryProvider>` (same client/store, wider carriedChannels) instead
// of `utFixture.Provider`, so widening the carry set for the trigger's
// `vessel.maneuver.add` dispatch doesn't leak into every other test's
// `execute("data", ...)` calls (which also ride the carried-gated
// `useCommand`/`useExecuteAction` shim).
const UT_FIXTURE_VALUE = 1_000_000;
const utFixture = setupStreamFixture({
  carriedChannels: [],
  pinnedUt: UT_FIXTURE_VALUE,
});

/**
 * Reconstructs the legacy `o.addManeuverNode[...]` action string from a
 * dispatched `{command, args}` pair — lets the trigger-fire tests below keep
 * asserting the same `.toMatch(/^o\.addManeuverNode\[/)` shape even though
 * `LocalManeuverTriggerService.fire()` now dispatches through the stream
 * (`dispatchActiveCommand`) instead of the legacy `DataSource.execute`.
 */
function formatManeuverAddCommand(args: unknown): string {
  const a = args as {
    ut?: number;
    radialOut?: number;
    normal?: number;
    prograde?: number;
  };
  return `o.addManeuverNode[${a?.ut},${a?.radialOut},${a?.normal},${a?.prograde}]`;
}

/**
 * Reuses `utFixture`'s client/store but with a WIDER carriedChannels set —
 * for the two trigger-fire tests below, which need `vessel.maneuver.add`
 * carried so `LocalManeuverTriggerService.fire()`'s `dispatchActiveCommand`
 * actually routes, without widening the SHARED module-level `utFixture`
 * every other test in this file also mounts (that would also route the
 * regular "Add Node" button's `execute("data", ...)` — the same carried-gated
 * `useCommand` shim — off its legacy `onExecute` capture).
 */
function TriggerCarriedProvider({ children }: { children: ReactNode }) {
  return (
    <TelemetryProvider
      client={utFixture.client}
      store={utFixture.store}
      carriedChannels={["vessel.maneuver.add"]}
    >
      {children}
    </TelemetryProvider>
  );
}
// `StubTransport.emit` only delivers a topic once something has actually
// subscribed (the realistic "proves ref-counted subscribe happened" gate —
// see its own doc comment). No widget in THIS test reads `vessel.orbit`/
// `vessel.identity`/`system.bodies` reactively (`LocalManeuverTriggerService`'s
// non-hook accessors sample the store directly, with no subscription of
// their own — see `sampleActiveTopic`'s doc comment in `sitrep-client`), so
// this stands in for "some other live widget already has it subscribed",
// the same assumption production relies on. `system.bodies` feeds the
// derived `vessel.state.apoapsisAlt`/`periapsisAlt` reference-body radius —
// the trigger tests below arm on `o.ApA`, which only resolves once it's fed.
utFixture.client.subscribe("vessel.orbit", () => {});
utFixture.client.subscribe("vessel.identity", () => {});
utFixture.client.subscribe("system.bodies", () => {});

/**
 * `useViewUt()`'s pinned value only lands once `ViewClock.onFrame`'s
 * per-frame tick has run at least once (the hook's synchronous initial seed
 * ignores `scrubTo` — see its own doc comment in `sitrep-client/src/context.tsx`),
 * so a synchronous `act()` around a telemetry emit isn't enough to reach the
 * "ready" state this widget gates on `currentUT`. Await this right after
 * emitting telemetry, before any assertion that needs the widget past
 * "Waiting for telemetry".
 */
async function flushViewUt(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/**
 * ManeuverPlanner component test.
 *
 * The orbital math (circularize/match-plane/etc.) is covered exhaustively in
 * packages/core/src/calc/maneuver.test.ts. This test exercises the widget
 * shell: waiting → ready transitions and the planned-node list. We drive a
 * real BufferedDataSource (not mocks of our own hooks) to catch regressions
 * in how data flows into the widget.
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
  { key: "tar.name" },
  { key: "tar.o.inclination" },
  { key: "tar.o.lan" },
  { key: "dv.stages" },
];

/**
 * `LocalManeuverTriggerService` (the trigger-editor's fallback service,
 * since this test never supplies a `providedTriggerService`) now reads its
 * OWN orbit/target/vessel-identity fields off the stream
 * (`getVesselOrbit()`/`getVesselTarget()`/`getVesselIdentity()`/
 * `getVesselState()`) instead of the legacy `o.*`/`tar.o.*`/`v.name` keys —
 * see that file's own doc comment. The widget's own DISPLAYED numbers still
 * come from the legacy `o.*` emits above (unmigrated `useDataValue` reads),
 * so the two don't need to match exactly; this just needs to be a
 * self-consistent Keplerian orbit so `computePlan`'s circularize-apo preset
 * (the only preset a trigger-armed test exercises) has real numbers to work
 * with. `meanAnomalyAtEpoch: 0` + `epoch: UT_FIXTURE_VALUE` puts the vessel
 * at periapsis exactly at the pinned view-UT, matching `o.trueAnomaly: 0`
 * above for a coherent (if not byte-identical) picture.
 */
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
};

const VESSEL_IDENTITY_STREAM_FIXTURE = {
  vesselId: "test-vessel",
  name: "Test Vessel",
  vesselType: 0,
  situation: 0,
};

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
  // Stream leg — see the doc comment above. Kerbin's radius (600_000m) is
  // what turns the fixture's apoapsisRADIUS (707_000, sma·1.01) into the
  // apoapsisALT (107_000) the legacy `o.ApA` emit above already carries —
  // `LocalManeuverTriggerService`'s trigger `dataKey` reads (`getValue`)
  // resolve `o.ApA` to the derived `vessel.state.apoapsisAlt`, which needs
  // `system.bodies` for that subtraction.
  utFixture.emit("vessel.orbit", VESSEL_ORBIT_STREAM_FIXTURE);
  utFixture.emit("vessel.identity", VESSEL_IDENTITY_STREAM_FIXTURE);
  utFixture.emit("system.bodies", {
    bodies: [
      {
        name: "Kerbin",
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
    cleanup();
    buffered.disconnect();
  });

  it("shows the diagnostic waiting panel until every required field arrives", () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();
    // Per-field checklist rows appear with the underlying data-key labels.
    expect(screen.getByText("o.sma")).toBeInTheDocument();
    expect(screen.getByText("t.universalTime")).toBeInTheDocument();
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

  it("lists planned maneuver nodes when o.maneuverNodes arrives", () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
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

  it("raises a role=status shortfall banner and disables Add node when ΔV is insufficient", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
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
    await flushViewUt();

    // Two role="status" live-regions now coexist: the ΔV-shortfall banner
    // (asserted here) and the title-row stream-status badge (which reads
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
    // The trigger's fire dispatch now rides `dispatchActiveCommand`, not
    // the legacy `onExecute` above — capture it off the shared stream
    // fixture's transport instead (see `formatManeuverAddCommand`).
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(formatManeuverAddCommand(args));
      }
      return null;
    });

    render(
      <TriggerCarriedProvider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </TriggerCarriedProvider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    await flushViewUt();

    // Open the trigger editor.
    await user.click(screen.getByRole("button", { name: /add node when/i }));

    // Pick the o.ApA telemetry key via the data-key search input.
    const picker = screen.getByPlaceholderText("Search telemetry...");
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
    // dispatched with the frozen circularize-apo preset. The trigger's
    // `dataKey` read (`getValue`) resolves `o.ApA` off the STREAM's derived
    // `vessel.state.apoapsisAlt`, so the crossing has to come from a new
    // `vessel.orbit` emit (sma 900_000 -> apoapsisAlt 309_000), not the
    // legacy `source.emit` alone.
    await act(async () => {
      source.emit("o.ApA", 250000);
      utFixture.emit("vessel.orbit", {
        ...VESSEL_ORBIT_STREAM_FIXTURE,
        sma: 900_000,
      });
    });
    // Let the provider's scheduled `store.beginFrame()` run so the derived
    // channel recomputes and the trigger's frame-tick re-evaluation fires.
    await flushViewUt();

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
    // See the previous test's identical note — the trigger's fire dispatch
    // rides `dispatchActiveCommand` now, captured off the stream fixture.
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(formatManeuverAddCommand(args));
      }
      return null;
    });

    render(
      <TriggerCarriedProvider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </TriggerCarriedProvider>,
    );
    act(() => {
      emitFullOrbit(source);
    });
    await flushViewUt();

    await user.click(screen.getByRole("button", { name: /add node when/i }));
    const picker = screen.getByPlaceholderText("Search telemetry...");
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
      render(
        <utFixture.Provider>
          <ManeuverPlannerComponent id="mnv" config={{}} />
        </utFixture.Provider>,
      );
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

    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
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
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
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
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
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
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    // Badges ride the title row, present regardless of telemetry readiness.
    expect(screen.getByText("from-badges-augment")).toBeInTheDocument();
  });
});
