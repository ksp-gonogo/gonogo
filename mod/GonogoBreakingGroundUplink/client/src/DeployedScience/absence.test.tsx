import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitStations,
  experiment,
  stationReport,
} from "../test/deployedStations";
import { parseStation } from "./index";
import "./index";

/**
 * Proves a withheld science figure, power state or roster is never drawn as a zero, unpowered or empty.
 * Zero is a real reading: a freshly planted experiment reports 0%.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

/** One station whose single experiment and header take `over`, mounted through the real provider stack. */
async function mount(
  over: Record<string, unknown> = {},
  experimentOver: Record<string, unknown> = {},
) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
  });
  const result = renderWidget("deployed-science", {
    instanceId: "ds-absence",
    w: 5,
    h: 9,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(result.unmount);
  await emitStations(fixture, [
    {
      report: stationReport({
        experiments: [experiment(experimentOver)],
        ...over,
      }),
    },
  ]);
  return { fixture, ...result };
}

const first = (raw: Record<string, unknown>) => parseStation("s", raw);

describe("parseStation: a withheld science figure is not a zero", () => {
  it("withholds progress and the collecting verdict together", () => {
    const parsed = first(
      stationReport({
        experiments: [experiment({ scienceCompletedPercentage: null })],
      }),
    );
    const exp = parsed?.experiments[0];
    expect(exp?.progress).toBeNull();
    expect(exp?.collecting).toBeNull();
  });

  it("withholds the transmitted split when the value is unread", () => {
    const parsed = first(
      stationReport({ experiments: [experiment({ scienceValue: null })] }),
    );
    const exp = parsed?.experiments[0];
    expect(exp?.total).toBeNull();
    expect(exp?.transmitted).toBeNull();
  });

  it("withholds the unsent data rather than reading it as an empty store", () => {
    const parsed = first(
      stationReport({ experiments: [experiment({ storedData: null })] }),
    );
    expect(parsed?.experiments[0]?.backlog).toBeNull();
  });

  it("keeps a genuine 0% and a genuine empty store as the readings they are", () => {
    const parsed = first(
      stationReport({
        experiments: [
          experiment({
            scienceCompletedPercentage: 0,
            scienceValue: 0,
            storedData: 0,
          }),
        ],
      }),
    );
    const exp = parsed?.experiments[0];
    expect(exp?.progress).toBe(0);
    expect(exp?.collecting).toBe(true);
    expect(exp?.backlog).toBe(0);
  });
});

describe("DeployedScience: a withheld progress is withheld on screen", () => {
  it("draws the meter's absent form rather than showing 0%", async () => {
    const { container } = await mount({}, { scienceCompletedPercentage: null });

    await screen.findByText("Seismometer");
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(visibleText(container)).not.toContain("0 %");
  });

  it("draws no bar, so nothing reports aria-valuenow 0", async () => {
    await mount({}, { scienceCompletedPercentage: null });

    await screen.findByText("Seismometer");
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("does not show the collecting badge for an unread experiment", async () => {
    await mount({}, { scienceCompletedPercentage: null });

    await screen.findByText("Seismometer");
    expect(screen.queryByText(/collecting/i)).toBeNull();
  });

  it("still draws the bar and the collecting badge for a real 0% reading", async () => {
    // The control: 0% is a reading, and it keeps its bar and its badge.
    await mount({}, { scienceCompletedPercentage: 0 });

    const bar = await screen.findByRole("meter", { name: "Seismometer" });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText(/collecting/i)).toBeInTheDocument();
  });

  it("has no a11y violations with every science figure withheld", async () => {
    const { container } = await mount(
      {},
      {
        scienceCompletedPercentage: null,
        scienceTransmittedPercentage: null,
        scienceValue: null,
        scienceLimit: null,
        storedData: null,
      },
    );
    await screen.findByText("Seismometer");
    await expectNoA11yViolations(container);
  });
});

describe("DeployedScience: a progress held over a dropped link", () => {
  it("keeps the experiment's meter, its fill dimmed", async () => {
    const { fixture } = await mount();
    const meter = await screen.findByRole("meter", { name: "Seismometer" });
    const root = () => meter.parentElement?.parentElement;
    // The control: a current report is not marked.
    expect(root()?.querySelector("[data-fill-held]")).toBeNull();

    // Drop the link, then run a frame: nothing else re-derives the readings.
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(root()?.querySelector("[data-fill-held]")).not.toBeNull(),
    );
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    expect(root()?.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("marks the station's power pill itself held, with no grade pill beside it", async () => {
    const { fixture } = await mount();
    await screen.findByRole("meter", { name: "Seismometer" });
    const heldMark = () =>
      screen
        .getByText("Powered")
        .closest("[role=status]")
        ?.querySelector("[data-held-mark]") ?? null;
    expect(heldMark()).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(heldMark()).not.toBeNull());
    expect(screen.queryByText(/^offline$/i)).toBeNull();
  });
});

describe("DeployedScience: an unstated power state is not unpowered", () => {
  it("withholds the powered flag rather than reading it as false", () => {
    const parsed = first(stationReport({ power: null }));
    expect(parsed?.powered).toBeNull();
  });

  it("says the power is unknown rather than painting a red Unpowered pill", async () => {
    await mount({ power: null });

    await screen.findByText("Mun");
    expect(screen.queryByText(/Unpowered/i)).toBeNull();
    const pill = screen.getByText("Power unknown", {
      selector: "[role=status]",
    });
    expect(pill.getAttribute("data-tone")).toBe("neutral");
  });

  it("still paints the red pill for a cluster that really is dark", async () => {
    // The control: an actual Unpowered ordinal keeps its `nogo` verdict.
    await mount({ power: DeployedPowerState.Unpowered });

    await screen.findByText("Mun");
    const pill = screen.getByText("Unpowered", { selector: "[role=status]" });
    expect(pill.getAttribute("data-tone")).toBe("nogo");
  });
});

describe("DeployedScience: an unread roster is not an empty one", () => {
  it("says it is waiting rather than claiming nothing is planted", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    const result = renderWidget("deployed-science", {
      instanceId: "ds-absence-roster",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      // The DLC is present and nothing lands on the catalog yet.
      fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Waiting for the deployed-station roster/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No deployed stations/i)).toBeNull();
  });

  it("still says there are no stations when the catalog says so", async () => {
    // The control: an observed catalog with no controller IS "nothing planted".
    const fixture = setupStreamFixture({ pinnedUt: 10 });
    const result = renderWidget("deployed-science", {
      instanceId: "ds-absence-empty",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
      fixture.emit("trackingStation.catalog", { entries: [] });
    });
    await waitFor(() =>
      expect(screen.getByText(/No deployed stations/i)).toBeInTheDocument(),
    );
  });
});
