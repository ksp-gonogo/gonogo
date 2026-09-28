import {
  ContributionsProvider,
  DashboardItemContext,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

/** Pins what each telemetry read renders when its value has not arrived, arrived empty, or arrived partial. */

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

const META = {
  componentId: "resource-ops",
  contributionSlots: [],
} as const;

function renderWidget() {
  const fixture = setupStreamFixture({ suspendFrames: true });
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

function statsHeader(): HTMLElement {
  return screen.getByRole("group", { name: "Resource ops summary" });
}

describe("ResourceOps: what undefined means today", () => {
  it("makes no claim about the vessel when nothing has arrived at all", async () => {
    renderWidget();

    expect(await screen.findByText("No ISRU data")).toBeInTheDocument();
    expect(
      screen.queryByText("No drills or converters on this vessel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Resource ops summary" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
    expect(screen.getByText("RESOURCE OPS")).toBeInTheDocument();
  });

  it("tells a vessel confirmed empty apart from one nothing has been heard about", async () => {
    const { fixture } = renderWidget();
    expect(await screen.findByText("No ISRU data")).toBeInTheDocument();

    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", []);
    });

    expect(
      await screen.findByText("No drills or converters on this vessel"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No ISRU data")).not.toBeInTheDocument();
  });

  it("does not answer for a channel that never arrived: one empty channel is not the whole answer", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
    });

    expect(await screen.findByText("No ISRU data")).toBeInTheDocument();
    expect(
      screen.queryByText("No drills or converters on this vessel"),
    ).not.toBeInTheDocument();
  });

  it("omits the net EC stat when the converter channel never arrived, the same as when nothing draws power", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
    });

    await screen.findByText("Drill-O-Matic");
    const header = statsHeader();
    expect(within(header).getByText("2")).toBeInTheDocument();
    expect(within(header).getByText("processes")).toBeInTheDocument();
    expect(within(header).queryByText("net EC")).not.toBeInTheDocument();
  });

  /** An absent rate is an unread one, so a stall diagnosed from it would contradict the "unknown" rate cells. */
  it("does not flag a running converter as starved when its output rates never arrived", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [
        {
          partId: "401",
          partTitle: "Rateless Converter",
          running: true,
          inputs: [{ resource: "Ore" }],
          outputs: [{ resource: "LiquidFuel" }],
        },
      ]);
    });

    expect(await screen.findByText("Rateless Converter")).toBeInTheDocument();
    expect(screen.queryByText("no output")).not.toBeInTheDocument();
    expect(screen.getAllByText("unknown")).toHaveLength(2);
  });

  /** A zero that arrived is a real stall. */
  it("still flags a running converter whose output rates arrived as zero", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [
        {
          partId: "402",
          partTitle: "Stalled Converter",
          running: true,
          inputs: [{ resource: "Ore", rate: 0.5 }],
          outputs: [{ resource: "LiquidFuel", rate: 0 }],
        },
      ]);
    });

    expect(await screen.findByText("Stalled Converter")).toBeInTheDocument();
    expect(screen.getByText("no output")).toBeInTheDocument();
  });

  /** A partial net EC sum understates the draw, so the figure is withheld while the stat stays mounted. */
  it("withholds the net EC figure when one contributing rate never arrived", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [
        {
          partId: "501",
          partTitle: "Readable Converter",
          running: true,
          inputs: [{ resource: "ElectricCharge", rate: 4 }],
          outputs: [{ resource: "LiquidFuel", rate: 0.1 }],
        },
        {
          partId: "502",
          partTitle: "Rateless Converter",
          running: true,
          inputs: [{ resource: "ElectricCharge" }],
          outputs: [{ resource: "Oxidizer", rate: 0.1 }],
        },
      ]);
    });

    await screen.findByText("Readable Converter");
    const header = statsHeader();
    expect(within(header).getByText("net EC")).toBeInTheDocument();
    // "4" would be the readable converter's draw alone.
    expect(within(header).queryByText(/^4/)).not.toBeInTheDocument();
    expect(within(header).getByText("\u2014")).toBeInTheDocument();
  });

  it("states the net EC figure when every contributing rate arrived", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [
        {
          partId: "501",
          partTitle: "Readable Converter",
          running: true,
          inputs: [{ resource: "ElectricCharge", rate: 4 }],
          outputs: [{ resource: "LiquidFuel", rate: 0.1 }],
        },
      ]);
    });

    await screen.findByText("Readable Converter");
    const header = statsHeader();
    expect(within(header).getByText("net EC")).toBeInTheDocument();
    expect(within(header).getByText(/4/)).toBeInTheDocument();
  });

  it("drops the location line while vessel.identity has not arrived", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
    });

    await screen.findByText("Drill-O-Matic");
    expect(within(statsHeader()).queryByText("at")).not.toBeInTheDocument();
  });

  it("names the vessel with no body when system.bodies has not arrived yet", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Prospector One",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 2,
      });
    });

    await screen.findByText("Drill-O-Matic");
    const header = statsHeader();
    expect(within(header).getByText("at")).toBeInTheDocument();
    expect(within(header).getByText("Prospector One")).toBeInTheDocument();
    // The separator only appears when a body name resolved.
    expect(within(header).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("treats a null parentBodyIndex exactly as a missing one", async () => {
    const { fixture } = renderWidget();
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
        parentBodyIndex: null,
      });
    });

    await screen.findByText("Drill-O-Matic");
    const header = statsHeader();
    expect(within(header).getByText("Prospector One")).toBeInTheDocument();
    expect(within(header).queryByText(/Duna/)).not.toBeInTheDocument();
  });

  it("drops the whole location line when the identity record arrived without a name", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
      fixture.emit("system.bodies", {
        bodies: [{ name: "Duna", index: 2, parentIndex: 0, radius: 320000 }],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 2,
      });
    });

    await screen.findByText("Drill-O-Matic");
    const header = statsHeader();
    expect(within(header).queryByText("at")).not.toBeInTheDocument();
    expect(within(header).queryByText(/Duna/)).not.toBeInTheDocument();
  });

  /** "stopped" tells the operator the rig is intact and waiting to be started, so an unread flag must not say it. */
  it("says the run state is unread rather than calling an unreadable rig stopped", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", [
        {
          partId: "103",
          partTitle: "Drill-O-Matic Senior",
          resource: "Ore",
          deployed: true,
          running: null,
          abundance: 0.075,
          rate: null,
        },
      ]);
      fixture.emit("isru.converters", []);
    });

    await screen.findByText("Drill-O-Matic Senior");
    expect(screen.getByText("run state unread")).toBeInTheDocument();
    expect(screen.queryByText("stopped")).not.toBeInTheDocument();
  });
});
