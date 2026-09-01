import {
  ContributionsProvider,
  DashboardItemContext,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

/**
 * What `undefined` MEANS at each of this widget's telemetry reads, as the code
 * stands today.
 *
 * Recorded before `useTelemetry` becomes a `Reading` union, because every
 * assertion below rests on a value being falsy or nullish, and a `Reading` is
 * always truthy. Nothing here says the behaviour is right; it says this is the
 * behaviour, so a change to it is visible.
 *
 * The reads and their gates:
 * - `isru.drills` / `isru.converters` → `?? []` (index.tsx:383-384), so a
 *   channel that has never delivered is indistinguishable from a channel that
 *   delivered an empty array
 * - `!anything` (index.tsx:468) turns that into the confident sentence "No
 *   drills or converters on this vessel", a claim about the VESSEL made from
 *   the absence of data
 * - `identity?.parentBodyIndex == null` (index.tsx:429) and
 *   `systemBodies?.bodies ?? []` (index.tsx:430) both fall back to "no body
 *   name", collapsing not-arrived into no-such-thing
 * - `identity?.name ? ... : undefined` (index.tsx:434) drops the whole "at"
 *   line
 */

const CARRIED = ["isru.drills", "isru.converters"];
const CARRIED_WITH_LOCATION = [...CARRIED, "vessel.identity", "system.bodies"];

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

function renderWidget(carriedChannels: readonly string[] = CARRIED) {
  const fixture = setupStreamFixture({ carriedChannels, suspendFrames: true });
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
  it("claims the vessel has no drills or converters when nothing has arrived at all", async () => {
    // Pins the `?? []` + `!anything` pair. Nothing has been emitted, so the
    // widget asserts a fact about the VESSEL ("on this vessel") from the
    // absence of any frame, and the comment above that branch says so
    // explicitly: "An empty list is a fact about the vessel, not a missing
    // backend". Today there is no way for the widget to tell the two apart.
    renderWidget();

    expect(
      await screen.findByText("No drills or converters on this vessel"),
    ).toBeInTheDocument();
    // Specifically NOT rendered on this branch: the stats header and the
    // filter box only exist on the populated branch, so their absence is the
    // rest of what this state looks like.
    expect(
      screen.queryByRole("group", { name: "Resource ops summary" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
    // The panel itself still renders, so the operator sees a titled widget
    // making a confident negative statement rather than a blank tile.
    expect(screen.getByText("RESOURCE OPS")).toBeInTheDocument();
  });

  it("renders the never-arrived case identically to a confirmed empty vessel", async () => {
    // The migration's whole risk in one assertion: these two states are
    // different facts (nothing has been said yet, versus the backend said
    // "none") and today they produce the same pixels.
    renderWidget();
    const beforeAnyFrame = screen.getByText(
      "No drills or converters on this vessel",
    ).textContent;

    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", []);
    });

    const afterEmptyFrames = await screen.findAllByText(
      "No drills or converters on this vessel",
    );
    expect(afterEmptyFrames).toHaveLength(2);
    expect(afterEmptyFrames[1]?.textContent).toBe(beforeAnyFrame);
  });

  it("counts a channel that never arrived as zero processes, so one empty channel is the whole answer", async () => {
    // `converters ?? []`: only `isru.drills` is fed. The empty-vessel branch
    // still fires, because a fed-empty channel plus a never-fed channel sums
    // to zero exactly as two fed-empty channels do.
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
    });

    expect(
      await screen.findByText("No drills or converters on this vessel"),
    ).toBeInTheDocument();
  });

  it("omits the net EC stat when the converter channel never arrived, the same as when nothing draws power", async () => {
    // `netElectricChargeDraw([])` returns null because nothing "touched"
    // ElectricCharge, and the header reads that as not-applicable. With
    // `isru.converters` never delivered, that null is produced by the absence
    // of the channel rather than by the vessel's hardware: the widget omits a
    // power stat it cannot know is inapplicable.
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
    });

    await screen.findByText("Drill-O-Matic");
    const header = statsHeader();
    // Drills alone still count as the whole process list.
    expect(within(header).getByText("2")).toBeInTheDocument();
    expect(within(header).getByText("processes")).toBeInTheDocument();
    expect(within(header).queryByText("net EC")).not.toBeInTheDocument();
  });

  it("flags a running converter as producing nothing when its output rates never arrived", async () => {
    // Partial payload, inside a row. `(flow.rate?.magnitude ?? 0) === 0`
    // coerces an absent rate to a known zero, so a converter whose recipe
    // arrived without rates is diagnosed "no output" and toned as a WARNING,
    // a derived fault claimed from missing data. The same row's rate cell
    // does the opposite in the same render: it prints "unknown".
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
    expect(screen.getByText("no output")).toBeInTheDocument();
    // Two rate cells, one per recipe side, both reading as unknown rather than
    // as the zero the starved diagnostic above just assumed.
    expect(screen.getAllByText("unknown")).toHaveLength(2);
  });

  it("drops the location line while vessel.identity has not arrived", async () => {
    // `identity?.name ? ... : undefined`: carried but unfed, so the "at" line
    // is absent. Absence of the line is the widget's only way of saying "I
    // don't know where this is", and it is the same rendering as "this mount
    // never wires vessel.identity".
    const { fixture } = renderWidget(CARRIED_WITH_LOCATION);
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", []);
    });

    await screen.findByText("Drill-O-Matic");
    expect(within(statsHeader()).queryByText("at")).not.toBeInTheDocument();
  });

  it("names the vessel with no body when system.bodies has not arrived yet", async () => {
    // Partial location: the identity record arrived complete, including a
    // parentBodyIndex, but the body TABLE has not. `systemBodies?.bodies ?? []`
    // makes the lookup miss, so the header reads "at Prospector One" with no
    // body, which is also what a vessel genuinely orbiting nothing would read.
    const { fixture } = renderWidget(CARRIED_WITH_LOCATION);
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
    // The separator only appears when a body name resolved, so its absence is
    // how "body unknown" is spelled.
    expect(within(header).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("treats a null parentBodyIndex exactly as a missing one", async () => {
    // null-versus-undefined: `identity?.parentBodyIndex == null` is a loose
    // comparison, so a CONFIRMED "this vessel has no parent body" (null) and
    // "the field never arrived" (undefined) take the same branch and render
    // the same line. This widget implements no distinction between them.
    const { fixture } = renderWidget(CARRIED_WITH_LOCATION);
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
    // Partial payload, one field deep: the record is present and its
    // parentBodyIndex resolves, but `identity?.name` is undefined so the
    // truthiness gate throws away the body name it already had.
    const { fixture } = renderWidget(CARRIED_WITH_LOCATION);
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
});
