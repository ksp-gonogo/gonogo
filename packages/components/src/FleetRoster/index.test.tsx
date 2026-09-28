import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetRosterComponent } from "./index";

/** FleetRoster runs entirely off the real stream: `system.vessels` for the roster, `system.bodies` for body names. */

const BODIES = {
  bodies: [
    { index: 0, name: "Kerbin" },
    { index: 1, name: "Mun" },
    { index: 2, name: "Duna" },
    { index: 3, name: "Eve" },
  ],
};

const MIXED = {
  vessels: [
    {
      vesselId: "v-station-1",
      name: "Kerbin Station Alpha",
      vesselType: 1,
      situation: 3,
      bodyIndex: 0,
      crewCount: 6,
      crewCapacity: 6,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-probe-mun",
      name: "Munar Relay Probe",
      vesselType: 3,
      situation: 3,
      bodyIndex: 1,
      crewCount: 0,
      crewCapacity: 0,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Partial,
    },
    {
      vesselId: "v-lander-duna",
      name: "Duna Lander Bravo",
      vesselType: 2,
      situation: 0,
      bodyIndex: 2,
      crewCount: 2,
      crewCapacity: 3,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Partial,
    },
    {
      // A real CommNet "no link home": a confirmed ops fact, not an absence.
      vesselId: "v-orbiter-eve",
      name: "Eve Orbiter Charlie",
      vesselType: 0,
      situation: 3,
      bodyIndex: 3,
      crewCount: 1,
      crewCapacity: 1,
      commsConnected: false,
      commsControlSource: RosterCommsControlSource.None,
    },
    {
      // No crew, comms or body fields: the producer could not read this tick. Unknown is not filtered, and must render as unknown, never a fabricated zero or no-link.
      vesselId: "v-unresolved",
      name: "New Contact",
      vesselType: 14,
      situation: 2,
    },
  ],
};

/** Every non-craft `VesselType` the roster must filter out, plus one real craft and one unclassified contact as controls. */
const NON_CRAFT = {
  vessels: [
    {
      vesselId: "v-craft",
      name: "Craft One",
      vesselType: 4, // Rover
      situation: 0,
      bodyIndex: 0,
      crewCount: 1,
      crewCapacity: 1,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-eva",
      name: "Jebediah on EVA",
      vesselType: 7, // EVA
      situation: 5,
    },
    {
      vesselId: "v-flag",
      name: "Flag Planted at KSC",
      vesselType: 8, // Flag
      situation: 0,
    },
    {
      // Debris never gets a CommNetVessel, so omitted comms is its permanent state. Must not render.
      vesselId: "v-debris",
      name: "Stage 2 Debris",
      vesselType: 9, // Debris
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      // Space objects get no CommNetVessel either. Must not render.
      vesselId: "v-asteroid",
      name: "Ast. XC7-142",
      vesselType: 10, // SpaceObject
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      vesselId: "v-sci-controller",
      name: "Deployed Science Controller",
      vesselType: 11, // DeployedScienceController
      situation: 0,
    },
    {
      vesselId: "v-sci-part",
      name: "Deployed Science Part",
      vesselType: 12, // DeployedSciencePart
      situation: 0,
    },
    {
      vesselId: "v-dropped-part",
      name: "Dropped Part",
      vesselType: 13, // DroppedPart
      situation: 0,
    },
    {
      // Unclassified, NOT a confirmed non-craft type - must still render.
      vesselId: "v-unclassified",
      name: "New Contact",
      vesselType: 14, // Unknown
      situation: 2,
    },
  ],
};

const ALL_LINKED = {
  vessels: [
    {
      vesselId: "v-a",
      name: "Station Alpha",
      vesselType: 1,
      situation: 3,
      bodyIndex: 0,
      crewCount: 6,
      crewCapacity: 6,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-b",
      name: "ComSat 1",
      vesselType: 3,
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-c",
      name: "Transfer Vehicle",
      vesselType: 0,
      situation: 3,
      bodyIndex: 0,
      crewCount: 3,
      crewCapacity: 4,
      commsControlSource: RosterCommsControlSource.Partial,
    },
  ],
};

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderRoster(
  fixture: ReturnType<typeof newFixture>,
  size = { w: 8, h: 10 },
) {
  const { unmount, container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
        <FleetRosterComponent
          config={{}}
          id="fleet-test"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
});

