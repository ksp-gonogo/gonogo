import { GameAlarmKind, GameAlarmWarp } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AlarmsFab } from "./AlarmsFab";
import { AlarmsModal } from "./AlarmsModal";
import type { AlarmSnapshot } from "./types";

const snapshot: AlarmSnapshot = {
  alarms: [],
  ut: 1000,
  warp: { index: 0, rate: 1, mode: "UNKNOWN" },
  unscheduledWarp: null,
  warpTo: null,
  warpSafetyMarginSeconds: 5,
};

describe("AlarmsModal opened the way the app opens it", () => {
  it("deleting a game alarm does not throw for want of a command rail", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <ModalProvider>
          <AlarmsFab
            bottom={0}
            useSnapshot={() => snapshot}
            onAdd={() => {}}
            onUpdate={() => {}}
            onDelete={() => {}}
            ModalComponent={AlarmsModal}
          />
        </ModalProvider>
      </fixture.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Mission alarms" }));
    await act(async () => {});
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [
          {
            id: 7,
            kind: GameAlarmKind.Time,
            title: "Mun window",
            ut: 5007,
            vessel: null,
            warp: GameAlarmWarp.StopWarp,
            triggered: false,
            gonogoId: null,
          },
        ],
      });
    });

    await user.click(
      await screen.findByRole("button", { name: "Delete Mun window" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "alarm.game.delete",
      ),
    ).toHaveLength(1);
  });
});
