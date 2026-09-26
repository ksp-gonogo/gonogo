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
 * When an `isru.*` channel goes stale the rigs stay drawn and every figure on
 * them is withheld, and each case pairs "the figure is gone" with "the reason
 * is on screen". A single-channel staleness is server-stamped, so that case
 * emits `Staleness.HeldStale` on `isru.drills` rather than dropping the transport.
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
            <ResourceOpsComponent id="resource-ops" w={6} h={8} />
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
    // The control: without it every withheld assertion would pass on a widget that never draws a rate.
    const { fixture } = renderWidget();
    emitBoth(fixture);

    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByText("no output")).toBeInTheDocument();
    expect(screen.queryAllByText("run state held")).toHaveLength(0);
    expect(visibleText()).not.toMatch(/no longer current/i);
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
    // The rigs survive: which units are bolted on only changes on an event.
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

    // "stopped" is as much a statement about now as "running".
    expect(screen.queryAllByText("running")).toHaveLength(0);
    expect(screen.queryAllByText("stopped")).toHaveLength(0);
    expect(screen.getAllByText("run state held")).toHaveLength(4);
    expect(screen.queryByText("no output")).not.toBeInTheDocument();
    // Held back, not the "unknown" the backend sends for a recipe with no figure.
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
    expect(within(header).queryByText("3")).not.toBeInTheDocument();
    expect(within(header).getByText("active")).toBeInTheDocument();
    // Whether the vessel moves ElectricCharge is a recipe fact, so the stat stays mounted.
    expect(within(header).getByText("net EC")).toBeInTheDocument();
    expect(visibleText(header)).toContain(NULL_DISPLAY);
    expect(visibleText(header)).not.toContain("30");
  });

  it("does not present the withheld board as a vessel with no ISRU hardware", async () => {
    // A dropped link must never read as an unequipped vessel.
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
    // Only the drills go stale, so the current converter figures must survive.
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
    expect(screen.getAllByText("run state held")).toHaveLength(2);
    expect(screen.getAllByText("running")).toHaveLength(2);
    expect(screen.getByText("no output")).toBeInTheDocument();
    expect(visibleText()).toContain("0.45");
    expect(visibleText()).not.toContain("0.0037");
  });

  it("says nothing about currency before anything has arrived", async () => {
    // A never-fed mount says it has no ISRU data and accuses nothing.
    renderWidget();

    expect(await screen.findByText("No ISRU data")).toBeInTheDocument();
    expect(visibleText()).not.toMatch(/no longer current/i);
  });
});
