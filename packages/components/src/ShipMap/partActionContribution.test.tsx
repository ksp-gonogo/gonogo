import type { VesselTopology } from "@ksp-gonogo/core";
import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import { ShipMapComponent } from "./index";
import { partActionsTopic } from "./usePartActions";

/**
 * Buttons an Uplink contributes to `ship-map.part-actions` join the part's menu
 * after the game's own, count in its tooltip, and send their command through the
 * same delay-aware path as any other.
 */

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY);
const PART = TOPOLOGY.parts[0];
const PART_ID = String(PART.flightId);

const META = {
  componentId: "ship-map",
  contributionSlots: ["ship-map.part-actions"] as const,
};

function contribute(active = true) {
  registerContribution({
    id: "part-action-contribution-test",
    contributes: "ship-map.part-actions",
    compute: () => [
      {
        partId: PART_ID,
        name: "experiment.start",
        label: "Start Mystery Goo Observation",
        active,
        command: "science.experiment.start" as const,
        args: { partId: PART_ID, experimentId: "mysteryGoo" },
      },
    ],
  });
}

async function renderDiagram() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <ShipMapComponent id="ship-map-contributed" w={8} h={10} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  return fixture;
}

function partElement(): HTMLElement {
  const part = screen
    .getAllByRole("button")
    .find((el) =>
      (el.getAttribute("aria-label") ?? "").includes(PART.title ?? PART.name),
    );
  if (!part) throw new Error("no focusable part matched the fixture's title");
  return part;
}

// beforeEach, never afterEach: clearing while the previous tree is mounted notifies its subscribers outside act()
beforeEach(() => clearContributions());

describe("ShipMap: contributed part actions", () => {
  it("lists a contributed button in the part's menu and sends its command", async () => {
    contribute();
    const user = userEvent.setup();
    const fixture = await renderDiagram();

    await user.click(partElement());
    await user.click(
      await screen.findByRole("menuitem", {
        name: /Start Mystery Goo Observation/,
      }),
    );

    const sent = fixture.transport.sentCommands;
    expect(sent).toHaveLength(1);
    expect(sent[0].command).toBe("science.experiment.start");
    expect(sent[0].args).toEqual({
      partId: PART_ID,
      experimentId: "mysteryGoo",
    });
    expect(sent[0].label).toContain("Start Mystery Goo Observation");
  });

  it("lists it after the game's own buttons", async () => {
    contribute();
    const user = userEvent.setup();
    const fixture = await renderDiagram();

    await user.click(partElement());
    act(() => {
      fixture.emit(partActionsTopic(PART.flightId), {
        partId: PART_ID,
        actions: [
          {
            name: "ToggleSolarPanel",
            label: "Extend Solar Panel",
            moduleName: "ModuleDeployableSolarPanel",
            active: true,
            guiActiveUnfocused: false,
            advancedTweakable: false,
            requireFullControl: false,
          },
        ],
        meta: { source: "vessel:guid-1", quality: 0 },
      });
    });

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Extend Solar Panel",
      "Start Mystery Goo Observation",
    ]);
  });

  it("keeps an inactive contributed button selectable and marks it as likely to be refused", async () => {
    contribute(false);
    const user = userEvent.setup();
    await renderDiagram();

    await user.click(partElement());

    const item = await screen.findByRole("menuitem", {
      name: /Start Mystery Goo Observation/,
    });
    expect(item.getAttribute("aria-disabled")).toBeNull();
    expect(item.getAttribute("data-predicted")).toBe("at-risk");
  });

  it("counts a contributed button in the hover tooltip", async () => {
    contribute();
    const user = userEvent.setup();
    await renderDiagram();

    await user.hover(partElement());

    expect(await screen.findByText("1 available")).toBeTruthy();
  });

  it("hides the hover card while the part menu is open and brings it back once it closes", async () => {
    contribute();
    const user = userEvent.setup();
    await renderDiagram();

    await user.hover(partElement());
    expect(await screen.findByText("1 available")).toBeTruthy();

    await user.click(partElement());
    await screen.findByRole("menu");
    expect(screen.queryByText("1 available")).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(await screen.findByText("1 available")).toBeTruthy();
  });
});
