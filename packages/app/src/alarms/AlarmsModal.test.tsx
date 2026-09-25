import {
  clearRegistry,
  deriveTimeContexts,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import {
  type ManeuverNode,
  PropagationHorizonKind,
  TrajectoryKind,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  MockDataSource,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmsModal, conditionWithheld } from "./AlarmsModal";
import type { Alarm, AlarmSnapshot } from "./types";
import {
  DEFAULT_LEAD_SECONDS,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
} from "./types";

// AlarmsModal reads useValueKeys("data") for the threshold-trigger key
// picker. These describe blocks don't exercise that path (the onFire editor
// lives on the time-trigger form too, and the presets block only reads
// telemetry VALUES, not the schema), so registering a mock "data"
// `DataSource` here is harmless, but note it does NOT prove the real
// threshold-picker path works. That's covered separately, with no "data"
// `DataSource` registered at all, in the "threshold trigger key picker"
// describe block at the bottom of this file (the legacy "data" source is
// deleted, so the real app never has one registered either).
/**
 * `DataKeyPicker`'s search input and the native `<select>` for the onFire
 * action-group both carry the implicit/explicit ARIA `combobox` role, and
 * the picker's input has no accessible name (a pre-existing gap, its
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

/**
 * The onFire picker lists the action-group registry, whose CUSTOM half
 * (`AG1`..`AG10`) is derived from live `vessel.control` telemetry rather than
 * hardcoded: so a bare `render()` shows only the stock singletons and `AG1`
 * isn't a selectable option at all. Mount the minimal real stream carrying the
 * ten stock customs, exactly as the mod sends them.
 */
function renderWithControlStream(ui: React.ReactElement, parts?: unknown) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);
  const result = render(
    <TelemetryProvider
      client={client}
      store={store}
      carriedChannels={new Set(["vessel.control", "vessel.parts"])}
    >
      {ui}
    </TelemetryProvider>,
  );
  act(() => {
    transport.emit("vessel.control", {
      sasMode: 0,
      throttle: 0,
      actionGroups: Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        name: `AG${i + 1}`,
        state: false,
      })),
    });
    if (parts !== undefined) {
      transport.emit("vessel.parts", parts);
    }
    store.beginFrame();
  });
  return result;
}

