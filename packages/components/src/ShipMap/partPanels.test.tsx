import type { VesselTopology } from "@ksp-gonogo/core";
import {
  ContributionsProvider,
  useTelemetry,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  clearPartPanels,
  type PartPanelProps,
  registerPartPanel,
  registerPartPanelFallback,
} from "@ksp-gonogo/sitrep-sdk";
import { clearContributions } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
} from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import { ShipMapComponent } from "./index";
import { partActionsTopic } from "./usePartActions";

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY);
const PART = TOPOLOGY.parts[0];
const PART_ID = String(PART.flightId);
const MODULE = "ModuleTestWindow";
const EVENT = "OpenWindow";

const META = {
  componentId: "ship-map",
  contributionSlots: ["ship-map.part-actions"] as const,
};

function Panel({ partId, partTitle, close }: PartPanelProps) {
  // A read proves the panel sits under the widget's own telemetry provider.
  const reading = useTelemetry("vessel.parts");
  return (
    <div>
      <p>
        panel for {partId} {partTitle}
      </p>
      <p>{reading.state === "observed" ? "parts observed" : "parts unread"}</p>
      <button type="button" onClick={close}>
        Finish
      </button>
    </div>
  );
}

const WITH_PANEL = {
  id: "test:window",
  title: "Console Window",
  component: Panel,
  replaces: [{ module: MODULE, event: EVENT }],
};

function actionsWire(active = true) {
  return {
    partId: PART_ID,
    actions: [
      {
        name: EVENT,
        label: "Open Window",
        group: null,
        moduleName: MODULE,
        active,
        guiActiveUnfocused: false,
        advancedTweakable: false,
        requireFullControl: false,
      },
    ],
    meta: { source: "vessel:guid-1", quality: 0 },
  };
}

async function renderDiagram(
  store = createDomainAvailabilityStore(),
  wire = actionsWire(),
) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DomainAvailabilityContext.Provider value={store}>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <ShipMapComponent id="ship-map-panels" w={8} h={10} />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </DomainAvailabilityContext.Provider>
    </fixture.Provider>,
  );
  act(() => fixture.emit("vessel.parts", VESSEL_PARTS_WIRE));
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  const user = userEvent.setup();
  const part = screen
    .getAllByRole("button")
    .find((el) =>
      (el.getAttribute("aria-label") ?? "").includes(PART.title ?? PART.name),
    );
  if (!part) throw new Error("no focusable part matched the fixture's title");
  await user.click(part);
  act(() => fixture.emit(partActionsTopic(PART.flightId), wire));
  return { fixture, user, view };
}

const menuItem = (name: RegExp) => screen.findByRole("menuitem", { name });

// beforeEach, never afterEach: clearing while a tree is mounted notifies its subscribers outside act()
beforeEach(() => {
  clearPartPanels();
  clearContributions();
});

describe("ShipMap: part panels", () => {
  it("opens the panel for a game button it replaces and sends nothing", async () => {
    registerPartPanel(WITH_PANEL);
    const { fixture, user } = await renderDiagram();

    await user.click(await menuItem(/Open Window/));

    const title = `Console Window · ${PART.title || PART.name}`;
    expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
    expect(screen.getByText(new RegExp(`panel for ${PART_ID}`))).toBeTruthy();
    expect(screen.getByText("parts observed")).toBeTruthy();
    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes through the panel's own close", async () => {
    registerPartPanel(WITH_PANEL);
    const { user } = await renderDiagram();
    await user.click(await menuItem(/Open Window/));

    await user.click(await screen.findByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes when its part leaves the vessel", async () => {
    registerPartPanel(WITH_PANEL);
    const { fixture, user } = await renderDiagram();
    await user.click(await menuItem(/Open Window/));
    await screen.findByRole("dialog");

    act(() =>
      fixture.emit(
        "vessel.parts",
        topologyToVesselPartsWire({
          ...TOPOLOGY,
          parts: TOPOLOGY.parts.slice(1),
        }),
      ),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("fires the game button as usual when no panel replaces it", async () => {
    const { fixture, user } = await renderDiagram();

    await user.click(await menuItem(/Open Window/));

    expect(fixture.transport.sentCommands[0].command).toBe(
      "vessel.invokePartAction",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fires the game button as usual while the panel's Domain is absent, and opens the panel once it arrives", async () => {
    registerPartPanel({ ...WITH_PANEL, requires: "test-domain" });
    const store = createDomainAvailabilityStore();
    const { fixture, user } = await renderDiagram(store);

    await user.click(await menuItem(/Open Window/));
    expect(fixture.transport.sentCommands).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => store.setAvailable("test-domain", true));
    await user.click(
      screen
        .getAllByRole("button")
        .find((el) =>
          (el.getAttribute("aria-label") ?? "").includes(
            PART.title ?? PART.name,
          ),
        ) as HTMLElement,
    );
    await user.click(await menuItem(/Open Window/));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("advises on a greyed game button and still opens its panel", async () => {
    registerPartPanel(WITH_PANEL);
    const { user } = await renderDiagram(
      createDomainAvailabilityStore(),
      actionsWire(false),
    );

    const item = await menuItem(/Open Window/);
    expect(item.getAttribute("aria-disabled")).toBeNull();
    expect(item).toHaveAccessibleDescription(/the game greys this action/i);

    await user.click(item);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("hands a button no panel names to a fallback", async () => {
    const seen: string[] = [];
    registerPartPanelFallback((button) => {
      seen.push(`${button.module}/${button.event}/${button.label}`);
      return { ...WITH_PANEL, id: "game-window:test", title: "Mirror" };
    });
    const { fixture, user } = await renderDiagram();

    const item = await menuItem(/Open Window/);
    expect(item).toHaveTextContent("Open Window...");
    await user.click(item);
    expect(fixture.transport.sentCommands.map((c) => c.command)).toEqual([
      "vessel.invokePartAction",
    ]);

    expect(seen).toContain(`${MODULE}/${EVENT}/Open Window`);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Mirror");
  });

  it("prefers a panel naming the button over a fallback", async () => {
    registerPartPanel(WITH_PANEL);
    registerPartPanelFallback(() => ({
      ...WITH_PANEL,
      id: "test:mirror",
      title: "Mirror",
    }));
    const { fixture, user } = await renderDiagram();

    const item = await menuItem(/Open Window/);
    expect(item).toHaveTextContent("Open Window...");
    await user.click(item);
    expect(fixture.transport.sentCommands).toHaveLength(0);

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Console Window",
    );
  });

  it("draws a panel's title adornment beside the heading, outside the dialog's name", async () => {
    registerPartPanel({
      ...WITH_PANEL,
      titleAdornment: <span data-testid="adornment">!</span>,
    });
    const { user } = await renderDiagram();

    await user.click(await menuItem(/Open Window/));

    const dialog = await screen.findByRole("dialog", {
      name: `Console Window \u00b7 ${PART.title ?? PART.name}`,
    });
    expect(dialog).toContainElement(screen.getByTestId("adornment"));
  });
});
