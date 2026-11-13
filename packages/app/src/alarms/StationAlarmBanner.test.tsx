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

  it("leads with the earliest fired alarm, whatever order the snapshot lists them", () => {
    const early = {
      ...fired("early"),
      trigger: { kind: "time" as const, ut: 3000, leadSeconds: 0 },
    };
    const late = {
      ...fired("late"),
      trigger: { kind: "time" as const, ut: 3500, leadSeconds: 0 },
    };
    const { container } = render(
      <StationAlarmBanner
        useSnapshot={() => snapshotOf([late, early])}
        onAcknowledge={() => {}}
      />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("early")).toBeLessThan(text.indexOf("late"));
    expect(text).toContain("also fired: late");
  });

  it("leads with a firing alarm over a fired one, as the main screen does", () => {
    const firing = { ...fired("firing-one"), state: "firing" as const };
    const { container } = render(
      <StationAlarmBanner
        useSnapshot={() => snapshotOf([fired("done"), firing])}
        onAcknowledge={() => {}}
      />,
    );
    expect(container.textContent).toMatch(/Firing\s*firing-one/);
  });

  it("names the craft the game switched to, with no warp control", () => {
    render(
      <StationAlarmBanner
        useSnapshot={() => ({
          ...snapshotOf([]),
          firstSignal: {
            vesselName: "Mun Probe",
            owltSeconds: 1_800,
            estimated: true,
          },
        })}
        onAcknowledge={() => {}}
      />,
    );
    expect(screen.getByText("Switched to")).toBeInTheDocument();
    expect(screen.getByText("Mun Probe")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /warp to first signal/i }),
    ).toBeNull();
  });

  it("shows nothing while no switch awaits its first signal", () => {
    const { container } = render(
      <StationAlarmBanner
        useSnapshot={() => snapshotOf([])}
        onAcknowledge={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