describe("AlarmsModal onFire editor", () => {
  beforeEach(registerStubDataSource);

  it("attaches an action group to a new alarm and forwards it via onAdd", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    renderWithControlStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/^name$/i), "Stage");

    const picker = await screen.findByLabelText(/action group to fire/i);
    await screen.findByRole("option", { name: /^AG1 \(AG1\)/ });
    await user.selectOptions(picker, "AG1");
    await user.click(screen.getByRole("button", { name: /\+ add action/i }));

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].onFire).toEqual([
      { kind: "action-group", action: "AG1" },
    ]);
  });

  it("derives the action-group caption from the parts tree (vessel.parts actionBindings)", async () => {
    renderWithControlStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      // One part with an action bound to Custom01 (== the AG1 group), the
      // caption now derives from this, not the retired f.ag.bindings shim.
      {
        parts: [
          {
            id: "1",
            name: "solarPanel",
            title: "OX-4L Solar Panel",
            actionBindings: [
              {
                action: "Toggle Solar Panel",
                groups: ["Custom01"],
                groupsMask: 128,
              },
            ],
          },
        ],
        meta: {},
      },
    );

    // The AG1 option's caption is derived from the part's actionBindings
    // (Custom01 -> "Toggle Solar Panel"), proving the shim replacement works.
    await screen.findByLabelText(/action group to fire/i);
    await screen.findByRole("option", {
      name: /AG1 \(AG1\): Toggle Solar Panel/,
    });
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
      onFire: [{ kind: "action-group", action: "Stage" }],
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
      name: /remove Stage from existing/i,
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

    // Prefilled name is visible, operator only needs to confirm.
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

// `useManeuverNodes` reads the `vessel.maneuver` wire topic through
// `useStream`, so the preset tests below feed a real
// `TelemetryProvider`/`TelemetryClient` stream rather than a MockDataSource.
// Only `ut` matters to the preset's soonest-future-node pick; the rest
// satisfy the wire shape.

function makeWireNode(id: string, ut: number): ManeuverNode {
  // Wire-shaped, then wrapped: `emit` does this to a real frame, and these
  // nodes are handed to the store directly.
  return wrapTypePayload("ManeuverNode", {
    id,
    ut,
    dvRadial: 10,
    dvNormal: 0,
    dvPrograde: 0,
    patches: [],
  } as Record<string, unknown>) as unknown as ManeuverNode;
}

// The eight `vesselStateChannel` inputs plus `vessel.maneuver`: carrying all
// of them makes both the derived `vessel.state.*` fields
// (`timeToAp`/`timeToPe`) and the maneuver node list resolvable off the
// stream.
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
// and the apoapsis/periapsis presets (derived
// `vessel.state.timeToAp`/`timeToPe`) resolve off the stream. `pinnedUt` fixes
// the view clock so an emitted orbit derives a deterministic time-to-apsis.
function renderWithStream(
  modal: ReactElement,
  pinnedUt?: number,
  delaySeconds = 0,
) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => delaySeconds,
  });
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);
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
// 0: a hand-checkable value with no reliance on the Kepler solver's internals.
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
    // The reach and shape a live sample states. The countdowns behind these
    // presets are solved through the conic over these elements, and without
    // them nothing vouches for that conic, so no preset appears at all.
    horizon: {
      kind: PropagationHorizonKind.Unbounded,
      trajectoryKind: TrajectoryKind.Analytic,
    },
  });
  // That conic's other declared input.
  emit("system.bodies", {
    bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }],
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
      screen.queryByRole("button", { name: /alarm at apoapsis/i }),
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
      await screen.findByRole("button", { name: /alarm at apoapsis/i }),
    ).toBeDefined();

    // At apoapsis (mean anomaly π) → timeToAp is 0. Scheduling ut+0 would fire
    // instantly, so the gate (> 0) drops the apoapsis preset. Proving the
    // transition discriminates the gate from the default-hidden state. (The
    // periapsis preset takes its place: timeToPe is now half a period, so
    // the section itself stays open.)
    emitOrbitAtApsis(emit, Math.PI);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /alarm at apoapsis/i }),
      ).toBeNull(),
    );
  });

  it("offers and creates an apoapsis time alarm once the orbit is live", async () => {
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
      name: /alarm at apoapsis/i,
    });
    await user.click(apo);

    expect(onAdd).toHaveBeenCalledTimes(1);
    const alarm = onAdd.mock.calls[0][0];
    expect(alarm).toMatchObject({
      name: "Apoapsis",
      trigger: { kind: "time", leadSeconds: DEFAULT_LEAD_SECONDS },
    });
    expect(alarm.trigger.ut).toBeCloseTo(1000 + TIME_TO_AP, 3);
    // Presets are notify-only, no onFire side effect attached.
    expect(alarm.onFire).toBeUndefined();
  });

  /*
   * The defect this pair exists for, and the second half of its history.
   * `timeToAp` is read off a Delayed channel at the view UT, so the sum is the
   * TRUE SCET of apoapsis. The alarm used to be evaluated on this side against
   * the view clock, which reaches that instant one light-time late, so the
   * trigger had a light-time subtracted from it to compensate.
   *
   * The mod compares against the game's own universal time now, which is the
   * clock the SCET is already on, so the subtraction became the error it was
   * invented to cancel. The alarm carries the apsis instant as it stands.
   */
  it("arms an apsis alarm at the event's own instant, with no light-time subtracted", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const owlt = 240;
    const { emit } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
      owlt,
    );

    emitOrbitAtApsis(emit, 0);

    await user.click(
      await screen.findByRole("button", { name: /recommended/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /alarm at apoapsis/i }),
    );

    expect(onAdd.mock.calls[0][0].trigger.ut).toBeCloseTo(1000 + TIME_TO_AP, 3);
  });

  /* The SCET is what the button states, and it says which clock it is on: the
     operator is being told when apoapsis happens out there, not when the alarm
     will reach them. */
  it("states the apsis time as a SCET while the craft is delayed", async () => {
    const user = userEvent.setup();
    const { emit } = renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
      240,
    );

    emitOrbitAtApsis(emit, 0);
    await user.click(
      await screen.findByRole("button", { name: /recommended/i }),
    );
    const apo = await screen.findByRole("button", {
      name: /alarm at apoapsis/i,
    });
    expect(within(apo).getByText("SCET")).toBeDefined();
  });

  /* The same button on a LAN session carries no qualifier at all: there is one
     clock, and labelling it would put a word on every instant on the screen.
     Without this the test above passes for a component that always labels. */
  it("CONTROL: states no clock at all with no delay in force", async () => {
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

    emitOrbitAtApsis(emit, 0);
    await user.click(
      await screen.findByRole("button", { name: /recommended/i }),
    );
    const apo = await screen.findByRole("button", {
      name: /alarm at apoapsis/i,
    });
    expect(within(apo).queryByText("SCET")).toBeNull();
  });

  it("offers a next-maneuver preset anchored to the node's absolute UT", async () => {
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

    // Node UT is absolute (2500), so the alarm ut should equal it exactly,
    // no offset.
    emitNodes([2500]);

    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);

    const node = await screen.findByRole("button", {
      name: /alarm at next maneuver/i,
    });
    await user.click(node);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      name: "Next maneuver",
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
    // 2200): the preset must resolve to the soonest future (2200), never
    // the past node.
    emitNodes([500, 4000, 2200]);

    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);
    await user.click(
      await screen.findByRole("button", { name: /alarm at next maneuver/i }),
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
  // Deliberately NOT registering a mock "data" `DataSource`: the real app
  // never has one (it's deleted).
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

    await user.click(screen.getByRole("radio", { name: /at telemetry/i }));
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
    await user.click(screen.getByRole("radio", { name: /at telemetry/i }));
    await user.click(getDataKeyCombobox());
    // Names the subject rather than taking the first match on "altitude": the
    // catalogue offers several, and a test that picks whichever sorts first is
    // asserting the sort order rather than the flow.
    const altitudeOption = (await screen.findAllByRole("option")).find((o) =>
      o.textContent?.includes("Altitude ASL"),
    );
    expect(altitudeOption).toBeDefined();
    if (altitudeOption) await user.click(altitudeOption);

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].trigger).toMatchObject({
      kind: "threshold",
      dataKey: "vessel.flight.altitudeAsl",
    });
  });

  /**
   * "An alarm for SCET 100km altitude". The picker offers altitude under the
   * Topic the mod publishes, so the address the arm carries is the one the
   * simulation can read.
   */
  it("arms a SCET threshold at the Topic the simulation publishes", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
      240,
    );

    await user.type(screen.getByLabelText(/^name$/i), "Above 100 km");
    await user.click(screen.getByRole("radio", { name: /at telemetry/i }));
    await user.click(screen.getByRole("radio", { name: /^scet$/i }));
    await user.click(getDataKeyCombobox());
    const altitudeOption = (await screen.findAllByRole("option")).find((o) =>
      o.textContent?.includes("Altitude ASL"),
    );
    expect(altitudeOption).toBeDefined();
    if (altitudeOption) await user.click(altitudeOption);

    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));
    expect(onAdd.mock.calls[0][0].trigger).toMatchObject({
      kind: "threshold",
      vantage: "scet",
      // Split straight off the catalogue entry, which carries both halves.
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
      // And the flat key beside it, because it is what the row reads out and
      // what a command-vantage copy of the same alarm would compare.
      dataKey: "vessel.flight.altitudeAsl",
    });
  });
});

