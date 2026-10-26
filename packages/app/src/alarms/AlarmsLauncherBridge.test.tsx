import { usePendingAlarms } from "@ksp-gonogo/components";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { describe, expect, it } from "vitest";
import { AlarmsLauncherBridge } from "./AlarmsLauncherBridge";
import type { AlarmSnapshot } from "./types";

function Pending() {
  const pending = usePendingAlarms();
  return <div data-testid="pending">{pending?.map((a) => a.id).join(",")}</div>;
}

describe("AlarmsLauncherBridge", () => {
  it("lists a pending alarm on a station, whose snapshot carries null refusals", () => {
    const snapshot: AlarmSnapshot = {
      alarms: [
        {
          id: "a1",
          name: "Burn",
          trigger: { kind: "time", ut: 100, leadSeconds: 10 },
          state: "pending",
          createdBy: "station",
          createdAt: 0,
        },
      ],
      ut: null,
      warp: { index: 0, rate: 1, mode: "UNKNOWN" },
      unscheduledWarp: null,
      warpTo: null,
      warpSafetyMarginSeconds: 5,
      scetArmRefusals: null,
    };
    render(
      <ModalProvider>
        <AlarmsLauncherBridge
          useSnapshot={() => snapshot}
          onAdd={() => {}}
          onUpdate={() => {}}
          onDelete={() => {}}
        >
          <Pending />
        </AlarmsLauncherBridge>
      </ModalProvider>,
    );
    expect(screen.getByTestId("pending")).toHaveTextContent("a1");
  });
});
