import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmsModal } from "./AlarmsModal";
import type { Alarm, AlarmSnapshot } from "./types";
import {
  DEFAULT_LEAD_SECONDS,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
} from "./types";

// AlarmsModal reads useDataSchema("data") for the threshold-trigger key
// picker. We don't exercise that path in these tests (the onFire editor
// lives on the time-trigger form too), but we still need the source
// registered so the hook doesn't return an empty schema for unrelated
// reasons.
let dataSource: MockDataSource;
function registerStubDataSource() {
  clearRegistry();
  dataSource = new MockDataSource({ id: "data", name: "Stub" });
  registerDataSource(dataSource);
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
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

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

// Minimal maneuver node for `o.maneuverNodes`. Only `UT` and `deltaV`
// matter to useManeuverNodes; the rest are filler to satisfy the shape.
function makeNode(ut: number) {
  return {
    UT: ut,
    deltaV: [10, 0, 0] as [number, number, number],
    PeA: 0,
    ApA: 0,
    inclination: 0,
    eccentricity: 0,
    epoch: 0,
    period: 0,
    argumentOfPeriapsis: 0,
    sma: 0,
    lan: 0,
    maae: 0,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    orbitPatches: [],
  };
}

// useDataValue delivers via subscribe → synchronous setState; wrap the
// push so the resulting render is flushed inside act (MockDataSource has
// no value cache, so the emit must happen post-render).
function emitData(key: string, value: unknown) {
  act(() => {
    dataSource.emit(key, value);
  });
}

describe("AlarmsModal recommended presets", () => {
  beforeEach(registerStubDataSource);
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

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
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    // Live, positive → the section appears.
    emitData("o.timeToAp", 500);
    expect(
      await screen.findByRole("button", { name: /recommended/i }),
    ).toBeDefined();

    // 0 means "at apoapsis right now" — scheduling ut+0 would fire instantly,
    // so the gate (> 0) hides it again. Proving the transition discriminates
    // the gate from the default-hidden state.
    emitData("o.timeToAp", 0);
    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
  });

  it("offers and creates a 'Warp to apoapsis' time alarm once o.timeToAp is live", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <AlarmsModal
        // Snapshot UT is 1000; emitting timeToAp=500 should yield ut 1500.
        useSnapshot={() => makeSnapshot()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    emitData("o.timeToAp", 500);

    // The collapsible "Recommended" toggle appears once data is live.
    const toggle = await screen.findByRole("button", { name: /recommended/i });
    await user.click(toggle);

    const apo = await screen.findByRole("button", {
      name: /warp to apoapsis/i,
    });
    await user.click(apo);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      name: "Warp to apoapsis",
      trigger: { kind: "time", ut: 1500, leadSeconds: DEFAULT_LEAD_SECONDS },
    });
    // Presets are notify-only — no onFire side effect attached.
    expect(onAdd.mock.calls[0][0].onFire).toBeUndefined();
  });

  it("offers a 'Warp to next maneuver' preset anchored to the node's absolute UT", async () => {
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

    // o.maneuverNodes is a complex array; useManeuverNodes parses it. UT is
    // absolute (2500), so the alarm ut should equal it exactly — no offset.
    emitData("o.maneuverNodes", [makeNode(2500)]);

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
    render(
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
    emitData("o.maneuverNodes", [
      makeNode(500),
      makeNode(4000),
      makeNode(2200),
    ]);

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
    render(
      <AlarmsModal
        useSnapshot={() => makeSnapshot()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    // First prove the preset CAN appear for a future node…
    emitData("o.maneuverNodes", [makeNode(3000)]);
    expect(
      await screen.findByRole("button", { name: /recommended/i }),
    ).toBeDefined();

    // …then a node-list with only a past node (500 < UT 1000) hides it,
    // proving the future-node filter rather than the default-hidden state.
    emitData("o.maneuverNodes", [makeNode(500)]);
    expect(screen.queryByRole("button", { name: /recommended/i })).toBeNull();
  });
});
