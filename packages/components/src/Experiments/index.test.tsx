import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { DelayRailProvider } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ExperimentsComponent,
  parseInstruments,
  sumExperimentDataAmount,
} from "./index";

// Unmounted before the registry clears, so the clear never updates a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderOfficer(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci-off" }}>
        <ExperimentsComponent config={{}} id="sci-off" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("ExperimentsComponent", () => {
  it("shows the awaiting placeholder before any telemetry arrives", () => {
    renderOfficer(newFixture());
    expect(
      screen.getByText(/Awaiting instrument telemetry/i),
    ).toBeInTheDocument();
  });

  it("renders 'No instruments' for an empty array", async () => {
    const fixture = newFixture();
    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", []);
    });
    await waitFor(() =>
      expect(screen.getByText(/No instruments aboard/i)).toBeInTheDocument(),
    );
  });

  it("groups instruments by expId and shows badges", async () => {
    const fixture = newFixture();
    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", [
        {
          partId: 1,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: true,
          hasData: true,
          rerunnable: false,
          inoperable: false,
        },
        {
          partId: 2,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: false,
          hasData: false,
          rerunnable: false,
          inoperable: true,
        },
        {
          partId: 3,
          partTitle: "Thermometer",
          expId: "temperatureScan",
          deployed: false,
          hasData: false,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("mysteryGoo")).toBeInTheDocument(),
    );
    expect(screen.getByText("temperatureScan")).toBeInTheDocument();

    expect(screen.getByText("DATA")).toBeInTheDocument();
    expect(screen.getByText("INOPERABLE")).toBeInTheDocument();

    expect(
      screen.getByText(/1\/3 with data · 1 deployed · 1 inoperable/i),
    ).toBeInTheDocument();
  });

  it("derives the total data readout from science.experiments (D3, P4a)", async () => {
    const fixture = newFixture();
    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", [
        {
          partId: 1,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: true,
          hasData: true,
          rerunnable: false,
          inoperable: false,
        },
      ]);
      fixture.emit("science.experiments", [
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b", dataAmount: 7.5 },
      ]);
    });
    await waitFor(() => expect(visibleText()).toMatch(/12\.5 mits/i));
  });

  it("fires science.experiment.deploy when Deploy is clicked on an undeployed instrument", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();

    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", [
        {
          partId: 42,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: false,
          hasData: false,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await user.click(await screen.findByText("Deploy"));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "science.experiment.deploy",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "42" });
    });
  });

  it("requires arm-then-confirm before transmitting an instrument's data", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();

    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", [
        {
          partId: 99,
          partTitle: "Thermometer",
          expId: "temperatureScan",
          deployed: true,
          hasData: true,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await user.click(await screen.findByText("Transmit"));
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === "science.experiment.transmit",
      ),
    ).toBeUndefined();

    await user.click(screen.getByText(/Confirm transmit/i));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "science.experiment.transmit",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "99" });
    });
  });

  it("carries a confirmed transmission home on the panel rail, and drops it on arrival", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    // Sent at the craft from UT 0, its last packet away at 4, landing one 30 s light-time later.
    fixture.transport.setCommandHandler((command) =>
      command === "science.experiment.transmit"
        ? {
            success: true,
            payload: {
              subjectId: "temperatureScan@KerbinSrfLandedLaunchPad",
              title: "Temperature Scan from LaunchPad",
              startedAt: 0,
              streamSeconds: 4,
              dataAmount: 8,
            },
          }
        : { success: true },
    );
    const { container, unmount } = render(
      <fixture.Provider>
        <DelayRailProvider>
          <DashboardItemContext.Provider value={{ instanceId: "sci-off" }}>
            <ExperimentsComponent config={{}} id="sci-off" />
          </DashboardItemContext.Provider>
        </DelayRailProvider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit(
        "comms.delay",
        { source: 1, oneWaySeconds: 30 },
        { validAt: 0, deliveredAt: 0 },
      );
      fixture.emit("science.instruments", [
        {
          partId: 99,
          partTitle: "Thermometer",
          expId: "temperatureScan",
          deployed: true,
          hasData: true,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await user.click(await screen.findByText("Transmit"));
    await user.click(screen.getByText(/Confirm transmit/i));
    await user.click(
      await screen.findByRole("button", { name: "Signal-delay detail" }),
    );

    expect(
      await screen.findByRole("listitem", {
        name: "Temperature Scan from LaunchPad, in transit",
      }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);

    act(() => {
      fixture.wall.advanceBy(40);
      vi.advanceTimersByTime(40_000);
      fixture.emitFrame();
    });
    expect(
      screen.queryByRole("listitem", {
        name: /Temperature Scan from LaunchPad/,
      }),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("hides controls for an inoperable instrument", async () => {
    const fixture = newFixture();
    renderOfficer(fixture);
    act(() => {
      fixture.emit("science.instruments", [
        {
          partId: 1,
          partTitle: "Burned Sensor",
          expId: "x",
          deployed: false,
          hasData: false,
          rerunnable: false,
          inoperable: true,
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText("Burned Sensor")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Deploy")).not.toBeInTheDocument();
    expect(screen.queryByText("Transmit")).not.toBeInTheDocument();
  });
});

describe("parseInstruments", () => {
  it("returns null for non-array input", () => {
    expect(parseInstruments(null)).toBeNull();
    expect(parseInstruments(undefined)).toBeNull();
    expect(parseInstruments({})).toBeNull();
  });

  it("drops malformed entries and coerces booleans", () => {
    const parsed = parseInstruments([
      {
        partId: 1,
        partTitle: "Goo",
        expId: "mysteryGoo",
        deployed: true,
        hasData: false,
        rerunnable: false,
        inoperable: false,
      },
      // missing partId
      { partTitle: "Bad" },
      // missing partTitle falls back rather than dropping
      {
        partId: 2,
        expId: "temp",
        deployed: false,
        hasData: false,
        rerunnable: true,
        inoperable: false,
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[1].partTitle).toBe("Unknown part");
  });
});

describe("sumExperimentDataAmount", () => {
  it("returns 0 for non-array input", () => {
    expect(sumExperimentDataAmount(null)).toBe(0);
    expect(sumExperimentDataAmount(undefined)).toBe(0);
    expect(sumExperimentDataAmount({})).toBe(0);
  });

  it("sums dataAmount across every entry", () => {
    expect(
      sumExperimentDataAmount([
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b", dataAmount: 8 },
      ]),
    ).toBe(13);
  });

  it("skips entries with a missing/non-numeric dataAmount", () => {
    expect(
      sumExperimentDataAmount([
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b" },
        { subjectId: "c", dataAmount: "not a number" },
      ]),
    ).toBe(5);
  });
});
