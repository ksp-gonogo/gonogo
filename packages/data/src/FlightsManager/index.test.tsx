import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  type ReplayFixture,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import {
  CatalogContact,
  DEFAULT_KEEP_COUNT,
  FlightEndReason,
  Quality,
  Staleness,
} from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { MissionMeta, MissionRecord } from "../storage/MissionStore";
import { MissionStore } from "../storage/MissionStore";
import { resetAutoRecordStatusForTests } from "./autoRecordStatus";
import { FlightsManager } from "./index";
import { MissionHistorySource } from "./MissionHistorySource";

/**
 * Component-level coverage for FlightsManager, previously untested: this
 * is the file that merged two panels' worth of interaction logic (bulk
 * select, keep-latest-N eligibility, star, expand-row wiring, isMain
 * gating for record/replay) with no component test at all. It's also
 * where the review's Finding 2 (a freshly-saved recording never notifying
 * connected stations, see MissionHistorySource.test.ts's "saveMission"
 * coverage) lived: a real registry + real MissionHistorySource, the way
 * this suite is built, is exactly what would have caught it.
 */

function frame(topic: string, payload: unknown, deliveredAt: number): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "stub",
      validAt: deliveredAt,
      seq: 0,
      deliveredAt,
      vantage: "stub",
      quality: Quality.OnRails,
      active: false,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
  };
  return JSON.stringify(message);
}

function smallFixture(): ReplayFixture {
  return {
    subscribedTopics: ["vessel.flight"],
    frames: [frame("vessel.flight", { altitudeAsl: 100 }, 0)],
  };
}

let dbCounter = 0;
let missionCounter = 0;

function freshStore(): MissionStore {
  dbCounter += 1;
  return new MissionStore({ dbName: `flightsmanager-test-${dbCounter}` });
}

async function seedMission(
  store: MissionStore,
  overrides: Partial<MissionMeta> = {},
): Promise<string> {
  missionCounter += 1;
  const id = overrides.id ?? `m${missionCounter}`;
  const meta: MissionMeta = {
    id,
    vesselName: `Vessel ${missionCounter}`,
    launchedAt: 1_000_000 + missionCounter, // ascending, so newest-first sort is deterministic
    firstFrameUt: 0,
    lastFrameUt: 0,
    frameCount: 1,
    ...overrides,
  };
  const record: MissionRecord = { meta, fixture: smallFixture() };
  await store.saveMission(record);
  return id;
}

beforeEach(() => {
  clearRegistry();
  localStorage.clear();
  resetAutoRecordStatusForTests();
});

