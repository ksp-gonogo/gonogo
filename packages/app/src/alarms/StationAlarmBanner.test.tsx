import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StationAlarmBanner } from "./StationAlarmBanner";
import type { Alarm, AlarmSnapshot } from "./types";

function fired(id: string): Alarm {
  return {
    id,
    name: id,
    trigger: { kind: "time", ut: 4000, leadSeconds: 0 },
    state: "fired",
    createdBy: "main",
    createdAt: 0,
    matchSinceUT: 4000,
  };
}

function snapshotOf(alarms: Alarm[]): AlarmSnapshot {
  return {
    alarms,
    ut: 4000,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: 10,
  };
}

describe("StationAlarmBanner", () => {
  it("states the same warp fact as the main screen's banner", () => {
    const { container } = render(
      <StationAlarmBanner
        useSnapshot={() => snapshotOf([fired("a")])}
        onAcknowledge={() => {}}
      />,
    );
    expect(container.textContent).toContain("Warp stopped.");
  });

  it("acknowledges several fired alarms together, each still listed", async () => {
    const onAcknowledge = vi.fn();
    const { container } = render(
      <StationAlarmBanner
        useSnapshot={() => snapshotOf([fired("a"), fired("b"), fired("c")])}
        onAcknowledge={onAcknowledge}
      />,
    );
    for (const id of ["a", "b", "c"]) {
      expect(container.textContent).toContain(id);
    }
    await userEvent.click(
      screen.getByRole("button", { name: "Acknowledge all" }),
    );
    expect(onAcknowledge.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });
});
