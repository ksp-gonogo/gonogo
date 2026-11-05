import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { helmetFace, kitLabel } from "./EvaKerbalRow";
import { CrewStatusComponent } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const BOB = "k2";

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const { unmount } = render(
    <fixture.Provider>
      <CrewStatusComponent config={{}} id="crew" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("vessel.crew", {
      count: 1,
      capacity: 2,
      crew: [{ name: "Jebediah Kerman" }],
    });
    fixture.emit("vessel.identity", { vesselId: "pod", vesselType: 15 });
    fixture.emit("eva.crew", {
      count: 1,
      kerbals: [
        { kerbalVesselId: BOB, parentVesselId: "pod", name: "Bob Kerman" },
      ],
    });
  });
  return fixture;
}

const BOB_STATE = {
  kerbalVesselId: BOB,
  name: "Bob Kerman",
  lampOn: false,
  helmetOn: true,
  visorState: "Lowered",
  slots: 6,
  slotsUsed: 2,
  carrying: [
    { name: "evaRepairKit", title: "Repair Kit", quantity: 1 },
    { name: "parachutePack", title: "Parachute", quantity: 2 },
  ],
};

describe("Crew Status: a kerbal outside shows helmet, kit and lamp", () => {
  it("draws the helmet, the kit with its count and a lamp button off the kerbal's own Topic", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit(`eva.kerbal.${BOB}.state`, BOB_STATE);
    });

    expect(
      await screen.findByLabelText("Helmet on, visor down"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Carrying Repair Kit, Parachute x2"),
    ).toBeInTheDocument();
    const lamp = screen.getByRole("button", { name: "Lamp off" });
    expect(lamp).toHaveAttribute("aria-pressed", "false");
  });

  it("draws the visor-up helmet, labelled, when the visor is raised, and one with it off when the helmet is off", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit(`eva.kerbal.${BOB}.state`, {
        ...BOB_STATE,
        visorState: "Raised",
      });
    });
    const up = await screen.findByLabelText("Helmet on, visor up");
    expect(up.getAttribute("class")).toContain("space-helmet-visor-up");

    act(() => {
      fixture.emit(`eva.kerbal.${BOB}.state`, {
        ...BOB_STATE,
        helmetOn: false,
      });
    });
    const off = await screen.findByLabelText("Helmet off");
    expect(off.getAttribute("class")).toContain("space-helmet");
    expect(off.getAttribute("class")).not.toContain("visor-up");
  });

  it("draws nothing for a helmet or a pack that was not reported, and disables the lamp", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit(`eva.kerbal.${BOB}.state`, {
        kerbalVesselId: BOB,
        name: "Bob Kerman",
      });
    });

    await screen.findByText("Bob Kerman");
    expect(screen.queryByLabelText(/Helmet/)).toBeNull();
    expect(screen.queryByLabelText(/Carrying/)).toBeNull();
    expect(screen.getByRole("button", { name: "Lamp" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("sends the opposite of the lamp's state for that kerbal when pressed", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit(`eva.kerbal.${BOB}.state`, BOB_STATE);
    });
    const lamp = await screen.findByRole("button", { name: "Lamp off" });

    await userEvent.click(lamp);

    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.filter(
          (sent) => sent.command === "eva.kerbal.setLamp",
        ),
      ).toHaveLength(1),
    );
    const sent = fixture.transport.sentCommands.find(
      (command) => command.command === "eva.kerbal.setLamp",
    );
    expect(sent?.args).toEqual({ kerbalVesselId: BOB, enabled: true });
  });
});

describe("helmetFace", () => {
  it("says the helmet and visor together", () => {
    expect(helmetFace({ helmetOn: true, visorState: "Lowered" })).toMatchObject(
      { label: "Helmet on, visor down", muted: false },
    );
    expect(helmetFace({ helmetOn: true, visorState: "Raised" })).toMatchObject({
      label: "Helmet on, visor up",
      visorUp: true,
      muted: false,
    });
    expect(
      helmetFace({ helmetOn: false, visorState: "Lowered" }),
    ).toMatchObject({ label: "Helmet off", visorUp: false, muted: true });
  });

  it("says nothing when the helmet was not read", () => {
    expect(helmetFace(undefined)).toBeNull();
    expect(helmetFace({ helmetOn: null, visorState: "Lowered" })).toBeNull();
  });
});

describe("kitLabel", () => {
  it("lists what is carried and counts the slots used", () => {
    expect(kitLabel([{ name: "a", title: "A", quantity: 2 }], 1)).toEqual({
      count: 1,
      label: "Carrying A x2",
    });
  });

  it("tells an empty pack from one that was not read", () => {
    expect(kitLabel([], 0)).toEqual({ count: 0, label: "Carrying nothing" });
    expect(kitLabel(undefined, undefined)).toBeNull();
    expect(kitLabel(null, 3)).toBeNull();
  });
});
