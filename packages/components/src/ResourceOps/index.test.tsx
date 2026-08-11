import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

/**
 * Resource Ops consumes the ONE elected `isru.*` topic pair, so every case below
 * is written against the SHARED shape only. That is the claim the widget makes:
 * a row is complete without reading any provider's extension namespace, so the
 * same frames render identically whichever backend the mod elected.
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

function renderWidget() {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED });
  const utils = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "resource-ops" }}>
        <ResourceOpsComponent w={6} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...utils };
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

    // The recipe reads as resources, both sides. Scoped to the converters
    // section because the resource filter's own options carry the same names.
    const converters = screen.getByRole("region", { name: "Converters" });
    expect(within(converters).getByText(/LiquidFuel/)).toBeInTheDocument();
    expect(within(converters).getByText(/ElectricCharge/)).toBeInTheDocument();
  });

  // The filter exists because a backend that models life support with the same
  // module a chemical plant uses reports both here, so the list can get long. It
  // filters by RESOURCE, the one axis the wire genuinely has: gonogo does not
  // offer a "hide life support" preset, because that would mean asserting a
  // category no engine draws.
  it("shows everything until the operator narrows it", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    const filter = await screen.findByLabelText("Resource");
    expect(filter).toHaveValue("__all__");
    expect(screen.getByText("Drill-O-Matic")).toBeInTheDocument();
    expect(screen.getByText("Convert-O-Tron 250")).toBeInTheDocument();
  });

  it("narrows to the units that handle one resource, drills and converters alike", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });

    const filter = await screen.findByLabelText("Resource");
    act(() => {
      fireEvent.change(filter, { target: { value: "Monopropellant" } });
    });

    // Only the converter whose recipe names it survives, on either side.
    expect(screen.getByText("Convert-O-Tron 125")).toBeInTheDocument();
    expect(screen.queryByText("Convert-O-Tron 250")).not.toBeInTheDocument();
    // And the ore drills go, because they handle a different resource.
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

    expect(await axe(container)).toHaveNoViolations();
  });
});