describe("FlightsManager", () => {
  it("has no accessibility violations with a populated table", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store);
    await seedMission(store);

    const { container } = render(<FlightsManager />);
    await waitFor(() => {
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    });

    await expectNoA11yViolations(container);
  });

  it("shows why each flight ended, and says the end is not known for one that stopped without a reason", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, {
      vesselName: "Crashed One",
      endReason: FlightEndReason.Crashed,
    });
    await seedMission(store, {
      vesselName: "Reverted One",
      endReason: FlightEndReason.Reverted,
    });
    await seedMission(store, { vesselName: "Open One" });

    render(<FlightsManager />);

    const rowOf = async (name: string) =>
      (await screen.findByText(name)).closest("tr") as HTMLElement;
    expect(
      within(await rowOf("Crashed One")).getByText("Crashed"),
    ).toBeTruthy();
    expect(
      within(await rowOf("Reverted One")).getByText("Reverted"),
    ).toBeTruthy();
    const open = within(await rowOf("Open One"));
    expect(open.queryByText("Crashed")).toBeNull();
    expect(open.queryByText("Reverted")).toBeNull();
    expect(open.getByText("Not known")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Ended" })).toBeTruthy();
  });

  it("shows a contract finished during a flight on that flight's row, and none on a flight it did not happen in", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, {
      vesselName: "Flown",
      firstValidUt: 100,
      lastValidUt: 500,
    });
    await seedMission(store, {
      vesselName: "Elsewhere",
      firstValidUt: 1000,
      lastValidUt: 1500,
    });
    await store.saveContractFinish({
      id: "42",
      title: "Orbit Kerbin",
      outcome: "Failed",
      validAt: 300,
      deliveredAt: 310,
    });

    render(<FlightsManager />);

    const rowOf = async (name: string) =>
      (await screen.findByText(name)).closest("tr") as HTMLElement;
    const flown = within(await rowOf("Flown"));
    await waitFor(() => {
      expect(flown.getByText("Orbit Kerbin")).toBeTruthy();
    });
    expect(flown.getByText("failed")).toBeTruthy();
    expect(flown.getByText("SCET")).toBeTruthy();
    expect(flown.getByText("RECEIVED")).toBeTruthy();
    expect(
      within(await rowOf("Elsewhere")).queryByText("Orbit Kerbin"),
    ).toBeNull();
  });

  it("shows a renamed flight under its current name with the launch name as a detail", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, {
      vesselName: "Alpha Two",
      launchName: "Alpha",
    });
    await seedMission(store, { vesselName: "Steady" });

    render(<FlightsManager />);

    const renamed = (await screen.findByText("Alpha Two")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(renamed).getByText("launched as Alpha")).toBeTruthy();
    const steady = (await screen.findByText("Steady")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(steady).queryByText(/launched as/)).toBeNull();
  });

  it("notes the kerbals who went on EVA under the vessel's name", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, {
      vesselName: "Alpha",
      evaKerbals: ["Jebediah Kerman", "Valentina Kerman"],
    });
    await seedMission(store, { vesselName: "Bravo" });

    render(<FlightsManager />);

    const alpha = (await screen.findByText("Alpha")).closest(
      "tr",
    ) as HTMLElement;
    expect(
      within(alpha).getByText("EVA: Jebediah Kerman, Valentina Kerman"),
    ).toBeTruthy();
    const bravo = (await screen.findByText("Bravo")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(bravo).queryByText(/^EVA:/)).toBeNull();
  });

  it("shows a docked flight with the craft it joined", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, {
      vesselName: "Bravo",
      endReason: FlightEndReason.Docked,
      joinedVesselName: "Alpha",
    });

    render(<FlightsManager />);

    const row = (await screen.findByText("Bravo")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Docked with Alpha")).toBeTruthy();
  });

  it("toggles a flight's starred state", async () => {
    const user = userEvent.setup();
    const store = freshStore();
    const source = new MissionHistorySource(store);
    registerDataSource(source);
    await seedMission(store, { vesselName: "Kerbal X" });

    render(<FlightsManager />);
    const starButton = await screen.findByRole("button", {
      name: /star kerbal x/i,
    });
    expect(starButton.getAttribute("aria-pressed")).toBe("false");

    await user.click(starButton);

    await waitFor(async () => {
      const [flight] = await source.listFlights();
      expect(flight.starred).toBe(true);
    });
    const unstarButton = await screen.findByRole("button", {
      name: /unstar kerbal x/i,
    });
    expect(unstarButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("bulk-selects flights and deletes them together", async () => {
    const user = userEvent.setup();
    const store = freshStore();
    const source = new MissionHistorySource(store);
    registerDataSource(source);
    const idA = await seedMission(store, { vesselName: "Alpha" });
    const idB = await seedMission(store, { vesselName: "Bravo" });
    await seedMission(store, { vesselName: "Charlie" });

    render(<FlightsManager />);
    await screen.findByText("Alpha");

    await user.click(
      screen.getByRole("checkbox", { name: /select flight alpha/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /select flight bravo/i }),
    );
    expect(screen.getByText("2 selected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(async () => {
      const remaining = (await source.listFlights()).map((f) => f.id);
      expect(remaining).toEqual([expect.any(String)]);
      expect(remaining).not.toContain(idA);
      expect(remaining).not.toContain(idB);
    });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.getByText("Charlie")).toBeTruthy();
  });

  it("shows the keep-latest eligibility hint once unstarred flights exceed the cap", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    // DEFAULT_KEEP_COUNT (20) unstarred flights are exempt; two more push
    // two over the cap: mirrors pruneFlightsKeepLatest/
    // pruneMissionsKeepLatest exactly (starred is exempt, newest-first).
    for (let i = 0; i < DEFAULT_KEEP_COUNT + 2; i++) {
      await seedMission(store);
    }

    render(<FlightsManager />);

    await waitFor(() => {
      expect(screen.getByText(/2 would be deleted/i)).toBeTruthy();
    });
  });

  it("does not show the eligibility hint when starred flights keep the unstarred count under the cap", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    // 22 total, but 2 are starred (exempt), only 20 unstarred, at the cap, not over it.
    for (let i = 0; i < DEFAULT_KEEP_COUNT; i++) {
      await seedMission(store);
    }
    await seedMission(store, { starred: true });
    await seedMission(store, { starred: true });

    render(<FlightsManager />);
    await waitFor(() => {
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    });

    expect(screen.queryByText(/would be deleted/i)).toBeNull();
  });

  it("expands a row's graph panel and wires it to the mission's data", async () => {
    const user = userEvent.setup();
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, { vesselName: "Graph Me" });

    render(<FlightsManager />);
    await screen.findByText("Graph Me");

    const graphButton = screen.getByRole("button", {
      name: /graph this flight/i,
    });
    expect(graphButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(graphButton);

    expect(graphButton.getAttribute("aria-expanded")).toBe("true");
    // FlightGraph's own placeholder: proves it actually mounted with this row's missionId/firstFrameUt/lastFrameUt wired through.
    expect(
      screen.getByText(/pick one or more numeric telemetry keys/i),
    ).toBeTruthy();

    // Collapsing it again toggles back off.
    await user.click(screen.getByRole("button", { name: /close graph/i }));
    expect(
      screen.queryByText(/pick one or more numeric telemetry keys/i),
    ).toBeNull();
  });

  it("gates the replay control behind isMain, but keeps browsing/star/graph available on a station", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, { vesselName: "Station View" });

    render(<FlightsManager screen="station" />);
    await screen.findByText("Station View");

    // Recording is never a station concern at all now, it's not a button anywhere, main or station (see AutoRecordStatus's own doc comment).
    expect(screen.queryByText(/mission history is off/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /replay station view/i }),
    ).toBeNull();

    // Non-recording, non-replay interactions stay available on a station, per-mission peer RPCs make them work identically there.
    expect(
      screen.getByRole("button", { name: /star station view/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /graph this flight/i }),
    ).toBeTruthy();
  });

  it("shows the auto-record status readout and the replay control on the main screen", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, { vesselName: "Main View" });

    render(<FlightsManager screen="main" />);
    await screen.findByText("Main View");

    // No AutoRecordController mounted in this test, so the status readout shows the "armed" idle state rather than an active recording.
    expect(screen.getByText(/auto-record armed: capture starts/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /replay main view/i }),
    ).toBeTruthy();
  });

  it("hides the auto-record readout's armed state and shows the off hint when mission history is disabled", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedMission(store, { vesselName: "Off View" });

    render(<FlightsManager screen="main" missionHistoryEnabled={false} />);
    await screen.findByText("Off View");

    expect(
      screen.getByText(/mission history is off, enable it in settings/i),
    ).toBeTruthy();
    expect(screen.queryByText(/auto-record armed/i)).toBeNull();
  });
});

