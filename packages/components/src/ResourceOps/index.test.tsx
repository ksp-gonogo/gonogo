import {
  ContributionsProvider,
  DashboardItemContext,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, fireEvent, render, screen, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

/**
 * Redesign note: processes now render as `Card`s with a tabular
 * resource/rate/direction table (`in`/`out`/`extract`), grouped under a
 * global stats header (process count, active count, net EC draw, and an
 * optional vessel/body "at" line). The cases below are updated for that
 * structure; the underlying claims (shared-fields-only, starved detection,
 * sub-milli rates, filtering) are unchanged.
 */

/**
 * Resource Ops consumes the ONE elected `isru.*` topic pair, so every case below
 * is written against the SHARED shape only. That is the claim the widget makes:
 * a row is complete without reading any provider's extension namespace, so the
 * same frames render identically whichever backend the mod elected.
 *
 * Filtering is delegated to a mounted `FilterList`: the widget bakes each row's
 * `searchText` from shared fields and renders whatever search terms are
 * contributed to its `resource-ops.filters` slot, knowing nothing about what any
 * of them mean.
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
    // No deploy animation on this one: absent, not false.
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
    partTitle: "Convert-O-Tron 125",
    running: true,
    inputs: [{ resource: "Ore", rate: 0.25 }],
    outputs: [{ resource: "Monopropellant", rate: 0 }],
  },
];

// The widget declares no filter slot: the framework auto-aggregates
// `resource-ops.filters` for every widget from this meta's componentId, the
// same way it does the badges slot, so FilterList's terms flow with no
// widget-side declaration.
const META = {
  componentId: "resource-ops",
  contributionSlots: [],
} as const;

// A stand-in for an Uplink's own contributed axis, registered once at module
// load (the registry has no unregister) and gated on a flag so only the test
// that wants it sees it. The term is a plain string, matched as a substring
// against a row's baked searchText.
let uplinkTermOn = false;

registerContribution({
  id: "fixture-uplink-term",
  contributes: "resource-ops.filters",
  compute: () => (uplinkTermOn ? ["Monopropellant"] : []),
});

afterEach(() => {
  uplinkTermOn = false;
});

function renderWidget(carriedChannels: readonly string[] = CARRIED) {
  const fixture = setupStreamFixture({ carriedChannels, suspendFrames: true });
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

/** The global stats header, scoped so a header stat ("30.00") is never
 *  confused with the same number appearing in a card's own resource row. */
async function findStatsHeader(): Promise<HTMLElement> {
  return screen.findByRole("group", { name: "Resource ops summary" });
}

describe("ResourceOps", () => {
  it("lists every drill and converter off the shared fields alone", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    expect(await screen.findByText("Drill-O-Matic")).toBeInTheDocument();
    expect(screen.getByText("Drill-O-Matic Junior")).toBeInTheDocument();
    expect(screen.getByText("Convert-O-Tron 250")).toBeInTheDocument();
    expect(screen.getByText("Convert-O-Tron 125")).toBeInTheDocument();
    // The recipe reads as resources, both sides.
    expect(screen.getByText(/LiquidFuel/)).toBeInTheDocument();
  });

  it("shows everything until the operator narrows it with the search box", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    await screen.findByText("Drill-O-Matic");
    const search = screen.getByLabelText("Search");
    expect(search).toHaveValue("");
    expect(screen.getByText("Convert-O-Tron 250")).toBeInTheDocument();

    // Typing a resource narrows to the units that touch it, drills and
    // converters alike, matched against the searchText the widget baked.
    act(() => {
      fireEvent.change(search, { target: { value: "Monopropellant" } });
    });
    expect(screen.getByText("Convert-O-Tron 125")).toBeInTheDocument();
    expect(screen.queryByText("Convert-O-Tron 250")).not.toBeInTheDocument();
    expect(screen.queryByText("Drill-O-Matic")).not.toBeInTheDocument();
  });

  it("renders a contributed term it knows nothing about, and applies it", async () => {
    // The widget has never heard of this filter: it renders it as a toggle
    // because it arrived on its slot, and narrows by plain substring.
    uplinkTermOn = true;
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    const toggle = await screen.findByRole("button", {
      name: "Monopropellant",
    });
    act(() => {
      fireEvent.click(toggle);
    });

    expect(screen.getByText("Convert-O-Tron 125")).toBeInTheDocument();
    expect(screen.queryByText("Convert-O-Tron 250")).not.toBeInTheDocument();
    expect(screen.queryByText("Drill-O-Matic")).not.toBeInTheDocument();
  });

  it("shows deploy state only when the backend reports one", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
    });

    expect(await screen.findByText("deployed")).toBeInTheDocument();
    // A null deploy state is a harvester with no deploy animation, so it must not
    // render as "retracted", which would be a claim the backend never made.
    expect(screen.queryByText("retracted")).not.toBeInTheDocument();
  });

  it("flags a running converter that is moving nothing", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", CONVERTERS);
    });

    // Exactly one of the two is starved: the derived diagnostic, not a wire field.
    expect(await screen.findAllByText("no output")).toHaveLength(1);
  });

  it("does not flag a consume-and-dump process with no outputs", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      // A scrubber consumes and dumps: an EMPTY output side is its healthy
      // state. `outputs.every(rate === 0)` is vacuously true on [], which is
      // exactly the false positive this case pins down.
      fixture.emit("isru.converters", [
        {
          partId: "301",
          partTitle: "CO2 Scrubber",
          running: true,
          inputs: [
            { resource: "CarbonDioxide", rate: 0.0006 },
            { resource: "ElectricCharge", rate: 0.05 },
          ],
          outputs: [],
        },
      ]);
    });

    expect(await screen.findByText("CO2 Scrubber")).toBeInTheDocument();
    expect(screen.queryByText("no output")).not.toBeInTheDocument();
    // The empty side still reads as a fact, not a blank.
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("shows a sub-milli rate as nonzero rather than 0.000", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      // Life-support rates genuinely sit this low: a recycler at 0.0002
      // units/s is WORKING, and fixed 3 dp rendered it "0.000", a dead-looking
      // reading no operator should have to second-guess.
      fixture.emit("isru.converters", [
        {
          partId: "302",
          partTitle: "Water Recycler",
          running: true,
          inputs: [{ resource: "WasteWater", rate: 0.00025 }],
          outputs: [{ resource: "Water", rate: 0.0002 }],
        },
      ]);
    });

    expect(await screen.findByText("Water Recycler")).toBeInTheDocument();
    expect(screen.getByText(/0\.00020/)).toBeInTheDocument();
    expect(screen.getByText(/0\.00025/)).toBeInTheDocument();
    expect(screen.queryByText(/(^|\s)0\.000(\s|$)/)).not.toBeInTheDocument();
  });

  it("says an empty vessel has no units rather than blaming the stream", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", []);
    });

    expect(
      await screen.findByText(/No drills or converters on this vessel/),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { fixture, container } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    await screen.findByText("Drill-O-Matic");
    await expectNoA11yViolations(container);
  });

  it("shows a global stats header: process count, active count, and net EC draw", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    const header = await findStatsHeader();
    // 2 drills + 2 converters = 4 processes; one drill is stopped, so 3 active.
    expect(within(header).getByText("4")).toBeInTheDocument();
    expect(within(header).getByText("processes")).toBeInTheDocument();
    expect(within(header).getByText("3")).toBeInTheDocument();
    expect(within(header).getByText("active")).toBeInTheDocument();
    // Only Convert-O-Tron 250 (running) touches ElectricCharge, at 30/s in.
    expect(within(header).getByText("net EC")).toBeInTheDocument();
    expect(within(header).getByText(/30\.00/)).toBeInTheDocument();
  });

  it("omits the net EC stat when nothing on the vessel touches ElectricCharge", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      // Neither converter's recipe below ever names ElectricCharge, unlike
      // the shared CONVERTERS fixture: the stat must read as "not
      // applicable", not a fabricated zero draw.
      fixture.emit("isru.converters", [
        {
          partId: "501",
          partTitle: "Ore Processor",
          running: true,
          inputs: [{ resource: "Ore", rate: 0.5 }],
          outputs: [{ resource: "LiquidFuel", rate: 0.4 }],
        },
      ]);
    });

    const header = await findStatsHeader();
    expect(within(header).getByText("processes")).toBeInTheDocument();
    expect(within(header).queryByText("net EC")).not.toBeInTheDocument();
  });

  it("answers 'is this on a vessel, on Duna' with an at-a-glance location line when vessel telemetry is mounted", async () => {
    const { fixture } = renderWidget([
      ...CARRIED,
      "vessel.identity",
      "system.bodies",
    ]);
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
      fixture.emit("system.bodies", {
        bodies: [{ name: "Duna", index: 2, parentIndex: 0, radius: 320000 }],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Prospector One",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 2,
      });
    });

    const header = await findStatsHeader();
    expect(within(header).getByText("at")).toBeInTheDocument();
    expect(
      within(header).getByText(/Prospector One.*Duna/),
    ).toBeInTheDocument();
  });

  it("degrades gracefully with no location line when vessel telemetry is not carried", async () => {
    // The default `renderWidget()` never carries `vessel.identity`/
    // `system.bodies`, mirroring a mount where an Uplink hasn't wired them:
    // the widget's core drill/converter list must render untouched, just
    // without the "at" line, never a stuck-loading state.
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    const header = await findStatsHeader();
    expect(within(header).queryByText("at")).not.toBeInTheDocument();
  });
});
