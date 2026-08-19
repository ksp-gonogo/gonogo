import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AlarmsModal } from "./AlarmsModal";
import type { AlarmSnapshot } from "./types";
import { DEFAULT_WARP_SAFETY_MARGIN_SECONDS } from "./types";

/**
 * Characterisation of what `AlarmsModal` DOES today when its telemetry reads
 * come back `undefined`, and where it does or does not distinguish `undefined`
 * from `null`.
 *
 * Three absence gates live in this file, each with a different meaning assigned
 * to the same `undefined`:
 *  - `useTelemetry("vessel.parts")` → `if (!parts?.parts) return null`, which
 *    means "no bindings known", and renders the action-group option with NO
 *    caption at all rather than a placeholder
 *  - `useStream<VesselState>("vessel.state")` → `vesselState?.timeToAp ??
 *    undefined`, then `typeof timeToAp === "number"`, which means "this preset
 *    is not offerable", and removes the whole Recommended DISCLOSURE, not just
 *    the button
 *  - `snapshot.ut === null`, which means "cannot schedule yet" and is the ONE
 *    absence this modal narrates to the operator in words. Note the UT arrives
 *    on the `useSnapshot` prop rather than through a telemetry read here; it is
 *    pinned because it is the modal's own absence gate and the widest visible
 *    difference between "warmup" and "live"
 */

/** The snapshot UT the presets anchor to. Matches the sibling suite's value. */
const SNAPSHOT_UT = 1000;

// Kerbin's GM and a parking orbit, lifted from `AlarmsModal.test.tsx` so the
// derived `vessel.state.timeToAp` here is the same hand-checkable half-period.
const ORBIT_MU = 3.5316e12;
const ORBIT_SMA = 700_000;
const ORBIT_EPOCH = 10;

/**
 * `vessel.parts` and `vessel.control` for the action-group caption, plus the
 * eight `vesselStateChannel` inputs so the derived `vessel.state` the presets
 * read can actually resolve off the stream.
 */
const CARRIED = [
  "vessel.parts",
  "vessel.control",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

function makeSnapshot(ut: number | null): AlarmSnapshot {
  return {
    alarms: [],
    ut,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
  };
}

function mount(modal: ReactElement) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: ORBIT_EPOCH,
  });
  render(<fixture.Provider>{modal}</fixture.Provider>);
  const emit = (topic: string, payload: unknown) => {
    act(() => {
      fixture.emit(topic, payload);
    });
  };
  return { ...fixture, emit };
}

function modalWithUt(ut: number | null = SNAPSHOT_UT) {
  return (
    <AlarmsModal
      useSnapshot={() => makeSnapshot(ut)}
      onAdd={() => {}}
      onUpdate={() => {}}
      onDelete={() => {}}
    />
  );
}

/**
 * The ten stock custom groups, as the mod sends them. Emitted wherever a test
 * needs AG1 to EXIST as an option: the registry's custom half is telemetry
 * derived, so without this there is no `f.ag1` row for a caption to be missing
 * from and the caption assertions would pass on an empty list.
 */
const STOCK_CONTROL_PAYLOAD = {
  sasMode: 0,
  throttle: 0,
  actionGroups: Array.from({ length: 10 }, (_, i) => ({
    index: i + 1,
    name: `AG${i + 1}`,
    state: false,
  })),
};

/** One part binding an action to Custom01, the `f.ag1` caption's live case. */
const PARTS_WITH_AG1_BINDING = {
  parts: [
    {
      id: "1",
      name: "solarPanel",
      title: "OX-4L Solar Panel",
      actionBindings: [{ action: "Toggle Solar Panel", groups: ["Custom01"] }],
    },
  ],
  meta: {},
};

function emitOrbit(
  emit: (topic: string, payload: unknown) => void,
  overrides: Record<string, unknown> = {},
) {
  emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: ORBIT_SMA,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    // Mean anomaly 0 at the view frame = at periapsis, so `timeToAp` is half a
    // period and both apsis presets are offerable.
    meanAnomalyAtEpoch: 0,
    epoch: ORBIT_EPOCH,
    mu: ORBIT_MU,
    ...overrides,
  });
}

function ag1Option(): HTMLElement | null {
  return screen.queryByRole("option", { name: /^AG1 \(f\.ag1\)/ });
}

beforeEach(() => {
  // `useValueKeys("data")` reads the legacy registry. Cleared and re-stubbed
  // per test so nothing leaks between them; the real app has no such source.
  clearRegistry();
  registerDataSource(new MockDataSource({ id: "data", name: "Stub" }));
});

describe("AlarmsModal: nothing has arrived at all", () => {
  it("renders the whole add-alarm form, with the Recommended disclosure absent and no preset buttons", () => {
    mount(modalWithUt());

    // The form itself is telemetry-independent and renders in full.
    expect(screen.getByRole("button", { name: "Add alarm" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByText("Scheduled (0)")).toBeTruthy();
    expect(screen.getByText("No alarms set.")).toBeTruthy();

    // `RecommendedPresets` returns null when nothing is offerable, so the
    // DISCLOSURE goes too: an operator sees no hint that presets exist, rather
    // than an empty or disabled section.
    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /warp to apoapsis/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /warp to periapsis/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /warp to next maneuver/i }),
    ).toBeNull();

    // The onFire picker exists with its stock half only: the custom AG rows are
    // telemetry-derived, so absent `vessel.control` means no AG1 row at all.
    expect(screen.getByLabelText("Action group to fire")).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /^SAS \(f\.sas\)/ }),
    ).toBeTruthy();
    expect(ag1Option()).toBeNull();
  });
});

