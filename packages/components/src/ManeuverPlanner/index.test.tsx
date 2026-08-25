import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  getComponent,
  MockDataSource,
  registerAugment,
  registerDataSource,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { act, render as rtlRender, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

// Rendered trees, tracked so each describe's afterEach can unmount them BEFORE
// disconnecting the legacy source or clearing the augment registry. RTL
// auto-cleanup runs after this file's afterEach, so it can't be relied on to
// unmount first: buffered.disconnect()/clearAugments() firing on a
// still-mounted widget is a state update outside act(), the documented
// anti-pattern in CLAUDE.md.
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

// Captured at import: before any `clearRegistry` in a beforeEach wipes the
// module-load `registerComponent`, so the augment-slot metadata is intact.
const maneuverPlannerDef = getComponent("maneuver-planner");

// currentUT now reads off `useViewUt()` (the `t.universalTime` client
// migration) instead of the legacy `DataSource`: every test below still
// emits `t.universalTime` (now a dead, harmless emit) so this constant
// mirrors that same value via a minimal pinned `TelemetryProvider`. Nothing
// is carried, so every other read/command stays on the legacy source
// exactly as before: the two trigger-fire tests below mount their OWN
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
// `o.maneuverNodes` (behind `useManeuverNodes`) now reads the
// `vessel.maneuver.legacy` derived channel, reshaping the real
// `vessel.maneuver` wire topic: not one of the two derived channels
// `setupStreamFixture` pre-registers (`vesselStateChannel`/
// `spaceCenterStateChannel`), so register it here.

/**
 * Reconstructs the legacy `o.addManeuverNode[...]` action string from a
 * dispatched `{command, args}` pair, lets the trigger-fire tests below keep
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
 * Reuses `utFixture`'s client/store but with a WIDER carriedChannels set,
 * for the two trigger-fire tests below, which need `vessel.maneuver.add`
 * carried so `LocalManeuverTriggerService.fire()`'s `dispatchActiveCommand`
 * actually routes, without widening the SHARED module-level `utFixture`
 * every other test in this file also mounts (that would also route the
 * regular "Add Node" button's `execute("data", ...)`: the same carried-gated
 * `useCommand` shim: off its legacy `onExecute` capture).
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
// subscribed (the realistic "proves ref-counted subscribe happened" gate,
// see its own doc comment). No widget in THIS test reads `vessel.orbit`/
// `vessel.identity`/`system.bodies` reactively (`LocalManeuverTriggerService`'s
// non-hook accessors sample the store directly, with no subscription of
// their own: see `sampleActiveTopic`'s doc comment in `sitrep-client`), so
// this stands in for "some other live widget already has it subscribed",
// the same assumption production relies on. `system.bodies` feeds the
// derived `vessel.state.apoapsisAlt`/`periapsisAlt` reference-body radius:
// the trigger tests below arm on `o.ApA`, which only resolves once it's fed.
utFixture.client.subscribe("vessel.orbit", () => {});
utFixture.client.subscribe("vessel.identity", () => {});
utFixture.client.subscribe("system.bodies", () => {});

/**
 * `useViewUt()`'s pinned value only lands once `ViewClock.onFrame`'s
 * per-frame tick has run at least once (the hook's synchronous initial seed
 * ignores `scrubTo`: see its own doc comment in `sitrep-client/src/context.tsx`),
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
  { key: "dv.summary" },
];

/**
 * `LocalManeuverTriggerService` (the trigger-editor's fallback service,
 * since this test never supplies a `providedTriggerService`) now reads its
 * OWN orbit/target/vessel-identity fields off the stream
 * (`getVesselOrbit()`/`getVesselTarget()`/`getVesselIdentity()`/
 * `getVesselState()`) instead of the legacy `o.*`/`tar.o.*`/`v.name` keys,
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

/**
 * `o.maneuverNodes` (behind `useManeuverNodes`) now reads the
 * `vessel.maneuver.legacy` derived channel off the real `vessel.maneuver`
 * wire topic: no legacy fallback of its own. `id` defaults to a plain
 * positional-index string (not a real guid) since most callers below only
 * care about the node's DELTA-V shape, not its id round-trip (that's
 * covered end-to-end, with a real guid, by `stream.test.tsx`).
 */
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
      patches: [],
    })),
  });
}

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
  // Stream leg: see the doc comment above. Kerbin's radius (600_000m) is
  // what turns the fixture's apoapsisRADIUS (707_000, sma·1.01) into the
  // apoapsisALT (107_000) the legacy `o.ApA` emit above already carries,
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
    // No wire keys on an operator surface: the panel used to list the data
    // keys it was waiting on, which named a transport this widget stopped
    // reading at the Sitrep migration.
    expect(screen.queryByText(/o\.sma|t\.universalTime/)).toBeNull();
    // O5: the plain no-data case must NOT show the hyperbolic notice, only
    // a hyperbolic `vessel.orbit.ecc` does that (see the dedicated test below).
    expect(screen.queryByText(/Hyperbolic trajectory/i)).toBeNull();
  });

  // O5: ManeuverPlanner conflated "hyperbolic orbit" with "no data", both
  // used to fall into the same generic "Waiting for telemetry" empty state
  // because `buildCurrentOrbit` legitimately returns null on a hyperbolic
  // orbit (no apoapsis, so ApR/timeToAp come back NaN/null even once real
  // telemetry has landed). The fix reads the raw `vessel.orbit.ecc` (always
  // present once the orbit topic arrives, independent of the derived
  // `currentOrbit`) to tell the two cases apart.
  it("shows a distinct hyperbolic-trajectory notice (not the generic waiting panel) when ecc >= 1", async () => {
    render(
      <utFixture.Provider>
        <ManeuverPlannerComponent id="mnv" config={{}} />
      </utFixture.Provider>,
    );
    act(() => {
      // Hyperbolic: ecc >= 1, sma conventionally negative. Real telemetry
      // has arrived (unlike the plain no-data case above), it's just an
      // orbit shape the planner can't offer circularize/rendezvous presets
      // for.
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
    // The derived `vessel.maneuver.legacy` channel only recomputes once the
    // provider's ingest->beginFrame() rAF tick has run, flush it (a bare
    // synchronous act() samples a stale frame, which on the shared
    // module-level utFixture store is whatever the prior test last left).
    await flushViewUt();
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
      // a tiny vessel ΔV budget: the planner should refuse the commit.
      // sma·(1±ecc) -> ApR ≈ 1_000_000 / PeR ≈ 700_000, same numbers the
      // pre-migration legacy `o.ApR`/`o.PeR` emits carried directly.
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
      // The vessel total is the wire's own figure, not the sum of the rows
      // above: `dv.stages` is OperatingStageInfo and this is accumulated over
      // WorkingStageInfo, so the client never adds the rows up.
      utFixture.emit("dv.summary", {
        stageCount: 1,
        totalDvVac: 25,
        totalDvAsl: 25,
        totalDvActual: 25,
      });
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
    expect(visibleText(banner)).toMatch(/shortfall/i);
    expect(visibleText(banner)).toMatch(/short\.?$/i);

    const addBtn = screen.getByRole("button", { name: /^add node$/i });
    expect(addBtn).toBeDisabled();
  });

  /*
   * A SPENT craft, and the case the zero sentinel hid.
   *
   * The ΔV total used to be reported as `0` for four different situations: nothing
   * arrived, the sim confirmed no figure, the reading went stale, and the vessel
   * genuinely has no ΔV left. The planner read that 0 as "unknown" and set
   * `feasible = null`, which is RIGHT for the first three and disarms the fourth: null
   * shows no SHORT chip, and `feasible === false` is the only thing that disables the
   * commit, so an out-of-fuel craft would accept a plan it cannot fly and say nothing.
   * `DELTA_V_BUDGET` keeps the two apart with `null` versus a real `0`.
   *
   * Its OWN fixture, deliberately. The module-level `utFixture` is shared across this
   * file and topic values are sticky, so emitting a zero-ΔV budget on it poisons
   * every later test that expects a dispatchable plan (it did, once).
   */
  it("refuses the commit for a craft whose budget reports genuinely zero delta-v", async () => {
    const spent = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: UT_FIXTURE_VALUE,
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
      // A real stage list whose ΔV is really zero: a fact about the vessel, not the
      // absence of one.
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
      // A real total that is really zero, which is telemetry about the vessel,
      // and rather emphatic telemetry.
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
    // The trigger's fire dispatch now rides `dispatchActiveCommand`, not
    // the legacy `onExecute` above: capture it off the shared stream
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

    // Pick the apoapsis-altitude key via the data-key search input. The
    // picker offers the path the trigger reads from, not a flat alias for it.
    const picker = screen.getByPlaceholderText("Search telemetry...");
    await user.click(picker);
    await user.type(picker, "vessel.state.apoapsisAlt{Enter}");

    // Set threshold above current ApA (107000) so it doesn't fire on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "200000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    // Armed row visible, no burn dispatched yet.
    expect(visibleText()).toMatch(/vessel\.state\.apoapsisAlt >= 200000/);
    expect(calls).toHaveLength(0);

    // Apoapsis climbs past the threshold: trigger fires and the burn is
    // dispatched with the frozen circularize-apo preset. The trigger's
    // `dataKey` read (`getValue`) samples the derived
    // `vessel.state.apoapsisAlt` off the STREAM, so the crossing has to come from a new
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
    expect(
      screen.queryByText(/vessel\.state\.apoapsisAlt >= 200000/),
    ).toBeNull();
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
    // See the previous test's identical note: the trigger's fire dispatch
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
    await user.type(picker, "vessel.state.apoapsisAlt{Enter}");
    // Threshold below current ApA (107000): should fire on arm.
    const valueInput = screen.getByLabelText(/^Value$/);
    await user.clear(valueInput);
    await user.type(valueInput, "50000");

    await user.click(screen.getByRole("button", { name: /^arm$/i }));

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^o\.addManeuverNode\[/);
  });

  it("flashes a completed node green for 10s then auto-removes it from KSP", async () => {
    // Auto-remove (delayed-command-ux migration) dispatches unconditionally
    // via `useCommand` against the real stream: no carried-gate, no legacy
    // fallback, so it's captured off `utFixture`'s command handler, same
    // pattern the trigger-fire tests above use.
    //
    // The stream id is deliberately NOT "0". The stream guid and the legacy
    // positional index are two different things, and this test cannot tell a
    // correct guid dispatch apart from a raw-index one unless they disagree:
    // with `emitManeuverNode`'s default id (String(index)) both produce the
    // identical assertion.
    const NODE_GUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    const calls: string[] = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.remove") {
        const a = args as { nodeId?: string };
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
      // The derived `vessel.maneuver.legacy` channel only recomputes once
      // `TelemetryProvider`'s ingest->beginFrame() requestAnimationFrame
      // tick has run (`context.tsx`'s `scheduleFrame`), fake timers (below)
      // fake `requestAnimationFrame` too, so it needs an explicit advance,
      // not just a microtask flush.
      act(() => {
        emitManeuverNode([{ id: NODE_GUID, ut: 1_000_120, dvPrograde: 30 }]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      // Initial render: live row shows "30 m/s", not the completion banner.
      expect(visibleText()).toMatch(/30 m\/s/);
      expect(screen.queryByText(/Burn complete/i)).toBeNull();

      // Burn completes: remaining ΔV drops below threshold.
      act(() => {
        emitManeuverNode([{ id: NODE_GUID, ut: 1_000_120, dvPrograde: 0.1 }]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      // Green-flash state visible, but no removal call yet.
      expect(screen.getByText(/Burn complete/i)).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      // Advance past the 10 s hold, auto-remove should fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(calls).toEqual([`o.removeManeuverNode[${NODE_GUID}]`]);
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

  it("sends vessel.maneuver.update with edited values via the per-node editor", async () => {
    const user = userEvent.setup();
    // Edit flow: click Edit on a planned-node row, change the prograde, Save.
    // Verifies the dispatched args and vector convention: `{nodeId, ut,
    // radialOut, normal, prograde}`, same convention as add. Dispatch
    // (delayed-command-ux migration) is unconditional via `useCommand`
    // against the real stream, captured off `utFixture`'s command handler.
    const calls: Array<{
      nodeId?: string;
      ut?: number;
      radialOut?: number;
      normal?: number;
      prograde?: number;
    }> = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.update") {
        calls.push(
          args as {
            nodeId?: string;
            ut?: number;
            radialOut?: number;
            normal?: number;
            prograde?: number;
          },
        );
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
    // Flush the provider frame so the derived `vessel.maneuver.legacy` channel
    // recomputes to THIS test's node (dvPrograde 30) rather than sampling the
    // stale last frame the shared module-level utFixture store carries from a
    // prior test.
    await flushViewUt();

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
    const sent = calls[0];
    expect(sent.nodeId).toBe("0");
    expect(sent.ut).toBeCloseTo(1_000_120, 0);
    expect(sent.radialOut).toBe(0);
    expect(sent.normal).toBe(0);
    expect(sent.prograde).toBe(45);
  });

  it("sends vessel.maneuver.add args with the [radialOut, normal, prograde] vector convention", async () => {
    const user = userEvent.setup();
    // KSP's ManeuverNode.DeltaV is a Vector3d(radialOut, normal, prograde),
    // confirmed by kOS's Node.cs, and the actuator passes its `[ut,x,y,z]`
    // args straight to OnGizmoUpdated(Vector3d(x,y,z), ut) in that order.
    // Mixing this up turns a pure-prograde Hohmann burn into a pure-radial
    // one, and the vessel ends up pointing straight up instead of along
    // velocity.
    // Dispatch (delayed-command-ux migration) is unconditional via
    // `useCommand` against the real stream, captured off `utFixture`'s
    // command handler.
    const calls: Array<{
      ut?: number;
      radialOut?: number;
      normal?: number;
      prograde?: number;
    }> = [];
    utFixture.transport.setCommandHandler((command, args) => {
      if (command === "vessel.maneuver.add") {
        calls.push(
          args as {
            ut?: number;
            radialOut?: number;
            normal?: number;
            prograde?: number;
          },
        );
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

    // Default preset is circularize-apo: a positive prograde burn,
    // normal=0, radial=0.
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
    // The widget module registers no augments of its own, but a test may have
    // bound one into a slot: reset so it never leaks into a later test.
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
    // The frame still renders normally, an unfilled slot contributes no DOM.
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
        {/* The identity the dashboard supplies: `Panel` completes
          `${componentId}.${segment}` from it for the universal `sections`
          and `actions` seams. */}
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
