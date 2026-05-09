import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmsModal } from "./AlarmsModal";
import type { Alarm, AlarmSnapshot } from "./types";
import { DEFAULT_WARP_SAFETY_MARGIN_SECONDS } from "./types";

// AlarmsModal reads useDataSchema("data") for the threshold-trigger key
// picker. We don't exercise that path in these tests (the onFire editor
// lives on the time-trigger form too), but we still need the source
// registered so the hook doesn't return an empty schema for unrelated
// reasons.
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
