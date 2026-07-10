import type { DataKey } from "@gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
} from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  type Instrument,
  ScienceOfficerComponent,
  type ScienceOfficerInstrumentSlotContext,
  type ScienceOfficerSlotContext,
} from "./index";

/**
 * ScienceOfficer augment-slot exposure (Uplink architecture spec §4,
 * augment-slot-map). The slots (`science-officer.sections` — the per-instrument
 * row slot, and `science-officer.badges` — the header escape-hatch) are exposed
 * but ship no filler here (that's an Uplink augment, P3/P6): an empty slot must
 * render cleanly, and a test augment registered into it must appear, receiving
 * the widget's focus as typed slot props (§4.4).
 */

const KEYS: DataKey[] = [
  { key: "sci.instruments" },
  { key: "sci.experiments" },
];

const INSTRUMENT: Instrument = {
  partId: "1",
  partTitle: "Mystery Goo",
  expId: "mysteryGoo",
  deployed: false,
  hasData: true,
  rerunnable: false,
  inoperable: false,
};

// Drive the widget to its full instrument-list layout, where both the header
// `badges` slot and the per-instrument `sections` slot render.
async function renderFullList(): Promise<MockDataSourceFixture> {
  const fixture = await setupMockDataSource({ keys: KEYS });
  render(<ScienceOfficerComponent config={{}} id="sci-slot" w={6} h={8} />);
  act(() => {
    fixture.source.emit("sci.instruments", [INSTRUMENT]);
    fixture.source.emit("sci.experiments", [
      { subjectId: "mysteryGoo@test", dataAmount: 12.5 },
    ]);
  });
  await waitFor(() => expect(screen.getByText("Mystery Goo")).toBeTruthy());
  return fixture;
}

describe("ScienceOfficer — augment slots (spec §4)", () => {
  afterEach(() => {
    cleanup();
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes both slots with no augments bound (registry starts empty)", () => {
    expect(getAugmentsForSlot("science-officer.sections")).toEqual([]);
    expect(getAugmentsForSlot("science-officer.badges")).toEqual([]);
  });

  it("renders the full list with no augments bound (empty slots are inert)", async () => {
    const fixture = await renderFullList();
    // Empty slots add nothing — the stock readout renders exactly as before.
    expect(screen.getByText("Mystery Goo")).toBeTruthy();
    expect(screen.queryByTestId("sci-section-augment")).toBeNull();
    expect(screen.queryByTestId("sci-badge-augment")).toBeNull();
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the sections slot, passing the instrument as slot props", async () => {
    function SectionAugment({
      instrument,
    }: ScienceOfficerInstrumentSlotContext) {
      return (
        <div data-testid="sci-section-augment">LAB: {instrument.partTitle}</div>
      );
    }
    const fixture = await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-section",
        augments: "science-officer.sections",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("sci-section-augment");
    // The per-row slot passed the widget's instrument down (spec §4.4).
    expect(augment.textContent).toBe("LAB: Mystery Goo");
    teardownMockDataSource(fixture);
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
    const fixture = await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-badge",
        augments: "science-officer.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("sci-badge-augment");
    expect(badge.textContent).toBe("1@12.5");
    teardownMockDataSource(fixture);
  });
});
