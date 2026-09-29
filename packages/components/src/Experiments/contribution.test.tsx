import {
  ContributionsProvider,
  clearContributions,
  DashboardItemContext,
  defineUplinkClient,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ContributionsPanelStore } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";
import type { Instrument } from "./instrument";

/**
 * The `experiments.instruments` contribution slot: contributed instruments are
 * drawn with the widget's own rows, counted in its totals and matched by its filter.
 */

const SCANNER_MOD = defineUplinkClient({
  id: "scanner-mod",
  version: "0.0.0-dev",
  name: "Scanner Mod",
});

const SCANNER: Instrument = {
  partId: "sar-1",
  partTitle: "SAR Altimetry Sensor",
  expId: "AltimetryHiRes",
  deployed: false,
  hasData: true,
  rerunnable: true,
  inoperable: false,
};

/** The stock wire shape, as `ScienceViewProvider` emits it. */
const STOCK_WIRE = {
  partId: 1,
  partName: "Mystery Goo",
  experimentId: "mysteryGoo",
  deployed: false,
  inoperable: false,
  rerunnable: false,
  dataIsCollectable: false,
};

const renderedTrees: Array<() => void> = [];

function renderWithContributions() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      {/* Aggregation only runs for declared slots, so the meta mirrors `registerComponent`. */}
      <WidgetMetaContext.Provider
        value={{
          componentId: "experiments",
          contributionSlots: ["experiments.instruments"],
        }}
      >
        <ContributionsPanelStore.Provider>
          <ContributionsProvider>
            <DashboardItemContext.Provider
              value={{ instanceId: "sci-contrib" }}
            >
              <ExperimentsComponent config={{}} id="sci-contrib" w={6} h={8} />
            </DashboardItemContext.Provider>
          </ContributionsProvider>
        </ContributionsPanelStore.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return fixture;
}

describe("Experiments: the experiments.instruments contribution slot", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearContributions();
  });

  it("draws a contributed instrument with its own row, under a heading naming who supplied it", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      compute: () => [SCANNER],
    });
    const fixture = renderWithContributions();
    act(() => {
      fixture.emit("science.instruments", [STOCK_WIRE]);
    });

    await waitFor(() =>
      expect(screen.getByText("SAR Altimetry Sensor")).toBeTruthy(),
    );
    const row = screen.getByText("SAR Altimetry Sensor").closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("DATA")).toBeTruthy();
    // Attributed to the Uplink, so the operator can see where a row with no controls came from.
    expect(screen.getByText("Scanner Mod")).toBeTruthy();
    // The stock instrument is untouched beside it.
    expect(screen.getByText("Mystery Goo")).toBeTruthy();
  });

  it("renders a contributed row READ-ONLY: no Transmit, where the stock row holding data gets one", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      compute: () => [SCANNER],
    });
    const fixture = renderWithContributions();
    act(() => {
      // Same `hasData` as the scanner, so only the source separates the two rows.
      fixture.emit("science.instruments", [
        { ...STOCK_WIRE, dataIsCollectable: true },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("SAR Altimetry Sensor")).toBeTruthy(),
    );
    const contributedRow = screen
      .getByText("SAR Altimetry Sensor")
      .closest("li") as HTMLElement;
    const stockRow = screen
      .getByText("Mystery Goo")
      .closest("li") as HTMLElement;
    // Commands reach a part only through the stock science module.
    expect(within(contributedRow).queryByRole("button")).toBeNull();
    expect(
      within(stockRow).getByRole("button", { name: /Transmit/ }),
    ).toBeTruthy();
  });

  it("does not report 'No instruments aboard' when every instrument aboard is contributed", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      compute: () => [SCANNER],
    });
    const fixture = renderWithContributions();
    act(() => {
      // A confirmed-empty stock list: the vessel carries no STOCK experiment.
      fixture.emit("science.instruments", []);
    });

    await waitFor(() =>
      expect(screen.getByText("SAR Altimetry Sensor")).toBeTruthy(),
    );
    expect(screen.queryByText("No instruments aboard")).toBeNull();
    expect(screen.queryByText("Awaiting instrument telemetry")).toBeNull();
  });

  it("counts contributed instruments in the header totals", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      compute: () => [SCANNER],
    });
    const fixture = renderWithContributions();
    act(() => {
      fixture.emit("science.instruments", [STOCK_WIRE]);
    });

    // One stock instrument without data, one contributed with it.
    await waitFor(() =>
      expect(screen.getByText(/1\/2 with data/)).toBeTruthy(),
    );
  });

  it("drops a contributed instrument the stock list already reports, rather than drawing it twice", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      // Same `partId` the stock wire below carries.
      compute: () => [
        { ...SCANNER, partId: "1", partTitle: "Mystery Goo (mod copy)" },
      ],
    });
    const fixture = renderWithContributions();
    act(() => {
      fixture.emit("science.instruments", [STOCK_WIRE]);
    });

    await waitFor(() => expect(screen.getByText("Mystery Goo")).toBeTruthy());
    expect(screen.queryByText("Mystery Goo (mod copy)")).toBeNull();
    expect(screen.getByText(/0\/1 with data/)).toBeTruthy();
  });

  it("matches contributed instruments against the widget's own row filter", async () => {
    SCANNER_MOD.registerContribution({
      id: "scan-science",
      contributes: "experiments.instruments",
      compute: () => [SCANNER],
    });
    const fixture = renderWithContributions();
    act(() => {
      fixture.emit("science.instruments", [STOCK_WIRE]);
    });
    await waitFor(() =>
      expect(screen.getByText("SAR Altimetry Sensor")).toBeTruthy(),
    );

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search" }),
      "Altimetry",
    );

    await waitFor(() => expect(screen.queryByText("Mystery Goo")).toBeNull());
    expect(screen.getByText("SAR Altimetry Sensor")).toBeTruthy();
    expect(screen.queryByText("No instrument matches the filter")).toBeNull();
  });
});