describe("AlarmsModal: the vessel.parts caption gate", () => {
  it("renders the AG1 option with NO caption when vessel.parts has not arrived", async () => {
    // Pins `!parts?.parts` firing for the warmup meaning. The absence is
    // rendered as a bare label, not as a placeholder or a pending marker, so
    // "no parts tree yet" and "this group is bound to nothing" look identical.
    const fixture = mount(modalWithUt());
    fixture.emit("vessel.control", STOCK_CONTROL_PAYLOAD);

    const option = await screen.findByRole("option", {
      name: /^AG1 \(f\.ag1\)/,
    });
    expect(option.textContent).toBe("AG1 (f.ag1)");
  });

  it("renders the same bare caption for a vessel.parts record whose parts field is missing", async () => {
    // Partial payload: the record arrived, the field did not. The gate reads
    // the FIELD, so this is indistinguishable from the record never arriving.
    const fixture = mount(modalWithUt());
    fixture.emit("vessel.control", STOCK_CONTROL_PAYLOAD);
    fixture.emit("vessel.parts", { meta: {} });

    const option = await screen.findByRole("option", {
      name: /^AG1 \(f\.ag1\)/,
    });
    expect(option.textContent).toBe("AG1 (f.ag1)");
  });

  it("renders the same bare caption for a null vessel.parts tombstone, making no distinction from warmup", async () => {
    // Which meaning is implemented: `!parts?.parts` collapses `null` (a
    // confirmed "this vessel has no parts tree", e.g. outside Flight) onto the
    // same render as `undefined` (warmup). A caption that has gone away because
    // the vessel went away reads exactly like one that has not loaded yet.
    const fixture = mount(modalWithUt());
    fixture.emit("vessel.control", STOCK_CONTROL_PAYLOAD);
    fixture.emit("vessel.parts", PARTS_WITH_AG1_BINDING);
    await waitFor(() =>
      expect(ag1Option()?.textContent).toBe("AG1 (f.ag1): Toggle Solar Panel"),
    );

    fixture.emit("vessel.parts", null);

    await waitFor(() => expect(ag1Option()?.textContent).toBe("AG1 (f.ag1)"));
  });

  it("CONTROL: a live parts tree does caption the option, so the bare labels above are not vacuous", async () => {
    const fixture = mount(modalWithUt());
    fixture.emit("vessel.control", STOCK_CONTROL_PAYLOAD);
    fixture.emit("vessel.parts", PARTS_WITH_AG1_BINDING);

    await screen.findByRole("option", {
      name: /^AG1 \(f\.ag1\): Toggle Solar Panel$/,
    });
  });
});

describe("AlarmsModal: the vessel.state preset gate", () => {
  it("hides the Recommended disclosure while vessel.state has not arrived, with the modal otherwise live", async () => {
    // A provider IS mounted and other topics ARE flowing here, so this pins the
    // absence of the ONE read the presets depend on, not an unwired fixture.
    const fixture = mount(modalWithUt());
    fixture.emit("vessel.control", STOCK_CONTROL_PAYLOAD);
    await screen.findByRole("option", { name: /^AG1 \(f\.ag1\)/ });

    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
  });

  it("treats a null timeToAp/timeToPe exactly as never-arrived: no Recommended disclosure", async () => {
    // Which meaning is implemented: `vesselState?.timeToAp ?? undefined`
    // rewrites the derived channel's `null` (a CONFIRMED "this orbit has no
    // time-to-apoapsis", here a degenerate mu) into the same `undefined` that
    // means "nothing has arrived". The two render identically, so an orbit that
    // genuinely cannot offer an apsis preset is reported as warmup.
    const fixture = mount(modalWithUt());
    emitOrbit(fixture.emit, { mu: 0 });

    // Give the frame that WOULD have produced the presets a chance to land.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add alarm" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
  });

  it("CONTROL: a live orbit does offer the apsis presets, so the hidden disclosures above are not vacuous", async () => {
    const fixture = mount(modalWithUt());
    emitOrbit(fixture.emit);

    await screen.findByRole("button", { name: /recommended/i });
  });
});

describe("AlarmsModal: the snapshot UT gate", () => {
  it("narrates a null UT in words and disables Add alarm, hiding the UT-at-trigger hint", () => {
    // The one absence this modal SAYS out loud. Pinned because it is the
    // template for what the other gates do not do.
    mount(modalWithUt(null));

    expect(
      screen.getByText(/universal-time reading before new alarms/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add alarm" })).toBeDisabled();
    expect(screen.queryByText(/UT at trigger/i)).toBeNull();
  });

  it("CONTROL: a live UT drops the waiting note and shows the UT-at-trigger hint", () => {
    mount(modalWithUt());

    expect(
      screen.queryByText(/universal-time reading before new alarms/i),
    ).toBeNull();
    expect(screen.getByText(/UT at trigger/i)).toBeTruthy();
    // Name is still empty, so the button is disabled for a reason that is NOT
    // the UT: asserting the enable would pin the wrong thing.
    expect(screen.getByRole("button", { name: "Add alarm" })).toBeDisabled();
  });
});
