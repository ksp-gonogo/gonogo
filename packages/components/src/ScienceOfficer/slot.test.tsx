import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type Instrument,
  ScienceOfficerComponent,
  type ScienceOfficerInstrumentSlotContext,
  type ScienceOfficerSlotContext,
} from "./index";

/**
 * ScienceOfficer augment-slot exposure. The slots (`science-officer.sections`
 * — the per-instrument row slot, and `science-officer.badges` — the header
 * escape-hatch) are exposed but ship no filler here (that's an Uplink
 * augment): an empty slot must render cleanly, and a test augment registered
 * into it must appear, receiving the widget's focus as typed slot props.
 *
 * Runs off the real stream pipeline (`science.instruments`/`science.experiments`
 * carried through a `TelemetryProvider`) — the widget reads its whole state
 * off canonical Topics now, no legacy `DataSource`.
 */

const INSTRUMENT: Instrument = {
  partId: "1",
  partTitle: "Mystery Goo",
  expId: "mysteryGoo",
  deployed: false,
  hasData: true,
  rerunnable: false,
  inoperable: false,
};

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler / augment registries — clearActionHandlers()/clearAugments()
// firing on a still-mounted widget is a state update outside act(). RTL
// auto-cleanup runs after this file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

// Drive the widget to its full instrument-list layout, where both the header
// `badges` slot and the per-instrument `sections` slot render.
async function renderFullList(): Promise<void> {
  const fixture = setupStreamFixture({
    carriedChannels: ["science.instruments", "science.experiments"],
    pinnedUt: 10,
  });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci-slot" }}>
        <ScienceOfficerComponent config={{}} id="sci-slot" w={6} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("science.instruments", [
      {
        partId: INSTRUMENT.partId,
        partName: INSTRUMENT.partTitle,
        experimentId: INSTRUMENT.expId,
        deployed: INSTRUMENT.deployed,
        inoperable: INSTRUMENT.inoperable,
        rerunnable: INSTRUMENT.rerunnable,
        dataIsCollectable: INSTRUMENT.hasData,
      },
    ]);
    fixture.emit("science.experiments", [
      { subjectId: "mysteryGoo@test", dataAmount: 12.5 },
    ]);
  });
  await waitFor(() => expect(screen.getByText("Mystery Goo")).toBeTruthy());
}

describe("ScienceOfficer — augment slots (spec §4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes both slots with no augments bound (registry starts empty)", () => {
    expect(getAugmentsForSlot("science-officer.sections")).toEqual([]);
    expect(getAugmentsForSlot("science-officer.badges")).toEqual([]);
  });

  it("renders the full list with no augments bound (empty slots are inert)", async () => {
    await renderFullList();
    // Empty slots add nothing — the stock readout renders exactly as before.
    expect(screen.getByText("Mystery Goo")).toBeTruthy();
    expect(screen.queryByTestId("sci-section-augment")).toBeNull();
    expect(screen.queryByTestId("sci-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the sections slot, passing the instrument as slot props", async () => {
    function SectionAugment({
      instrument,
    }: ScienceOfficerInstrumentSlotContext) {
      return (
        <div data-testid="sci-section-augment">LAB: {instrument.partTitle}</div>
      );
    }
    await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-section",
        augments: "science-officer.sections",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("sci-section-augment");
    // The per-row slot passed the widget's instrument down.
    expect(augment.textContent).toBe("LAB: Mystery Goo");
  });

  it("renders a test augment bound to the badges slot in the header, receiving the instrument list", async () => {
    function BadgeAugment({
      instruments,
      dataAmount,
    }: ScienceOfficerSlotContext) {
      return (
        <span data-testid="sci-badge-augment">
          {instruments?.length ?? 0}@{dataAmount}
        </span>
      );
    }
    await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-badge",
        augments: "science-officer.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("sci-badge-augment");
    expect(badge.textContent).toBe("1@12.5");
  });
});