describe("FleetRosterComponent", () => {
  it("renders a row per vessel with identity, body, crew and link", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    // One row per vessel.
    expect(screen.getByText("Munar Relay Probe")).toBeInTheDocument();
    expect(screen.getByText("Duna Lander Bravo")).toBeInTheDocument();
    expect(screen.getByText("Eve Orbiter Charlie")).toBeInTheDocument();
    expect(screen.getByText("New Contact")).toBeInTheDocument();
    // Body names resolved via system.bodies; the unresolved contact has none.
    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText("Duna")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
    // The probe's honest 0/0 renders; only the unresolved contact shows the null token for crew.
    expect(visibleText()).toContain("0/0");
    expect(visibleText()).toContain("6/6");
    expect(visibleText()).toContain("2/3");
    expect(visibleText()).toContain("1/1");
    // Null tokens: the unresolved contact's Body cell, Crew cell and "unknown" Link tag, three in total.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(3);
    // Comms link tags: direct / relay / none / unknown.
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
    expect(screen.getAllByText("RELAY")).toHaveLength(2);
    expect(screen.getByText("NONE")).toBeInTheDocument();
  });

  it("shows a control level the producer could not name as unknown, not as no link", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-unnamed-level",
            name: "Unnamed Level Probe",
            vesselType: 0,
            situation: 3,
            bodyIndex: 0,
            crewCount: 0,
            crewCapacity: 0,
            commsConnected: true,
            commsControlSource: RosterCommsControlSource.Unknown,
          },
        ],
      });
    });
    expect(await screen.findByText("Unnamed Level Probe")).toBeInTheDocument();
    expect(screen.queryByText("NONE")).toBeNull();
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(1);
  });

  it("filters non-craft vessel types out of the roster, keeping real craft and one unclassified contact", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", NON_CRAFT);
    });
    await waitFor(() => {
      expect(screen.getByText("Craft One")).toBeInTheDocument();
    });
    // The one truly-unclassified entry still renders (never silently dropped) alongside the real craft.
    expect(screen.getByText("New Contact")).toBeInTheDocument();
    // Every confirmed non-craft type is filtered out entirely.
    expect(screen.queryByText("Jebediah on EVA")).not.toBeInTheDocument();
    expect(screen.queryByText("Flag Planted at KSC")).not.toBeInTheDocument();
    expect(screen.queryByText("Stage 2 Debris")).not.toBeInTheDocument();
    expect(screen.queryByText("Ast. XC7-142")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Deployed Science Controller"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Deployed Science Part")).not.toBeInTheDocument();
    expect(screen.queryByText("Dropped Part")).not.toBeInTheDocument();
  });

  it("rolls the fleet up into a comms-coverage badge and meter, never a health verdict", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    // Two vessels are not linked (1 none + 1 unknown: the orbiter and the unresolved contact) out of five.
    expect(visibleText()).toContain("2 Not Linked");
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "60");
    expect(visibleText()).toMatch(/3 linked/);
    expect(visibleText()).toMatch(/1 no link/);
    expect(visibleText()).toMatch(/1 unknown/);
  });

  it("shows an All Linked badge and a full meter when every vessel has a link", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", ALL_LINKED);
    });
    await waitFor(() => {
      expect(screen.getByText("Station Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("All Linked")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders a bound fleet-roster.updates augment per vessel row, carrying identity", async () => {
    registerAugment<"fleet-roster.updates">({
      id: "test-fleet-update",
      augments: "fleet-roster.updates",
      component: ({ vesselId }) => (
        <span data-testid="fleet-update" data-vessel={vesselId} />
      ),
    });

    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", ALL_LINKED);
    });

    const updates = await screen.findAllByTestId("fleet-update");
    expect(updates).toHaveLength(3);
    expect(updates.map((u) => u.dataset.vessel)).toEqual(["v-a", "v-b", "v-c"]);
  });

  it("shows a genuinely-empty state once a real empty roster has arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", { vessels: [] });
    });
    await waitFor(() => {
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument();
    });
  });

  it("shows a not-available state before any roster has ever arrived, distinct from a genuinely empty fleet", () => {
    const fixture = newFixture();
    renderRoster(fixture);
    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No vessels tracked.")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const container = renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    await expectNoA11yViolations(container);
  });

  const ONE_PROBE = {
    vessels: [
      {
        vesselId: "v-probe",
        name: "Explorer",
        vesselType: 1,
        situation: 3,
        bodyIndex: 0,
        crewCount: 0,
        crewCapacity: 0,
        commsConnected: true,
        commsControlSource: RosterCommsControlSource.Full,
      },
    ],
  };

  /** A silent craft with no prediction reads "no contact", never "overdue", and going overdue is not being declared lost. */
  async function renderWithContact(silence: Record<string, unknown>) {
    const fixture = setupStreamFixture({
      pinnedUt: 2_000,
      suspendFrames: true,
    });
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", ONE_PROBE);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("silence.v-probe.state", silence);
    });
    return fixture;
  }

  const SILENT = {
    state: "Silent",
    silenceSinceUt: 1_000,
    deadlineUt: 9_000,
    deadlineBasis: "predicted-reacquisition",
    predictedReacquisitionUt: 2_600,
  };

  it("counts down to a predicted reacquisition", async () => {
    await renderWithContact(SILENT);

    // Pinned UT 2000, predicted 2600: 10 minutes out. `Unit` splits number and symbol into separate nodes, so the badge's textContent is asserted.
    const badge = await screen.findByText(/reacquire in/i);
    expect(badge.textContent).toContain("10min");
  });

  it("announces an overdue vessel politely, and does not call it lost", async () => {
    await renderWithContact({ ...SILENT, predictedReacquisitionUt: 1_800 });

    const overdue = await screen.findByText(/overdue by/i);
    // Pinned UT 2000, predicted 1800: 200s late.
    expect(overdue.textContent).toContain("3min 20s");
    expect(overdue.closest("[role='status']")).not.toBeNull();
    expect(screen.queryByText(/lost/i)).toBeNull();
  });

  it("announces a declared loss assertively", async () => {
    await renderWithContact({ ...SILENT, state: "Lost" });

    const lost = await screen.findByText(/lost/i);
    expect(lost.closest("[role='alert']")).not.toBeNull();
  });

  it("shows no countdown for a silence geometry cannot explain", async () => {
    await renderWithContact({
      ...SILENT,
      deadlineBasis: "no-occultation",
      predictedReacquisitionUt: null,
    });

    expect(await screen.findByText(/no contact/i)).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/reacquire/i)).toBeNull();
  });

  it("shows a per-vessel signal disclosure with the round-trip delay", async () => {
    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderRoster(fixture);
    // The row and its `.delay` subscription mount only once system.vessels arrives, so the delay is emitted after the row renders.
    act(() => {
      fixture.emit("system.vessels", ONE_PROBE);
    });
    const trigger = await screen.findByRole("button", {
      name: /Explorer signal/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    act(() => {
      fixture.emit("fleet.v-probe.delay", {
        oneWaySeconds: 4.5,
        connected: true,
      });
    });
    act(() => {
      trigger.click();
    });
    // A bare getByRole("group") is ambiguous (the panel header nests a `<details>`), so scope via the trigger's aria-controls.
    await waitFor(() => {
      const panel = document.getElementById(
        trigger.getAttribute("aria-controls") ?? "",
      );
      expect(panel).not.toBeNull();
      expect(visibleText(panel as HTMLElement)).toMatch(
        /round-trip[\s~]*9\s*s/i,
      );
    });
  });

  /** The last `.delay` payload before a blackout still claims `connected: true`; the Link row must read the freeze-exempt `.contact`. */
  const BLACKED_OUT_PROBE = {
    vessels: [
      {
        ...ONE_PROBE.vessels[0],
        commsConnected: false,
        commsControlSource: RosterCommsControlSource.None,
      },
    ],
  };

  function openSignalDisclosure(trigger: HTMLElement): HTMLElement {
    const panel = document.getElementById(
      trigger.getAttribute("aria-controls") ?? "",
    );
    expect(panel).not.toBeNull();
    return panel as HTMLElement;
  }

  /** One term's value in the signal disclosure, asked of the `<dd>` beside a named `<dt>`: the panel's concatenated text has no word boundaries to anchor a regex. */
  function definitionFor(panel: HTMLElement, term: RegExp): string {
    const dt = Array.from(panel.querySelectorAll("dt")).find((el) =>
      term.test(el.textContent ?? ""),
    );
    return dt?.parentElement?.querySelector("dd")?.textContent ?? "";
  }

  async function renderBlackout() {
    const fixture = setupStreamFixture({
      pinnedUt: 2_000,
      suspendFrames: true,
    });
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", BLACKED_OUT_PROBE);
    });
    const trigger = await screen.findByRole("button", {
      name: /Explorer signal/i,
    });
    // The frozen pre-blackout .delay frame: what a real client is still holding, claiming a live link.
    act(() => {
      fixture.emit("fleet.v-probe.delay", {
        oneWaySeconds: 4.5,
        connected: true,
      });
    });
    // The freeze-exempt .contact frame, which does get through.
    act(() => {
      fixture.emit("fleet.v-probe.contact", {
        connected: false,
        lastContactUt: 1_200,
      });
    });
    act(() => {
      trigger.click();
    });
    await waitFor(() => expect(openSignalDisclosure(trigger)).not.toBeNull());
    return { fixture, trigger };
  }

  it("does not call a blacked-out link connected, whatever the frozen delay frame says", async () => {
    const { trigger } = await renderBlackout();

    // The row's own chip already reads NONE off live `system.vessels`; the cell must not contradict it one line below.
    expect(screen.getByText("NONE")).toBeInTheDocument();
    await waitFor(() => {
      expect(definitionFor(openSignalDisclosure(trigger), /^Link$/)).toMatch(
        /no path/i,
      );
    });
    expect(definitionFor(openSignalDisclosure(trigger), /^Link$/)).not.toMatch(
      /connected/i,
    );
  });

  it("marks a light-time held over from before a blackout as last known, not current", async () => {
    const { trigger } = await renderBlackout();

    // The last measured light-time is still worth showing, but must not read as a live measurement of a link that is down.
    await waitFor(() => {
      expect(visibleText(openSignalDisclosure(trigger))).toMatch(/last known/i);
    });
    expect(visibleText(openSignalDisclosure(trigger))).toMatch(
      /round-trip[\s~]*9\s*s/i,
    );
  });

  it("reports an unarrived contact as unknown rather than trusting the delay frame", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 2_000,
      suspendFrames: true,
    });
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", ONE_PROBE);
    });
    const trigger = await screen.findByRole("button", {
      name: /Explorer signal/i,
    });
    act(() => {
      fixture.emit("fleet.v-probe.delay", {
        oneWaySeconds: 4.5,
        connected: true,
      });
    });
    act(() => {
      trigger.click();
    });
    await waitFor(() => {
      expect(visibleText(openSignalDisclosure(trigger))).toMatch(/round-trip/i);
    });
    // `.delay`'s own `connected` is the field the freeze makes unreliable, so it is never the source of the Link row, not even as a fallback.
    expect(definitionFor(openSignalDisclosure(trigger), /^Link$/)).toBe(
      "unknown",
    );
  });

  it("has no accessible violations with a delay disclosure open", async () => {
    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const container = renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", ONE_PROBE);
    });
    const trigger = await screen.findByRole("button", {
      name: /Explorer signal/i,
    });
    act(() => {
      fixture.emit("fleet.v-probe.delay", {
        oneWaySeconds: 4.5,
        connected: true,
      });
    });
    act(() => {
      trigger.click();
    });
    // A bare getByRole("group") is ambiguous (the panel header nests a `<details>`), so scope via the trigger's aria-controls.
    await waitFor(() => {
      const panel = document.getElementById(
        trigger.getAttribute("aria-controls") ?? "",
      );
      expect(panel).not.toBeNull();
      expect(visibleText(panel as HTMLElement)).toMatch(
        /round-trip[\s~]*9\s*s/i,
      );
    });
    await expectNoA11yViolations(container);
  });

  it("reflects the selected command-source vantage in the header", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", ALL_LINKED);
      fixture.emit(
        "commandCentre.roster",
        [
          {
            id: "ground:Kerbal Space Center",
            displayName: "KSC",
            active: true,
            isHome: true,
          },
        ],
        { vantage: "ground:Kerbal Space Center" },
      );
    });
    // The header names whose light-time the per-vessel delays ride: the centre the frames are stamped with, since nothing was chosen, resolved to its display name.
    await waitFor(() =>
      expect(screen.getByText(/viewing from:\s*KSC/i)).toBeInTheDocument(),
    );
  });
});