/**
 * The trigger-kind control switches which fields the ONE "Add alarm" form
 * shows. It is not a tab set: Name is shared, only the middle of the form
 * differs, and there are no tab panels for the tabs to control. It had
 * `role="tablist"`/`role="tab"` anyway, which is an ARIA claim the markup
 * does not honour: a screen-reader user is told "tab" and reaches for arrow
 * keys that do nothing, and both controls sit in the tab order where a
 * chosen-one-of-many control should expose only its selection.
 */
describe("AlarmsModal trigger-kind control", () => {
  beforeEach(registerStubDataSource);

  function renderModal() {
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );
    return screen.getByRole("radiogroup", { name: /trigger kind/i });
  }

  it("is a radio group over one form, not a tab set", () => {
    const group = renderModal();
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    // The negative: a tab role here would be a promise of panels we do not keep.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
  });

  it("moves the selection with arrow keys and wraps", async () => {
    const user = userEvent.setup();
    const group = renderModal();
    const [atUt, whenTelemetry] = within(group).getAllByRole("radio");

    atUt.focus();
    await user.keyboard("{ArrowRight}");
    expect(whenTelemetry).toHaveAttribute("aria-checked", "true");
    expect(whenTelemetry).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(atUt).toHaveAttribute("aria-checked", "true");
    expect(atUt).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(whenTelemetry).toHaveAttribute("aria-checked", "true");
  });

  it("exposes only the selected option to the tab order", async () => {
    const user = userEvent.setup();
    const group = renderModal();
    const [atUt, whenTelemetry] = within(group).getAllByRole("radio");

    expect(atUt).toHaveAttribute("tabindex", "0");
    expect(whenTelemetry).toHaveAttribute("tabindex", "-1");

    await user.click(whenTelemetry);
    expect(whenTelemetry).toHaveAttribute("tabindex", "0");
    expect(atUt).toHaveAttribute("tabindex", "-1");
  });
});

