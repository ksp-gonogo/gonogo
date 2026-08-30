import {
  ContributionsProvider,
  DashboardItemContext,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

/**
 * What ResourceOps withholds when an `isru.*` channel stops being current, and how
 * the operator can tell from outside the component.
 *
 * The decision, per field: the RIG stays drawn and every FIGURE on it goes. Which
 * drills and converters are bolted to the vessel is a fact that only an event can
 * change, and no event reaches us down a link that has stopped delivering, so
 * blanking the list would erase hardware that is demonstrably still there. What
 * each unit is doing is the opposite: a harvester stops itself when its tank
 * fills, a converter starves when the ore runs out, and ore abundance changes the
 * moment the rover drives somewhere else. A green "running" card is a claim about
 * the vessel now.
 *
 * Which is why the withholding has to be VISIBLE. A card with no rate and no run
 * badge looks like a backend that publishes a thin payload, and the widget's own
 * "No drills or converters on this vessel" is a confident statement about the
 * craft. Every case below pairs "the figure is gone" with "the reason is on
 * screen", because neither half alone would catch a regression.
 *
 * A per-topic staleness is server-stamped rather than transport-wide, which is why
 * the one-channel case emits `Staleness.HeldStale` on `isru.drills` instead of
 * dropping the transport: that is the wire shape for "this channel alone is not
 * current".
 */

const CARRIED = ["isru.drills", "isru.converters"];

const DRILLS = [
  {
    partId: "101",
    partTitle: "Drill-O-Matic",
    resource: "Ore",
    deployed: true,
    running: true,
    abundance: 0.075,
    rate: 0.0037,
  },
  {
    partId: "102",
    partTitle: "Drill-O-Matic Junior",
    resource: "Ore",
    deployed: null,
    running: false,
    abundance: null,
    rate: 0,
  },
];

const CONVERTERS = [
  {
    partId: "201",
    partTitle: "Convert-O-Tron 250",
    running: true,
    inputs: [
      { resource: "Ore", rate: 0.5 },
      { resource: "ElectricCharge", rate: 30 },
    ],
    outputs: [{ resource: "LiquidFuel", rate: 0.45 }],
  },
  {
    partId: "202",
    partTitle: "Starved Converter",
    running: true,
    inputs: [{ resource: "Ore", rate: 0.25 }],
    outputs: [{ resource: "Monopropellant", rate: 0 }],
  },
];

const META = {
  componentId: "resource-ops",
  contributionSlots: [],
} as const;

function renderWidget() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    suspendFrames: true,
  });
  const utils = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "resource-ops" }}>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <ResourceOpsComponent w={6} h={8} />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...utils };
}

function emitBoth(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("isru.drills", DRILLS);
    fixture.emit("isru.converters", CONVERTERS);
  });
}

