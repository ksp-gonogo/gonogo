import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ExperimentsComponent,
  type ExperimentsInstrumentSlotContext,
  type Instrument,
} from "./index";

/**
 * Experiments augment slots (`experiments.instrument` per row, `experiments.actions`
 * in the header): an empty slot renders cleanly, and a registered augment appears
 * with its typed slot props.
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

// Unmounted before the registries clear, so the clear never updates a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

// The full instrument-list layout, where both slots render.
async function renderFullList(): Promise<void> {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      {/* `Panel` names its universal segments from this identity. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "experiments", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId: "sci-slot" }}>
          <ExperimentsComponent config={{}} id="sci-slot" w={6} h={8} />
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
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

describe("Experiments: augment slots", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes both slots with no augments bound (registry starts empty)", () => {
    expect(getAugmentsForSlot("experiments.instrument")).toEqual([]);
    expect(getAugmentsForSlot("experiments.actions")).toEqual([]);
  });

  it("renders the full list with no augments bound (empty slots are inert)", async () => {
    await renderFullList();
    // Empty slots add nothing: the stock readout renders exactly as before.
    expect(screen.getByText("Mystery Goo")).toBeTruthy();
    expect(screen.queryByTestId("sci-section-augment")).toBeNull();
    expect(screen.queryByTestId("sci-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the sections slot, passing the instrument as slot props", async () => {
    function SectionAugment({ instrument }: ExperimentsInstrumentSlotContext) {
      return (
        <div data-testid="sci-section-augment">LAB: {instrument.partTitle}</div>
      );
    }
    await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-section",
        augments: "experiments.instrument",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("sci-section-augment");
    // The per-row slot passed the widget's instrument down.
    expect(augment.textContent).toBe("LAB: Mystery Goo");
  });

  it("renders a test augment bound to the header actions segment", async () => {
    // A propless header segment, mounted by `Panel` from the widget's identity alone.
    function ActionsAugment() {
      return <span data-testid="sci-actions-augment">EXTRA 3</span>;
    }
    await renderFullList();

    act(() => {
      registerAugment({
        id: "test-sci-actions",
        augments: "experiments.actions",
        component: ActionsAugment,
      });
    });

    const augment = await screen.findByTestId("sci-actions-augment");
    expect(augment.textContent).toBe("EXTRA 3");
    // In the header beside the title, not in the body.
    expect(augment.closest("[data-panel-header]")).not.toBeNull();
  });
});
