import type { VesselTopology } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import roverMerged from "./__fixtures__/rover-merged-56parts.json";
import { VesselSchematicComponent } from "./index";
import { SET_PART_FIELD_COMMAND } from "./PartWindow";
import { partActionsTopic } from "./usePartActions";

/** The part window end to end: real provider, client, store, widget and delayed command over `StubTransport`. */

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const PART = TOPOLOGY.parts[0];
const PART_ID = PART.flightId;

const row = (over: Record<string, unknown>) => ({
  kind: "label",
  module: "ModuleEnginesFX",
  name: "status",
  label: "Status",
  text: "Off",
  number: null,
  advanced: false,
  editable: false,
  ...over,
});

const WINDOW = [
  row({}),
  row({
    kind: "slider",
    name: "thrustPercentage",
    label: "Thrust Limiter",
    text: "73.5 %",
    number: 73.5,
    min: 0,
    max: 100,
    step: 0.5,
    editable: true,
  }),
  row({
    kind: "toggle",
    module: "ModuleGimbal",
    name: "gimbalLock",
    label: "Gimbal",
    text: "Locked",
    number: 1,
    editable: true,
  }),
  row({
    kind: "option",
    name: "mode",
    label: "Mode",
    text: "Normal",
    number: 0,
    options: ["Normal", "Vacuum"],
    editable: true,
  }),
  row({
    kind: "resource",
    module: "",
    name: "LiquidFuel",
    label: "Liquid Fuel",
    text: "",
    number: 180,
    min: 0,
    max: 360,
    flows: true,
  }),
  row({ name: "hidden", label: "Deploy Mode", text: "Safe", advanced: true }),
];

function payload(window: unknown[], actions: unknown[] = []) {
  return {
    partId: String(PART_ID),
    actions,
    gameWindows: [],
    window,
    meta: { source: "vessel:guid-1", quality: 0 },
  };
}

async function openWindow(
  window: unknown[] = WINDOW,
  delay?: number,
  actions: unknown[] = [],
) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <VesselSchematicComponent id="vessel-schematic-window" w={8} h={10} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", topologyToVesselPartsWire(TOPOLOGY));
    if (delay !== undefined) {
      fixture.emit("comms.delay", { oneWaySeconds: delay });
      fixture.emit("system.uplink.delays", {
        activeVessel: [SET_PART_FIELD_COMMAND],
        elsewhere: [],
      });
    }
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  const part = screen
    .getAllByRole("button")
    .find((el) =>
      (el.getAttribute("aria-label") ?? "").includes(PART.title ?? PART.name),
    );
  if (!part) throw new Error("no focusable part matched the fixture's title");
  act(() => {
    fixture.emit(partActionsTopic(PART_ID), payload(window, actions));
  });
  await userEvent.setup().pointer({ keys: "[MouseRight]", target: part });
  await screen.findByRole("region", { name: /window/ });
  return fixture;
}