describe("FlightsManager: a craft left flying", () => {
  /** A real provider over a stub transport, with the view clock pinned so a manual frame advances it. */
  function stream() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const clock = new ViewClock();
    clock.scrubTo(10);
    const timeline = new TimelineStore(clock);
    function Provider({ children }: { children: ReactNode }) {
      return (
        <TelemetryProvider client={client} store={timeline}>
          {children}
        </TelemetryProvider>
      );
    }
    return {
      Provider,
      listed: (names: string[]) =>
        act(() => {
          transport.emit("trackingStation.catalog", {
            entries: names.map((name) => ({
              vesselId: name,
              name,
              vesselType: 0,
              situation: 3,
              contact: CatalogContact.InContact,
            })),
          });
          timeline.beginFrame();
        }),
    };
  }

  async function seedOrbitC(store: MissionStore) {
    for (let i = 0; i < 4; i += 1) {
      await seedMission(store, { vesselName: "orbit-c", frameCount: 10 });
    }
  }

  it("shows one row, reading still flying, for the several recordings of a craft that has no end", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedOrbitC(store);
    const rig = stream();

    render(
      <rig.Provider>
        <FlightsManager />
      </rig.Provider>,
    );
    rig.listed(["orbit-c"]);

    await waitFor(() => {
      expect(screen.getAllByText("Still flying")).toHaveLength(1);
    });
    expect(screen.getAllByText("orbit-c")).toHaveLength(1);
    // The four recordings' samples are counted once, in that row.
    expect(screen.getAllByText("40")).toHaveLength(1);
  });

  it("keeps a row for each recording while nothing says the craft is still flying", async () => {
    const store = freshStore();
    registerDataSource(new MissionHistorySource(store));
    await seedOrbitC(store);

    render(<FlightsManager />);

    await waitFor(() => {
      expect(screen.getAllByText("orbit-c")).toHaveLength(4);
    });
    expect(screen.queryByText("Still flying")).toBeNull();
  });
});
