import { deriveTimeContexts } from "@ksp-gonogo/core";
import { GameAlarmKind, GameAlarmWarp } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  GameAlarmFeed,
  GameAlarmRow,
  gameAlarmCraftTopic,
  type ListedGameAlarm,
} from "./GameAlarmRows";

const contexts = deriveTimeContexts(0, undefined);

function alarm(
  id: number,
  title: string,
  kind: GameAlarmKind,
  extra: { gonogoId?: string } = {},
) {
  return {
    id,
    kind,
    title,
    ut: 5000 + id,
    vessel: null,
    warp: GameAlarmWarp.StopWarp,
    triggered: false,
    gonogoId: extra.gonogoId ?? null,
  };
}

const CRAFT = "4f1c2b9e-0000-0000-0000-000000000001";

function Rows() {
  const [listed, setListed] = useState<ListedGameAlarm[]>([]);
  return (
    <>
      <GameAlarmFeed onAlarms={setListed} />
      {listed.map(({ alarm, heldGrade }) => (
        <GameAlarmRow
          key={alarm.id}
          alarm={alarm}
          heldGrade={heldGrade}
          contexts={contexts}
        />
      ))}
    </>
  );
}

function renderRows() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const result = render(
    <fixture.Provider>
      <ul>
        <Rows />
      </ul>
    </fixture.Provider>,
  );
  return { fixture, ...result };
}

describe("GameAlarmFeed", () => {
  it("lists every game alarm once, leaving out the copies of Gonogo's", async () => {
    const { fixture, container } = renderRows();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [
          alarm(1, "Mun window", GameAlarmKind.Time),
          alarm(2, "Burn", GameAlarmKind.Time, { gonogoId: "g-burn" }),
          alarm(3, "Kerbin to Duna", GameAlarmKind.TransferWindow),
        ],
      });
      fixture.emitFrame();
    });

    expect(screen.getByText("Mun window")).toBeInTheDocument();
    expect(screen.getByText("Kerbin to Duna")).toBeInTheDocument();
    expect(screen.queryByText("Burn")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("shows a craft's alarms from that craft's own Topic", async () => {
    const { fixture } = renderRows();
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
        alarm(3, "Probe Pe", GameAlarmKind.Periapsis),
      ]);
      fixture.emitFrame();
    });

    expect(screen.getByText("Probe Pe")).toBeInTheDocument();
  });

  it("deletes a game alarm through alarm.game.delete after a confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = renderRows();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: true,
        alarms: [alarm(7, "Mun window", GameAlarmKind.Time)],
      });
      fixture.emitFrame();
    });

    await user.click(screen.getByRole("button", { name: "Delete Mun window" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "alarm.game.delete",
      ),
    ).toEqual([expect.objectContaining({ args: { id: 7 } })]);
  });

  it("shows nothing when the game runs no alarm clock", () => {
    const { fixture } = renderRows();
    act(() => {
      fixture.transport.emit("alarm.game.list", {
        available: false,
        alarms: [alarm(1, "Mun window", GameAlarmKind.Time)],
      });
      fixture.emitFrame();
    });

    expect(screen.queryByText("Mun window")).toBeNull();
  });
});
