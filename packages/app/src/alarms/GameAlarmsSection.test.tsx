import { deriveTimeContexts } from "@ksp-gonogo/core";
import { GameAlarmKind, GameAlarmWarp } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GameAlarmsSection, gameAlarmCraftTopic } from "./GameAlarmsSection";

const CRAFT = "4f1c2b9e-0000-0000-0000-000000000001";

const contexts = deriveTimeContexts(0, undefined);

function alarm(
  id: number,
  title: string,
  kind: GameAlarmKind,
  extra: { gonogoId?: string; vessel?: string } = {},
) {
  return {
    id,
    kind,
    title,
    ut: 5000 + id,
    vessel: extra.vessel ?? null,
    warp: GameAlarmWarp.StopWarp,
    triggered: false,
    gonogoId: extra.gonogoId ?? null,
  };
}

function renderSection() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const result = render(
    <fixture.Provider>
      <GameAlarmsSection contexts={contexts} />
    </fixture.Provider>,
  );
  return { fixture, ...result };
}

describe("GameAlarmsSection", () => {
  it("lists the game's own alarms once, leaving out the copies of Gonogo's", async () => {
    const { fixture, container } = renderSection();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [
          alarm(1, "Kerbin to Duna", GameAlarmKind.TransferWindow),
          alarm(2, "Burn", GameAlarmKind.Time, { gonogoId: "g-burn" }),
        ],
      });
      fixture.emitFrame();
    });

    expect(screen.getByText("Kerbin to Duna")).toBeInTheDocument();
    expect(screen.queryByText("Burn")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("shows a craft's alarms from that craft's own Topic", async () => {
    const { fixture } = renderSection();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [],
      });
      fixture.transport.emit("trackingStation.catalog", {
        entries: [
          { vesselId: CRAFT, name: "Probe", vesselType: 0, situation: 0 },
        ],
      });
      fixture.emitFrame();
    });
    await act(async () => {});
    act(() => {
      fixture.transport.emit(gameAlarmCraftTopic(CRAFT), [
        alarm(3, "Probe Pe", GameAlarmKind.Periapsis, {
          vessel: `vessel:${CRAFT}`,
        }),
      ]);
      fixture.emitFrame();
    });

    expect(screen.getByText("Probe Pe")).toBeInTheDocument();
  });

  it("deletes a game alarm through alarm.game.delete after a confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = renderSection();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [alarm(7, "Mun window", GameAlarmKind.Time)],
      });
      fixture.emitFrame();
    });

    await user.click(
      screen.getByRole("button", { name: "Delete Mun window from the game" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "alarm.game.delete",
      ),
    ).toEqual([expect.objectContaining({ args: { id: 7 } })]);
  });

  it("says when the game runs no alarm clock", () => {
    const { fixture } = renderSection();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: false,
        alarms: [],
      });
      fixture.emitFrame();
    });

    expect(
      screen.getByText("The game is not running an alarm clock here."),
    ).toBeInTheDocument();
  });
});
