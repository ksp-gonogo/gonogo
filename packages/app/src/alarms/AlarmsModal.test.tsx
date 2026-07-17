import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  type ManeuverNodeWirePayload,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselManeuverLegacyChannel,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmsModal } from "./AlarmsModal";
import type { Alarm, AlarmSnapshot } from "./types";
import {
  DEFAULT_LEAD_SECONDS,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
} from "./types";

// AlarmsModal reads useValueKeys("data") for the threshold-trigger key
// picker. These describe blocks don't exercise that path (the onFire editor
// lives on the time-trigger form too, and the presets block only reads
// telemetry VALUES, not the schema), so registering a mock "data"
// `DataSource` here is harmless — but note it does NOT prove the real
// threshold-picker path works. That's covered separately, with no "data"
// `DataSource` registered at all, in the "threshold trigger key picker"
// describe block at the bottom of this file (Finding 1: the legacy "data"
// source was deleted in `806e7fe2`, so the real app never has one
// registered either).
/**
 * `DataKeyPicker`'s search input and the native `<select>` for the onFire
 * action-group both carry the implicit/explicit ARIA `combobox` role, and
 * the picker's input has no accessible name (a pre-existing gap — its
 * `<FieldLabel htmlFor="alarm-data-key">` doesn't actually connect to
 * anything, since `DataKeyPicker` doesn't accept an `id` prop), so
 * `getByRole("combobox")` alone is ambiguous. Disambiguate by tag: the
 * picker renders an `<input>`, the action-group field renders a `<select>`.
 */
function getDataKeyCombobox(): HTMLElement {
  const combobox = screen
    .getAllByRole("combobox")
    .find((el) => el.tagName === "INPUT");
  if (!combobox) throw new Error("DataKeyPicker combobox input not found");
  return combobox;
}

function registerStubDataSource() {
  clearRegistry();
  registerDataSource(new MockDataSource({ id: "data", name: "Stub" }));
}

function makeSnapshot(alarms: Alarm[] = []): AlarmSnapshot {
  return {
    alarms,
    ut: 1000,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
  };
}

describe("AlarmsModal onFire editor", () => {
  beforeEach(registerStubDataSource);

  it("attaches an action group to a new alarm and forwards it via onAdd", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/^name$/i), "Stage");

    const picker = screen.getByLabelText(/action group to fire/i);
    await user.selectOptions(picker, "f.ag1");
    await user.click(screen.getByRole("button", { name: /\+ add action/i }));

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].onFire).toEqual([
      { kind: "action-group", action: "f.ag1" },
    ]);
  });

  it("clears an attached action with × and forwards onFire: [] to onUpdate", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const alarm: Alarm = {
      id: "a-1",
      name: "Existing",
      trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      state: "pending",
      createdBy: "main",
      createdAt: 1_700_000_000_000,
      onFire: [{ kind: "action-group", action: "f.stage" }],
    };
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot([alarm])}
        onAdd={() => {}}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />,
    );

    const removeButton = await screen.findByRole("button", {
      name: /remove f\.stage from existing/i,
    });
    await user.click(removeButton);

    expect(onUpdate).toHaveBeenCalledWith("a-1", { onFire: [] });
  });

  it("seeds the draft from prefill and round-trips it through onAdd", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
        prefill={{
          name: "Auto-drafted",
          onFire: [{ kind: "action-group", action: "f.abort" }],
        }}
      />,
    );

    // Prefilled name is visible — operator only needs to confirm.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Auto-drafted");
    // Prefilled action is visible in the editor's chip list. The remove
    // button's aria-label is the most stable handle since the chip text
    // gets split across nested spans.
    expect(
      screen.getByRole("button", { name: /^remove f\.abort$/i }),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd.mock.calls[0][0].onFire).toEqual([
      { kind: "action-group", action: "f.abort" },
    ]);
  });
});