describe("AlarmsModal provenance", () => {
  /**
   * An alarm the operator did not create is indistinguishable from one they set
   * and forgot unless the row says otherwise, and the difference is what tells
   * them whether deleting it is safe.
   */
  function requestedAlarm(): Alarm {
    return {
      id: "a-uplink",
      name: "Launch pad upgrade complete",
      trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      state: "pending",
      createdBy: "main",
      requestedBy: {
        uplinkId: "rp1",
        uplinkName: "RP-1",
        key: "facility-upgrade:LaunchPad",
      },
      createdAt: 1_700_000_000_000,
    };
  }

  it("names the Uplink that asked for an alarm", async () => {
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot([requestedAlarm()])}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await screen.findByText("Launch pad upgrade complete");
    expect(screen.getByText(/Requested by RP-1/)).toBeInTheDocument();
  });

  it("says nothing about provenance on an alarm the operator made", async () => {
    const { requestedBy: _dropped, ...operatorAlarm } = requestedAlarm();
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot([operatorAlarm])}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await screen.findByText("Launch pad upgrade complete");
    expect(screen.queryByText(/Requested by/)).not.toBeInTheDocument();
  });
});

/**
 * A fire discovered after the fact runs no actions, and a row that still read
 * "FIRES 1 ACTION" would claim the opposite of what happened.
 */
describe("AlarmsModal withheld actions", () => {
  function firedAlarm(actionsWithheld?: true): Alarm {
    return {
      id: "a-stage",
      name: "Stage at 70 km",
      trigger: {
        kind: "threshold",
        dataKey: "vessel.state.altitudeAsl",
        op: ">=",
        value: 70_000,
        sustainSeconds: 0,
        vantage: "command",
      },
      state: "fired",
      createdBy: "main",
      createdAt: 1_700_000_000_000,
      onFire: [{ kind: "action-group", action: "AG1" }],
      actionsWithheld,
    };
  }

  it("says the actions did not run", async () => {
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot([firedAlarm(true)])}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await screen.findByText("Stage at 70 km");
    expect(screen.getByText("ACTIONS NOT RUN")).toBeInTheDocument();
    expect(screen.queryByText(/1 ACTION /)).not.toBeInTheDocument();
  });

  it("names the actions it carries when they ran", async () => {
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot([firedAlarm()])}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await screen.findByText("Stage at 70 km");
    expect(screen.getByText(/1 ACTION /)).toBeInTheDocument();
    expect(screen.queryByText("ACTIONS NOT RUN")).not.toBeInTheDocument();
  });
});

/**
 * An action run aboard in the moment and one sent from the ground that lands a
 * light-time late are two different promises, and the row must not show one as
 * the other.
 */