describe("VesselSchematic: part window", () => {
  it("draws each row the game draws as the control for it and leaves an advanced row out", async () => {
    await openWindow();

    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Thrust Limiter" })).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Gimbal: Locked" }),
    ).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
    expect(screen.getByText("Liquid Fuel")).toBeTruthy();
  });

  it("scrolls its rows under a height limit, with the title held above them", async () => {
    await openWindow();

    const window = screen.getByRole("region", { name: /window/ });
    const scroller = window.querySelector("[data-scroll-area-inner]");

    expect(window.style.maxHeight).toBe("70vh");
    expect(scroller).not.toBeNull();
    expect(
      scroller?.contains(
        screen.getByRole("slider", { name: "Thrust Limiter" }),
      ),
    ).toBe(true);
  });

  it("keeps an advanced row in a closed Advanced group until it is opened", async () => {
    await openWindow();

    expect(screen.queryByText("Deploy Mode")).toBeNull();
    const group = screen.getByRole("button", { name: "Advanced" });
    expect(group.getAttribute("aria-expanded")).toBe("false");

    await userEvent.setup().click(group);

    expect(screen.getByText("Deploy Mode")).toBeTruthy();
    expect(screen.getByText("Safe")).toBeTruthy();
  });

  it("keeps a row's own group closed until it is opened", async () => {
    await openWindow([
      row({ label: "Status", group: "Control", text: "Off" }),
      row({
        name: "hidden",
        label: "Deploy Mode",
        text: "Safe",
        advanced: true,
      }),
    ]);

    const group = screen.getByRole("button", { name: "Control" });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("leaves out the Advanced group when nothing is advanced", async () => {
    await openWindow([row({})]);

    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
  });

  it("sends the slider's value for its field when the hand lets go", async () => {
    const fixture = await openWindow();
    const slider = screen.getByRole("slider", { name: "Thrust Limiter" });

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    const sent = fixture.transport.sentCommands[0];
    expect(sent.command).toBe(SET_PART_FIELD_COMMAND);
    expect(sent.args).toEqual({
      partId: String(PART_ID),
      module: "ModuleEnginesFX",
      field: "thrustPercentage",
      value: 40,
    });
    expect(sent.label).toContain("Thrust Limiter on");
  });

  it("sends 0 for a switch flipped off and an option's position for a step", async () => {
    const fixture = await openWindow();

    await userEvent
      .setup()
      .click(screen.getByRole("checkbox", { name: "Gimbal: Locked" }));
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    expect(fixture.transport.sentCommands[0].args).toMatchObject({
      module: "ModuleGimbal",
      field: "gimbalLock",
      value: 0,
    });
  });

  it("says how old the state is under a delay and says nothing without one", async () => {
    await openWindow(WINDOW, 4);
    expect((await screen.findByText(/State as of/)).textContent).toMatch(
      /State as of 4\s*s ago/,
    );
  });

  it("says nothing of age when there is no delay", async () => {
    await openWindow();
    expect(screen.queryByText(/State as of/)).toBeNull();
  });

  it("opens the window of the part that was hovered, on a craft of 56 parts", async () => {
    const dense = roverMerged["v.topology"] as VesselTopology;
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <VesselSchematicComponent id="vessel-schematic-dense" w={8} h={10} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.parts", topologyToVesselPartsWire(dense));
    });
    await waitFor(() =>
      expect(document.querySelectorAll("[data-flight-id]").length).toBe(
        dense.parts.length,
      ),
    );
    const user = userEvent.setup();

    for (const part of dense.parts.filter((_, i) => i % 5 === 0)) {
      const element = document.querySelector(
        `[data-flight-id="${part.flightId}"]`,
      ) as Element;
      await user.hover(element);
      await user.pointer({ keys: "[MouseRight]", target: element });

      const title = part.title || part.name;
      const opened = await screen.findByRole("region", { name: /window$/ });
      expect(opened.getAttribute("aria-label")).toBe(`${title} window`);
      expect(screen.getAllByRole("region", { name: /window$/ })).toHaveLength(
        1,
      );

      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: /window$/ })).toBeNull(),
      );
      await user.unhover(element);
    }
  });

  it("draws each of two modules' buttons of one name and presses the one that was chosen", async () => {
    const button = (moduleIndex: number, label: string) => ({
      name: "Toggle",
      label,
      moduleName: "ProcessController",
      moduleIndex,
      active: true,
      guiActiveUnfocused: false,
      advancedTweakable: false,
      requireFullControl: false,
      opensGameWindow: false,
    });
    const fixture = await openWindow(WINDOW, undefined, [
      button(8, "1 Scrubber: running"),
      button(9, "1 Water recycler: running"),
    ]);

    expect(screen.getByRole("button", { name: /1 Scrubber/ })).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /1 Water recycler/ }));

    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    expect(fixture.transport.sentCommands[0].args).toEqual({
      partId: String(PART_ID),
      eventName: "Toggle",
      moduleIndex: 9,
    });
  });

  it("draws a label the owning mod has not filled as no reading, not as an empty value", async () => {
    await openWindow([
      row({ module: "Sensor", label: "temperature", text: "" }),
      row({
        module: "Sensor",
        name: "radiation",
        label: "radiation",
        text: "0.405 mrad/h",
      }),
    ]);

    expect(screen.getByText("0.405 mrad/h")).toBeTruthy();
    expect(screen.getByText(NULL_DISPLAY)).toBeTruthy();
  });

  it("draws several rows of one module and field name, each with its own value", async () => {
    await openWindow([
      row({
        module: "Sensor",
        name: "Status",
        label: "temperature",
        text: "287.7 K",
      }),
      row({
        module: "Sensor",
        name: "Status",
        label: "radiation",
        text: "0.405 mrad/h",
      }),
      row({
        module: "Sensor",
        name: "Status",
        label: "habitat radiation",
        text: "0.405 mrad/h",
      }),
    ]);

    expect(screen.getByText("287.7 K")).toBeTruthy();
    expect(screen.getAllByText("0.405 mrad/h")).toHaveLength(2);
  });

  it("reads a switch as the game does, with its state word beside it", async () => {
    const free = [
      row({
        kind: "toggle",
        module: "ModuleGimbal",
        name: "gimbalLock",
        label: "Gimbal",
        text: "Free",
        number: 0,
        options: ["Free", "Locked"],
        editable: true,
      }),
    ];
    const fixture = await openWindow(free);

    expect(screen.getByText("Free")).toBeTruthy();
    const gimbal = screen.getByRole("checkbox", { name: "Gimbal: Free" });
    expect((gimbal as HTMLInputElement).checked).toBe(false);

    act(() => {
      fixture.emit(
        partActionsTopic(PART_ID),
        payload([{ ...free[0], text: "Locked", number: 1 }]),
      );
    });
    expect(await screen.findByText("Locked")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Gimbal: Locked",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("leaves out a True or False that says no more than the switch", async () => {
    await openWindow([
      row({
        kind: "toggle",
        name: "collide",
        label: "Same Vessel Interaction",
        text: "False",
        number: 0,
        editable: true,
      }),
    ]);

    expect(
      screen.getByRole("checkbox", { name: "Same Vessel Interaction" }),
    ).toBeTruthy();
    expect(screen.queryByText("False")).toBeNull();
  });

  it("says the part has left the vessel once every row has gone", async () => {
    const fixture = await openWindow();
    expect(screen.queryByText("This part has left the vessel.")).toBeNull();

    act(() => {
      fixture.emit(partActionsTopic(PART_ID), payload([]));
    });

    expect(
      await screen.findByText("This part has left the vessel."),
    ).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Thrust Limiter" })).toBeNull();
  });

  it("closes the window with a line that says the part left the vessel", async () => {
    const fixture = await openWindow();

    act(() => {
      fixture.emit(
        "vessel.parts",
        topologyToVesselPartsWire({
          ...TOPOLOGY,
          parts: TOPOLOGY.parts.filter((p) => p.flightId !== PART_ID),
        }),
      );
    });

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /window/ })).toBeNull(),
    );
    expect(
      (
        await screen.findByText(/left the vessel, so its window closed/)
      ).closest("[role=status]"),
    ).not.toBeNull();
  });

  it("keeps the closing line for its time when a later change empties the part list", async () => {
    const fixture = await openWindow();

    act(() => {
      fixture.emit(
        "vessel.parts",
        topologyToVesselPartsWire({
          ...TOPOLOGY,
          parts: TOPOLOGY.parts.filter((p) => p.flightId !== PART_ID),
        }),
      );
    });
    await screen.findByText(/left the vessel, so its window closed/);

    act(() => {
      fixture.emit(
        "vessel.parts",
        topologyToVesselPartsWire({ ...TOPOLOGY, parts: [] }),
      );
    });

    expect(await screen.findByText("Vessel has no parts.")).toBeTruthy();
    expect(
      screen.getByText(/left the vessel, so its window closed/),
    ).toBeTruthy();
  });

  it("closes the window with a line that says the vessel was destroyed", async () => {
    const fixture = await openWindow();

    act(() => {
      fixture.emit("crash.hasRecent", { recent: true });
      fixture.emit("crash.lastCrash", {
        vesselName: "Kerbal X",
        ut: 0,
        partsLost: TOPOLOGY.parts.map((p) => ({
          partId: p.flightId,
          partTitle: p.title ?? p.name,
        })),
        kerbalsKilled: [],
      });
    });

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /window/ })).toBeNull(),
    );
    expect(
      (
        await screen.findByText(
          /The vessel was destroyed, so the .* window closed/,
        )
      ).closest("[role=status]"),
    ).not.toBeNull();
  });

  it("rounds the age of the state to the nearest second", async () => {
    await openWindow(WINDOW, 3.9997);

    expect((await screen.findByText(/State as of/)).textContent).toMatch(
      /State as of 4\s*s ago/,
    );
  });
});
