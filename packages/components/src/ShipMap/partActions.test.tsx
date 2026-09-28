import type { VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import { ShipMapComponent } from "./index";
import { INVOKE_PART_ACTION_COMMAND } from "./PartActionMenu";
import { partActionsTopic } from "./usePartActions";

/**
 * PAW part actions end to end: real provider, client, store, widget, dynamic
 * per-part topic and delayed command over `StubTransport`, which delivers
 * only to subscribed topics, so the subscription is proven too.
 */

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY);

/** The flightId of the part the tests act on, taken from the fixture itself. */
const PART = TOPOLOGY.parts[0];
const PART_FLIGHT_ID: number = PART.flightId;

function partActionsWire(
  actions: Array<{
    name: string;
    label: string;
    group?: string;
    active?: boolean;
  }>,
) {
  return {
    partId: String(PART_FLIGHT_ID),
    actions: actions.map((a) => ({
      name: a.name,
      label: a.label,
      group: a.group,
      moduleName: "ModuleDeployableSolarPanel",
      active: a.active ?? true,
      guiActiveUnfocused: false,
      advancedTweakable: false,
      requireFullControl: false,
    })),
    meta: { source: "vessel:guid-1", quality: 0 },
  };
}

async function renderDiagram() {
  const fixture = setupStreamFixture({
    // Carried as a `.`-terminated prefix: per-part keys cannot be enumerated up front.
    pinnedUt: 10,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-paw" w={8} h={10} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  return { fixture, view };
}

/** The part's focusable `<g role="button">` in the diagram. */
function partElement(): HTMLElement {
  const parts = screen.getAllByRole("button");
  const part = parts.find((el) =>
    (el.getAttribute("aria-label") ?? "").includes(PART.title ?? PART.name),
  );
  if (!part) throw new Error("no focusable part matched the fixture's title");
  return part;
}

describe("ShipMap: PAW part actions", () => {
  it("opens a part's action menu on click and lists its buttons", async () => {
    const user = userEvent.setup();
    const { fixture } = await renderDiagram();

    await user.click(partElement());

    // Opening subscribes; the mod answers on the part's own dynamic topic.
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([
          { name: "ToggleSolarPanel", label: "Extend Solar Panel" },
        ]),
      );
    });

    const menu = await screen.findByRole("menu");
    expect(menu).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /Extend Solar Panel/ }),
      ).toBeTruthy(),
    );
  });

  it("draws the menu outside the widget, not inside its clipping container", async () => {
    // The Panel clips with overflow hidden, so the menu must be portalled out of the diagram.
    const user = userEvent.setup();
    const { fixture, view } = await renderDiagram();

    await user.click(partElement());
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([{ name: "Deploy", label: "Deploy" }]),
      );
    });

    const menu = await screen.findByRole("menu");
    expect(view.container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("dispatches the delayed invoke command with the part's stringified flightId", async () => {
    const user = userEvent.setup();
    const { fixture } = await renderDiagram();

    await user.click(partElement());
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([
          { name: "ToggleSolarPanel", label: "Extend Solar Panel" },
        ]),
      );
    });

    await user.click(
      await screen.findByRole("menuitem", { name: /Extend Solar Panel/ }),
    );

    const sent = fixture.transport.sentCommands;
    expect(sent).toHaveLength(1);
    expect(sent[0].command).toBe(INVOKE_PART_ACTION_COMMAND);
    // The wire keys by the stringified flightID, the form vessel.parts stamps.
    expect(sent[0].args).toEqual({
      partId: String(PART_FLIGHT_ID),
      eventName: "ToggleSolarPanel",
    });
    // The operator-facing label names the part, not just the raw event id.
    expect(sent[0].label).toContain("Extend Solar Panel");
  });

  it("renders an inactive action disabled rather than hiding it", async () => {
    const user = userEvent.setup();
    const { fixture } = await renderDiagram();

    await user.click(partElement());
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([{ name: "Deploy", label: "Deploy", active: false }]),
      );
    });

    const item = await screen.findByRole("menuitem", { name: /Deploy/ });
    // aria-disabled, not the native attribute, so the item stays in the keyboard walk.
    expect(item.getAttribute("aria-disabled")).toBe("true");

    // Firing it does nothing, as in-game.
    await user.click(item);
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("closes on Escape and returns focus to the part", async () => {
    const user = userEvent.setup();
    const { fixture } = await renderDiagram();

    const part = partElement();
    // Focus changes diagram state, so the raw DOM call needs an act scope.
    act(() => {
      part.focus();
    });
    await user.keyboard("{Enter}");
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([{ name: "Deploy", label: "Deploy" }]),
      );
    });
    // Wait for the menu to own focus: Escape bubbles out of the menu, so pressed early it would go to the part.
    const menu = await screen.findByRole("menu");
    await waitFor(() =>
      expect(menu.contains(document.activeElement)).toBe(true),
    );

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // Focus goes back to the part the operator was on, not to the body.
    expect(document.activeElement).toBe(part);
  });

  it("opens on right-click, the same gesture as KSP's own PAW", async () => {
    const user = userEvent.setup();
    const { fixture } = await renderDiagram();

    await user.pointer({ target: partElement(), keys: "[MouseRight]" });
    act(() => {
      fixture.emit(
        partActionsTopic(PART_FLIGHT_ID),
        partActionsWire([{ name: "Deploy", label: "Deploy" }]),
      );
    });

    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("says a part is still awaiting its list rather than reporting no actions", async () => {
    // Under delay the list arrives a light-time after the popover opens.
    const user = userEvent.setup();
    await renderDiagram();

    await user.click(partElement());

    expect(await screen.findByText(/Awaiting actions/)).toBeTruthy();
  });
});
