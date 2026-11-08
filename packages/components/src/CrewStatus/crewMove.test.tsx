import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewMoveList } from "./CrewMoveList";

const seats = (capacity: number, over = {}) => ({
  capacity,
  transferAvailable: true,
  isExternalSeat: false,
  ...over,
});
const part = (id: string, title: string, s: unknown) => ({
  id,
  title,
  name: title,
  resources: {},
  modules: [],
  moduleStates: [],
  actionBindings: [],
  seats: s,
});
const kerbal = (name: string, partId: string, moves: string[] = []) => ({
  name,
  partId,
  partTitle: "x",
  movesLeavingNoControl: moves,
});

function show(
  props: { partId?: string; kerbalName?: string },
  moves: string[] = [],
) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const onDismiss = vi.fn();
  render(
    <fixture.Provider>
      <CrewMoveList {...props} onDismiss={onDismiss} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.crew", {
      crew: [
        kerbal("Jeb", "1", moves),
        kerbal("Bill", "1"),
        kerbal("Val", "3"),
      ],
      count: 3,
      capacity: 6,
    });
    fixture.emit("vessel.parts", {
      parts: [
        part("1", "Pod", seats(2)),
        part("2", "Hitchhiker", seats(4)),
        part("3", "Cupola", seats(1)),
        part("4", "Seat", seats(1, { isExternalSeat: true })),
        part("5", "Tank", null),
      ],
      meta: { source: "" },
    });
  });
  return { fixture, onDismiss };
}

describe("CrewMoveList", () => {
  it("lists the part's kerbals and only parts crew can use", async () => {
    show({ partId: "1" });
    expect(await screen.findByText("Move Jeb to")).toBeInTheDocument();
    expect(screen.getByText("Move Bill to")).toBeInTheDocument();
    expect(screen.queryByText("Move Val to")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("menuitem", { name: /Hitchhiker/ }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("menuitem", { name: /Seat|Tank/ }),
    ).not.toBeInTheDocument();
  });

  it("sends the move and closes", async () => {
    const user = userEvent.setup();
    const { fixture } = show({ kerbalName: "Jeb" });
    await user.click(
      await screen.findByRole("menuitem", { name: /Move Jeb to Hitchhiker/ }),
    );
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "vessel.crew.transfer",
      )[0].args,
    ).toEqual({ kerbalName: "Jeb", fromPartId: "1", toPartId: "2" });
  });

  it("sends nothing to a full part", async () => {
    const user = userEvent.setup();
    const { fixture } = show({ kerbalName: "Jeb" });
    await user.click(await screen.findByRole("menuitem", { name: /Cupola/ }));
    expect(fixture.transport.sentCommands).toEqual([]);
  });

  it("asks twice for a move that leaves no control", async () => {
    const user = userEvent.setup();
    const { fixture } = show({ kerbalName: "Jeb" }, ["2"]);
    const item = await screen.findByRole("menuitem", {
      name: /Move Jeb to Hitchhiker/,
    });
    await user.click(item);
    expect(fixture.transport.sentCommands).toEqual([]);
    expect(item).toHaveTextContent(/leaves no control/i);
  });
});