function dropTheLink(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

function statsHeader(): HTMLElement {
  return screen.getByRole("group", { name: "Resource ops summary" });
}

describe("ResourceOps when an isru channel is not current", () => {
  it("draws every figure while both channels are current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that never draws a rate or a run badge at all.
    const { fixture } = renderWidget();
    emitBoth(fixture);

    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByText("no output")).toBeInTheDocument();
    expect(screen.queryAllByText("run state held")).toHaveLength(0);
    expect(visibleText()).not.toMatch(/no longer current/i);
    // Three of the four processes are running, counted from live run flags, and
    // the 30 units/s of ElectricCharge they draw is on the header. Both are here
    // so the "withheld" assertions further down are assertions about something.
    expect(within(statsHeader()).getByText("3")).toBeInTheDocument();
    expect(visibleText(statsHeader())).toContain("30");
    expect(visibleText()).toContain("0.0037");
  });

  it("keeps the hardware listed and NAMES both channels as no longer current", async () => {
    const { fixture } = renderWidget();
    emitBoth(fixture);
    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();

    dropTheLink(fixture);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Rates and run state no longer current: drills, converters",
        ),
      ).toBeInTheDocument(),
    );
    // The rig is a fact and survives: every unit is still on the board, which is
    // the half of this that a blanket withholding would get wrong.
    expect(screen.getByText("Drill-O-Matic")).toBeInTheDocument();
    expect(screen.getByText("Drill-O-Matic Junior")).toBeInTheDocument();
    expect(screen.getByText("Convert-O-Tron 250")).toBeInTheDocument();
    expect(screen.getByText("Starved Converter")).toBeInTheDocument();
    expect(within(statsHeader()).getByText("4")).toBeInTheDocument();
  });

  it("withholds every run state, rate, abundance and derived stall", async () => {
    const { fixture } = renderWidget();
    emitBoth(fixture);
    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();

    dropTheLink(fixture);
    await waitFor(() => expect(visibleText()).toMatch(/no longer current/i));

    // No claim about what any unit is doing, in either direction: "stopped" is
    // as much a statement about now as "running" is.
    expect(screen.queryAllByText("running")).toHaveLength(0);
    expect(screen.queryAllByText("stopped")).toHaveLength(0);
    expect(screen.getAllByText("run state held")).toHaveLength(4);
    // The stall diagnostic is derived from rates and a run flag, so it goes with
    // them rather than accusing a converter of starving some seconds ago.
    expect(screen.queryByText("no output")).not.toBeInTheDocument();
    // Rates read as held back, not as the "unknown" the backend says when it has
    // a recipe and no figure for it.
    expect(screen.queryAllByText("unknown")).toHaveLength(0);
    expect(screen.queryAllByText(NULL_DISPLAY).length).toBeGreaterThan(0);
    expect(visibleText()).not.toContain("0.0037");
  });

  it("withholds the active count and the net EC figure, keeping the stat that is a fact", async () => {
    const { fixture } = renderWidget();
    emitBoth(fixture);
    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();

    dropTheLink(fixture);
    await waitFor(() => expect(visibleText()).toMatch(/no longer current/i));

    const header = statsHeader();
    // "3 active" summed partly from held run flags is a number with no moment
    // attached to it.
    expect(within(header).queryByText("3")).not.toBeInTheDocument();
    expect(within(header).getByText("active")).toBeInTheDocument();
    // WHETHER this vessel moves ElectricCharge is a property of the recipes, so
    // the stat stays mounted while its figure is withheld: dropping the row
    // would say nothing here draws power.
    expect(within(header).getByText("net EC")).toBeInTheDocument();
    expect(visibleText(header)).toContain(NULL_DISPLAY);
    expect(visibleText(header)).not.toContain("30");
  });

  it("does not present the withheld board as a vessel with no ISRU hardware", async () => {
    // The failure mode this file exists to prevent. "No drills or converters on
    // this vessel" is a confident statement about the craft, and reaching it from
    // a dropped link would report an unequipped vessel that is in fact mining.
    const { fixture } = renderWidget();
    emitBoth(fixture);
    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();

    dropTheLink(fixture);
    await waitFor(() => expect(visibleText()).toMatch(/no longer current/i));

    expect(
      screen.queryByText("No drills or converters on this vessel"),
    ).not.toBeInTheDocument();
  });

  it("withholds only the channel that went, and says which one", async () => {
    // The case a transport drop cannot see: the drills stop being current while
    // the converters keep arriving. Hollowing out both would withhold figures
    // that are current.
    const { fixture } = renderWidget();
    emitBoth(fixture);
    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();

    act(() => {
      fixture.emit("isru.drills", DRILLS, { staleness: Staleness.HeldStale });
      fixture.emit("isru.converters", CONVERTERS);
    });

    await waitFor(() =>
      expect(
        screen.getByText("Rates and run state no longer current: drills"),
      ).toBeInTheDocument(),
    );
    // Two drills held, two converters still reporting.
    expect(screen.getAllByText("run state held")).toHaveLength(2);
    expect(screen.getAllByText("running")).toHaveLength(2);
    expect(screen.getByText("no output")).toBeInTheDocument();
    // The converter recipe's own figures are untouched.
    expect(visibleText()).toContain("0.45");
    expect(visibleText()).not.toContain("0.0037");
  });

  it("says nothing about currency before anything has arrived", async () => {
    // A cold start is not a dropped link. Conflating them would accuse the mod of
    // going quiet on every first paint; the widget's pre-existing empty state is
    // what a never-fed mount shows.
    renderWidget();

    expect(
      await screen.findByText("No drills or converters on this vessel"),
    ).toBeInTheDocument();
    expect(visibleText()).not.toMatch(/no longer current/i);
  });
});