// P1 de-Telemachus: `useManeuverNodes` reads the `vessel.maneuver.legacy`
// derived channel (reshaping the raw `vessel.maneuver` wire topic) via
// `useStream` — it never had a legacy "data" `DataSource` behind it. So the
// preset tests below feed a real `TelemetryProvider`/`TelemetryClient` stream
// (emitting raw wire nodes), not the MockDataSource. Only `ut` matters to the
// preset's soonest-future-node pick; the rest satisfy the wire shape.
function makeWireNode(id: string, ut: number): ManeuverNodeWirePayload {
  return {
    id,
    ut,
    dvRadial: 10,
    dvNormal: 0,
    dvPrograde: 0,
    patches: [],
  };
}

// The eight `vesselStateChannel` inputs plus `vessel.maneuver` (the
// `vessel.maneuver.legacy` reshape's input) — carrying all of them makes both
// the derived `vessel.state.*` fields (`timeToAp`/`timeToPe`) and the maneuver
// node list resolvable off the stream.
const PRESET_CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.maneuver",
];

// Mount AlarmsModal inside a real TelemetryProvider so both `useManeuverNodes`
// (`vessel.maneuver.legacy`) and the apoapsis/periapsis presets (derived
// `vessel.state.timeToAp`/`timeToPe`) resolve off the stream. `pinnedUt` fixes
// the view clock so an emitted orbit derives a deterministic time-to-apsis.
function renderWithStream(modal: ReactElement, pinnedUt?: number) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);
  store.registerDerivedChannel(vesselManeuverLegacyChannel);
  if (pinnedUt !== undefined) clock.scrubTo(pinnedUt);

  render(
    <TelemetryProvider
      client={client}
      store={store}
      carriedChannels={PRESET_CARRIED}
    >
      {modal}
    </TelemetryProvider>,
  );

  const emit = (topic: string, payload: unknown) => {
    act(() => {
      transport.emit(topic, payload);
    });
  };
  const emitNodes = (uts: number[]) => {
    emit("vessel.maneuver", {
      nodes: uts.map((ut, i) => makeWireNode(String.fromCharCode(97 + i), ut)),
    });
  };
  return { transport, emit, emitNodes };
}

// Kerbin's GM and a circular-ish parking orbit. With `epoch === pinnedUt` and
// `meanAnomalyAtEpoch === 0` the vessel sits at periapsis at the view frame, so
// the derived `timeToAp` is exactly half the orbital period and `timeToPe` is
// 0 — a hand-checkable value with no reliance on the Kepler solver's internals.
const ORBIT_MU = 3.5316e12;
const ORBIT_SMA = 700_000;
const ORBIT_EPOCH = 10;
const TIME_TO_AP = Math.PI * Math.sqrt(ORBIT_SMA ** 3 / ORBIT_MU);

// Emit an orbit whose derived `timeToAp` is `TIME_TO_AP` (mean anomaly 0 =
// periapsis) or 0 (mean anomaly π = apoapsis, so the apoapsis preset's `> 0`
// gate hides it).
function emitOrbitAtApsis(
  emit: (topic: string, payload: unknown) => void,
  meanAnomalyAtEpoch: number,
) {
  emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: ORBIT_SMA,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch,
    epoch: ORBIT_EPOCH,
    mu: ORBIT_MU,
  });
}