describe("AlarmsModal unreachable", () => {
  it("says an alarm whose craft is gone can never fire", async () => {
    const alarm: Alarm = {
      id: "a-gone",
      name: "Debris below 70 km",
      trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      state: "pending",
      createdBy: "main",
      createdAt: 1_700_000_000_000,
    };
    render(
      <AlarmsModal
        useSnapshot={() => ({
          ...makeSnapshot([alarm]),
          scetUnreachable: ["a-gone"],
        })}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    await screen.findByText("Debris below 70 km");
    expect(screen.getByText("UNREACHABLE")).toBeInTheDocument();
    expect(
      screen.getByText(/the craft this alarm reads no longer exists/i),
    ).toBeInTheDocument();
  });
});

describe("AlarmsModal where actions run", () => {
  function staging(trigger: Alarm["trigger"]): Alarm {
    return {
      id: "a-where",
      name: "Separate the booster",
      trigger,
      state: "pending",
      createdBy: "main",
      createdAt: 1_700_000_000_000,
      onFire: [{ kind: "action-group", action: "Stage" }],
    };
  }
  const threshold = (vantage: "scet" | "command", topic: string) =>
    ({
      kind: "threshold",
      dataKey: `${topic}.value`,
      op: ">=",
      value: 1,
      sustainSeconds: 0,
      vantage,
      topic,
      fieldPath: "value",
    }) as const;

  async function badgeFor(
    alarm: Alarm,
    refusals?: Record<string, string>,
  ): Promise<string | null> {
    render(
      <AlarmsModal
        useSnapshot={() => ({
          ...makeSnapshot([alarm]),
          scetArmRefusals: refusals,
        })}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );
    await screen.findByText("Separate the booster");
    return screen.getByText(/1 ACTION/).textContent;
  }

  it("says a time alarm's actions run aboard", async () => {
    expect(
      await badgeFor(staging({ kind: "time", ut: 5000, leadSeconds: 10 })),
    ).toBe("FIRES 1 ACTION ABOARD");
  });

  it("says a SCET threshold on the craft runs its actions aboard", async () => {
    expect(await badgeFor(staging(threshold("scet", "vessel.flight")))).toBe(
      "FIRES 1 ACTION ABOARD",
    );
  });

  it("says a command-vantage alarm's actions are sent from the ground", async () => {
    expect(await badgeFor(staging(threshold("command", "vessel.flight")))).toBe(
      "SENDS 1 ACTION FROM GROUND",
    );
  });

  it("says a SCET threshold on the game's own state sends its actions from the ground", async () => {
    expect(await badgeFor(staging(threshold("scet", "career.status")))).toBe(
      "SENDS 1 ACTION FROM GROUND",
    );
  });

  it("says an alarm the mod refused sends its actions from the ground", async () => {
    expect(
      await badgeFor(staging(threshold("scet", "vessel.flight")), {
        "a-where": "no",
      }),
    ).toBe("SENDS 1 ACTION FROM GROUND");
  });
});

/**
 * An alarm is armed for the FUTURE, so a present-tense reading of the link
 * cannot decide which clock the operator meant. A craft two light-seconds out
 * today may be an hour out by the time the alarm comes due, and the operator
 * setting it up now is exactly the one who needs to say so.
 */
describe("AlarmsModal vantage choice", () => {
  beforeEach(registerStubDataSource);

  function renderModal(onAdd: (draft: unknown) => void = () => {}) {
    renderWithStream(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
      ORBIT_EPOCH,
      /* No light time at all: both clocks print the same string, and
         `useTimeContexts` drops every qualifier. */
      0,
    );
  }

  /** The vantage control, which only the threshold arm renders. */
  async function thresholdVantage(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<HTMLElement> {
    await user.click(screen.getByRole("radio", { name: /at telemetry/i }));
    return screen.getByRole("radiogroup", { name: /fires on/i });
  }

  /**
   * A universal time is the same instant at every vantage and names no craft,
   * so a UT alarm has no clock to pick between and gets no control for one.
   */
  it("renders no vantage control for a UT alarm", () => {
    renderModal();

    expect(
      screen.queryByRole("radiogroup", { name: /fires on/i }),
    ).not.toBeInTheDocument();
  });

  it("arms a UT alarm with no vantage at all", async () => {
    // The precondition, asserted rather than assumed: this is the screen that
    // has nothing to LABEL.
    expect(deriveTimeContexts(0, "KSC").scet).toBeUndefined();

    const user = userEvent.setup();
    const onAdd = vi.fn();
    renderModal(onAdd);

    await user.type(screen.getByLabelText(/^name$/i), "Reaches the far side");
    await user.click(screen.getByRole("button", { name: /^add alarm$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const { trigger } = onAdd.mock.calls[0][0];
    expect(trigger).toMatchObject({ kind: "time" });
    expect(trigger).not.toHaveProperty("vantage");
  });

  it("says what each control does in the operator's own words", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(
      screen.getByText(/notify and cancel warp alarm/i),
    ).toBeInTheDocument();
    await thresholdVantage(user);
    expect(
      screen.getByText(
        "Received locally, or as the active vessel receives telemetry.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Any telemetry value that returns a number."),
    ).toBeInTheDocument();
  });

  it("moves the vantage selection with arrow keys and keeps one tab stop", async () => {
    const user = userEvent.setup();
    renderModal();
    // The threshold arm, where the choice means something: a value crosses at
    // one instant aboard the craft and at a later one wherever the news reaches.
    const group = await thresholdVantage(user);
    const [received, scet] = within(group).getAllByRole("radio");

    expect(received).toHaveAttribute("aria-checked", "true");
    expect(received).toHaveAttribute("tabindex", "0");
    expect(scet).toHaveAttribute("tabindex", "-1");

    received.focus();
    await user.keyboard("{ArrowRight}");
    expect(scet).toHaveAttribute("aria-checked", "true");
    expect(scet).toHaveAttribute("tabindex", "0");
    expect(received).toHaveAttribute("tabindex", "-1");

    // Wrapping, so the group is reachable from either end
    await user.keyboard("{ArrowRight}");
    expect(received).toHaveAttribute("aria-checked", "true");
  });

  it("has no accessibility violations with the vantage radio rendered", async () => {
    renderModal();
    const group = await thresholdVantage(userEvent.setup());
    await expectNoA11yViolations(group.parentElement as HTMLElement);
  });
});

describe("AlarmsModal alarms other screens armed", () => {
  beforeEach(registerStubDataSource);

  const KSC = "ground:Kerbal Space Center";
  const PILOT = "vessel:6f0a-probe";

  const foreign = (
    id: string,
    armedBy: string,
    condition: NonNullable<AlarmSnapshot["scetForeign"]>[number]["condition"],
    state: "armed" | "fired" | "unreachable" = "armed",
  ) => ({ id, name: `${id} name`, armedBy, state, condition });

  function renderAtVantage(snapshot: AlarmSnapshot, onDelete = vi.fn()) {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({
        nowWall: () => 0,
        warpRate: () => 1,
        delaySeconds: () => 0,
      }),
    );
    client.attachStore(store);
    const result = render(
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={new Set(["vessel.control"])}
      >
        <AlarmsModal
          useSnapshot={() => snapshot}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={onDelete}
        />
      </TelemetryProvider>,
    );
    act(() => {
      transport.emit(
        "vessel.control",
        { sasMode: 0, throttle: 0, actionGroups: [] },
        { validAt: 0, deliveredAt: 0, vantage: KSC },
      );
      store.beginFrame();
    });
    return { ...result, onDelete };
  }

  it("shows what an alarm armed at this screen's own vantage watches", () => {
    renderAtVantage({
      ...makeSnapshot(),
      scetForeign: [
        foreign("apo", KSC, {
          kind: "threshold",
          topic: "vessel.flight",
          fieldPath: "altitudeAsl",
          op: ">=",
          value: 100000,
        }),
      ],
    });
    expect(screen.getByText("apo name")).toBeInTheDocument();
    expect(
      screen.getByText("vessel.flight.altitudeAsl >= 100000"),
    ).toBeInTheDocument();
  });

  it("withholds the name and condition of one armed at another vantage, and says who armed it", () => {
    renderAtVantage({
      ...makeSnapshot(),
      scetForeign: [
        foreign("pe", PILOT, {
          kind: "threshold",
          topic: "vessel.flight",
          fieldPath: "altitudeAsl",
          op: "<",
          value: 70000,
        }),
      ],
    });
    expect(screen.queryByText("pe name")).not.toBeInTheDocument();
    expect(screen.queryByText(/altitudeAsl/)).not.toBeInTheDocument();
    expect(screen.getByText(`Armed at ${PILOT}`)).toBeInTheDocument();
    expect(
      screen.getByText("Condition withheld at this vantage"),
    ).toBeInTheDocument();
  });

  it("never withholds a time alarm, whoever armed it", () => {
    renderAtVantage({
      ...makeSnapshot(),
      scetForeign: [foreign("burn", PILOT, { kind: "time", ut: 5000 })],
    });
    expect(screen.getByText("burn name")).toBeInTheDocument();
    expect(
      screen.queryByText("Condition withheld at this vantage"),
    ).not.toBeInTheDocument();
  });

  it("disarms another screen's alarm once confirmed", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderAtVantage({
      ...makeSnapshot(),
      scetForeign: [foreign("pe", PILOT, null)],
    });
    await user.click(
      screen.getByRole("button", { name: `Disarm Armed at ${PILOT}` }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disarm" }));
    expect(onDelete).toHaveBeenCalledWith("pe");
  });
});

describe("conditionWithheld", () => {
  const row = {
    id: "x",
    name: "x",
    armedBy: "ground:Kerbal Space Center",
    state: "armed" as const,
    condition: { kind: "contract-parameter" as const, parameterTitle: "Orbit" },
  };

  it("withholds at another vantage, and at one not known yet", () => {
    expect(conditionWithheld(row, "vessel:6f0a-probe")).toBe(true);
    expect(conditionWithheld(row, undefined)).toBe(true);
    expect(conditionWithheld(row, "ground:Kerbal Space Center")).toBe(false);
  });

  it("still withholds once the alarm has fired", () => {
    expect(
      conditionWithheld({ ...row, state: "fired" }, "vessel:6f0a-probe"),
    ).toBe(true);
  });
});