describe("AlarmsModal recommended presets", () => {
  beforeEach(registerStubDataSource);

  it("hides the Recommended section when no preset data is live", () => {
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /warp to apoapsis/i }),
    ).toBeNull();
  });

  it("shows the apoapsis preset for a live finite timeToAp and hides it when it drops to zero", async () => {
    const user = userEvent.setup();
    const { emit } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
    );

    // At periapsis (mean anomaly 0) → timeToAp is half a period → the apoapsis
    // preset appears once the section is expanded.
    emitOrbitAtApsis(emit, 0);
    await user.click(
      await screen.findByRole("button", { name: /recommended/i }),
    );
    expect(
      await screen.findByRole("button", { name: /warp to apoapsis/i }),
    ).toBeDefined();

    // At apoapsis (mean anomaly π) → timeToAp is 0. Scheduling ut+0 would fire
    // instantly, so the gate (> 0) drops the apoapsis preset. Proving the
    // transition discriminates the gate from the default-hidden state. (The
    // periapsis preset takes its place — timeToPe is now half a period — so
    // the section itself stays open.)
    emitOrbitAtApsis(emit, Math.PI);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /warp to apoapsis/i }),
      ).toBeNull(),
    );
  });

  it("offers and creates a 'Warp to apoapsis' time alarm once the orbit is live", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    // Snapshot UT is 1000; the derived timeToAp (half period) anchors the
    // alarm at 1000 + TIME_TO_AP.
    const { emit } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
    );

    emitOrbitAtApsis(emit, 0);

    // The collapsible "Recommended" toggle appears once data is live.
    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);

    const apo = await screen.findByRole("button", {
      name: /warp to apoapsis/i,
    });
    await user.click(apo);

    expect(onAdd).toHaveBeenCalledTimes(1);
    const alarm = onAdd.mock.calls[0][0];
    expect(alarm).toMatchObject({
      name: "Warp to apoapsis",
      trigger: { kind: "time", leadSeconds: DEFAULT_LEAD_SECONDS },
    });
    expect(alarm.trigger.ut).toBeCloseTo(1000 + TIME_TO_AP, 3);
    // Presets are notify-only — no onFire side effect attached.
    expect(alarm.onFire).toBeUndefined();
  });

  it("offers a 'Warp to next maneuver' preset anchored to the node's absolute UT", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { emitNodes } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    // Node UT is absolute (2500), so the alarm ut should equal it exactly —
    // no offset.
    emitNodes([2500]);

    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);

    const node = await screen.findByRole("button", {
      name: /warp to next maneuver/i,
    });
    await user.click(node);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      name: "Warp to next maneuver",
      trigger: { kind: "time", ut: 2500, leadSeconds: DEFAULT_LEAD_SECONDS },
    });
  });

  it("picks the soonest future node and ignores a lingering past one", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { emitNodes } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    // Snapshot UT is 1000. A past node (500) and two future ones (4000,
    // 2200) — the preset must resolve to the soonest future (2200), never
    // the past node.
    emitNodes([500, 4000, 2200]);

    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);
    await user.click(
      await screen.findByRole("button", { name: /warp to next maneuver/i }),
    );

    expect(onAdd.mock.calls[0][0].trigger).toMatchObject({
      kind: "time",
      ut: 2200,
    });
  });

  it("hides the maneuver preset when the only node is in the past", async () => {
    const { emitNodes } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    // First prove the preset CAN appear for a future node...
    emitNodes([3000]);
    expect(
      await screen.findByRole("button", { name: /recommended/i }),
    ).toBeDefined();

    // ...then a node-list with only a past node (500 < UT 1000) hides it,
    // proving the future-node filter rather than the default-hidden state.
    // Stream delivery is async (unlike the synchronous legacy DataSource), so
    // wait for the re-render that drops the preset.
    emitNodes([500]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull(),
    );
  });
});

describe("AlarmsModal threshold trigger key picker", () => {
  // Deliberately NOT registering a mock "data" `DataSource` — the real app
  // never has one (deleted in `806e7fe2`). This is the config-UI proof for
  // Finding 1: before the fix, `useValueKeys("data")` always returned `[]`
  // here and the picker showed nothing but "No matches", making it
  // impossible to set a threshold alarm at all.
  beforeEach(clearRegistry);

  it("offers real telemetry keys with no 'data' DataSource registered", async () => {
    const user = userEvent.setup();
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /when telemetry/i }));
    await user.click(getDataKeyCombobox());

    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(
      options.some((o) => o.textContent?.toLowerCase().includes("altitude")),
    ).toBe(true);
  });

  it("lets an operator pick a key and add a threshold alarm end to end", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/^name$/i), "Crossed 70 km");
    await user.click(screen.getByRole("tab", { name: /when telemetry/i }));
    await user.click(getDataKeyCombobox());
    const altitudeOption = (await screen.findAllByRole("option")).find((o) =>
      o.textContent?.toLowerCase().includes("altitude"),
    );
    expect(altitudeOption).toBeDefined();
    if (altitudeOption) await user.click(altitudeOption);

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].trigger).toMatchObject({
      kind: "threshold",
      dataKey: "v.altitude",
    });
  });
});
