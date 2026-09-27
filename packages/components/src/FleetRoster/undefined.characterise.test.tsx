import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { FleetRosterComponent } from "./index";

/** Characterisation, not specification: what FleetRoster renders when its telemetry reads are absent. Every assertion is an observation, not an endorsement. */

const CARRIED = [
  "system.vessels",
  "system.bodies",
  "commandCentre.roster",
  "fleet.",
  "silence.",
];

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
  clearAugments();
});

function newFixture(pinnedUt = 2_000) {
  return setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt,
    suspendFrames: true,
  });
}

function renderRoster(fixture: StreamFixture, size = { w: 8, h: 10 }) {
  const { unmount, container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fleet-char" }}>
        <FleetRosterComponent
          config={{}}
          id="fleet-char"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  unmounts.push(unmount);
  return container;
}

/** One fully-populated craft, so a test can isolate ONE absent read. */
const ONE_CRAFT = {
  vessels: [
    {
      vesselId: "v-probe",
      name: "Explorer",
      vesselType: 3,
      situation: 3,
      bodyIndex: 1,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
    },
  ],
};

const BODIES = { bodies: [{ index: 1, name: "Mun" }] };

describe("FleetRoster: nothing has arrived at all", () => {
  it("says fleet data is not available, renders no table, and draws no comms tally", () => {
    const fixture = newFixture();
    renderRoster(fixture);

    // `known === false` is the only reason this copy differs from the confirmed-empty copy below.
    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No vessels tracked.")).toBeNull();

    // `total === 0` sheds the whole table, column header row included.
    expect(screen.queryByText("Vessel")).toBeNull();
    expect(screen.queryByText("Body")).toBeNull();
    expect(screen.queryByText("Crew")).toBeNull();
    expect(screen.queryByText("Link")).toBeNull();

    // A pending coverage reading draws the meter's absent form: "nobody has said" is not "nothing is linked".
    expect(screen.queryByRole("meter", { name: "Comms coverage" })).toBeNull();
    // A tally of a roster never delivered would say the same thing in words.
    expect(visibleText()).not.toContain("0 linked");
    // `commsRollup([])`'s own branch, distinct from "No Link".
    expect(screen.getByText("No Vessels")).toBeInTheDocument();
    expect(screen.queryByText("No Link")).toBeNull();
  });

  it("names the vantage unknown when nothing was chosen and no frame has said where", () => {
    const fixture = newFixture();
    renderRoster(fixture);

    expect(screen.getByText(/viewing from:\s*unknown/i)).toBeInTheDocument();
  });

  it("renders the same not-available state with no TelemetryProvider mounted at all", () => {
    // Every read degrades through its optional variant, so no stream in the tree is indistinguishable from a cold one.
    const { unmount } = render(
      <DashboardItemContext.Provider value={{ instanceId: "fleet-char" }}>
        <FleetRosterComponent config={{}} id="fleet-char" w={8} h={10} />
      </DashboardItemContext.Provider>,
    );
    unmounts.push(unmount);

    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.getByText(/viewing from:\s*unknown/i)).toBeInTheDocument();
    // No stream is a pending coverage reading, drawn in the absent form.
    expect(screen.queryByRole("meter", { name: "Comms coverage" })).toBeNull();
  });
});

describe("FleetRoster: the `system !== undefined` absence gate", () => {
  it("fires before any roster arrives and stops firing for a confirmed-empty fleet", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();

    act(() => {
      fixture.emit("system.vessels", { vessels: [] });
    });

    // The gate's whole purpose: an arrived empty roster is a different sentence from a roster that has never arrived.
    await waitFor(() =>
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Fleet data not available yet.")).toBeNull();
  });

  it("treats a whole-topic tombstone as a CONFIRMED empty fleet, not as waiting", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await waitFor(() =>
      expect(screen.getByText("Explorer")).toBeInTheDocument(),
    );

    act(() => {
      // A tombstone payload is `null`, not `undefined`, so `known` stays set while the table empties.
      fixture.emit("system.vessels", null, { validAt: 100 });
    });

    // This is the null-vs-undefined site, and the widget DOES distinguish them: a tombstone reads as "no vessels tracked", never as pending.
    await waitFor(() =>
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Fleet data not available yet.")).toBeNull();
    expect(screen.queryByText("Explorer")).toBeNull();
  });

  it("treats an arrived record whose `vessels` field is absent as a confirmed empty fleet too", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      // Partial payload: `known` reads the record and `vessels` the field, so they disagree and the confident copy wins.
      fixture.emit("system.vessels", {});
    });

    await waitFor(() =>
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Fleet data not available yet.")).toBeNull();
  });
});

describe("FleetRoster: the `bodies?.bodies ?? []` absence gate", () => {
  it("renders every Body cell as the null placeholder while system.bodies has not arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });

    await waitFor(() =>
      expect(screen.getByText("Explorer")).toBeInTheDocument(),
    );
    // An unarrived bodies topic is an empty lookup, so a resolvable index renders like an unresolvable one.
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(screen.queryByText("Mun")).toBeNull();

    act(() => {
      fixture.emit("system.bodies", BODIES);
    });
    // The other side of the same gate, so the assertion above is pinning an absence rather than a permanently-missing feature.
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
  });

  it("renders the null placeholder for a bodies entry that arrived without a name", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
      // `b.name != null` skips the entry entirely, so the index stays unmapped and the row falls into the same placeholder as above.
      fixture.emit("system.bodies", { bodies: [{ index: 1 }] });
    });

    await waitFor(() =>
      expect(screen.getByText("Explorer")).toBeInTheDocument(),
    );
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("renders the null placeholder for a vessel whose own bodyIndex is absent", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.bodies", BODIES);
      // `v.bodyIndex != null` short-circuits before the lookup, so a populated bodies map makes no difference.
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-nobody",
            name: "Unplaced Craft",
            vesselType: 3,
            situation: 3,
            crewCount: 0,
            crewCapacity: 0,
            commsControlSource: RosterCommsControlSource.Full,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Unplaced Craft")).toBeInTheDocument(),
    );
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });
});

describe("FleetRoster: partial vessel records", () => {
  it("renders the null placeholder for crew when crewCount is absent, and a bare count when only crewCapacity is", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", {
        vessels: [
          {
            // Neither crew field read this tick: `magnitudeOf(undefined)` is null and `crewLabel` returns the placeholder, never a 0.
            vesselId: "v-unread",
            name: "Unread Crew",
            vesselType: 3,
            situation: 3,
            bodyIndex: 1,
            commsControlSource: RosterCommsControlSource.Full,
          },
          {
            // Count read, capacity not: `String(crewCount)` with no "/n".
            vesselId: "v-nocap",
            name: "No Capacity",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            crewCount: 3,
            commsControlSource: RosterCommsControlSource.Full,
          },
          {
            // The `crewCount === 0 && crewCapacity == null` branch: a real zero with an unread capacity renders "0", not a zero over a dash.
            vesselId: "v-zero",
            name: "Zero Crew",
            vesselType: 3,
            situation: 3,
            bodyIndex: 1,
            crewCount: 0,
            commsControlSource: RosterCommsControlSource.Full,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Unread Crew")).toBeInTheDocument(),
    );
    // Every body resolved and every link DIRECT, so the only placeholder is the first row's crew cell.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(1);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(visibleText()).not.toContain("0/");
  });

  it("reports an absent commsControlSource as the honest `unknown` tier, and counts it as not linked", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-unread-comms",
            name: "Unread Comms",
            vesselType: 3,
            situation: 3,
            bodyIndex: 1,
            crewCount: 0,
            crewCapacity: 0,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Unread Comms")).toBeInTheDocument(),
    );
    // An unread control source is the unknown tier: the null placeholder tag, accessible name "unknown", never "No link".
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Link state unknown" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "No link" })).toBeNull();
    // With linked === 0 the rollup takes the "No Link" branch, so one unread vessel reads as a fleet with no comms.
    expect(screen.getByText("No Link")).toBeInTheDocument();
    expect(visibleText()).toContain("0 linked · 0 no link · 1 unknown");
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });
});

/** Open a row's signal Disclosure and return its panel element. */
async function openSignalPanel(name: RegExp): Promise<HTMLElement> {
  const trigger = await screen.findByRole("button", { name });
  act(() => {
    trigger.click();
  });
  const panel = document.getElementById(
    trigger.getAttribute("aria-controls") ?? "",
  );
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

describe("FleetRoster: the `contact == null` absence gate", () => {
  it("reports the link state as `unknown` and omits the delay row entirely before either fleet.<guid> topic arrives", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    // The row's own comms tag still reads DIRECT off `system.vessels`, so the two disagree inside one row.
    expect(visibleText(panel)).toContain("unknown");
    // `oneWay != null` gates the whole Delay term, so there is no label at all rather than a delay of zero or a placeholder.
    expect(visibleText(panel)).not.toContain("Delay");
    expect(visibleText(panel)).not.toContain("round-trip");
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
  });

  it("does not distinguish a contact tombstone from a contact that never arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("fleet.v-probe.contact", { connected: true });
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));

    act(() => {
      // A confirmed "no contact record" takes the same `== null` test as never-arrived, so the Link term renders the cold-start state.
      fixture.emit("fleet.v-probe.contact", null, { validAt: 100 });
    });

    await waitFor(() => expect(visibleText(panel)).toContain("unknown"));
  });

  it("reads an absent `connected` field inside an arrived contact record as a confident `no path`", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("fleet.v-probe.delay", {
        oneWaySeconds: 4.5,
        connected: true,
      });
      // A contact record with no reachability flag: the ternary has no third arm, so an unread field reads as a confirmed lack of a path.
      fixture.emit("fleet.v-probe.contact", { lastContactUt: 100 });
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    await waitFor(() => expect(visibleText(panel)).toContain("no path"));
    expect(visibleText(panel)).not.toContain("unknown");
    // The light-time from the separate `.delay` record IS present, and reads as what it is: the last measurement before the path closed.
    expect(visibleText(panel)).toContain("Delay (last known)");
    expect(visibleText(panel)).toMatch(/round-trip[\s~]*9\s*s/i);
  });

  it("omits the delay row for a contact-resolved link whose oneWaySeconds never arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("fleet.v-probe.contact", { connected: true });
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    // The Link term resolves off `.contact` while `oneWay != null` still gates the Delay term away: the two topics are read separately.
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));
    expect(visibleText(panel)).not.toContain("Delay");
  });
});

const SILENT = {
  state: "Silent",
  silenceSinceUt: 1_000,
  deadlineUt: 9_000,
  deadlineBasis: "predicted-reacquisition",
  predictedReacquisitionUt: 2_600,
};

describe("FleetRoster: the `!silence` absence gate", () => {
  it("renders no contact badge of any kind before silence.<guid>.state arrives", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });

    await waitFor(() =>
      expect(screen.getByText("Explorer")).toBeInTheDocument(),
    );
    // An unarrived silence reckoning renders nothing, exactly like a confirmed-nominal vessel, so each badge is asserted absent by name.
    expect(screen.queryByText(/no contact/i)).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/reacquire/i)).toBeNull();
    expect(screen.queryByText(/lost/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => {
      fixture.emit("silence.v-probe.state", SILENT);
    });
    // The other side of the gate: the cell CAN render, so the absences above are the gate firing rather than a dead code path.
    await waitFor(() =>
      expect(screen.getByText(/reacquire in/i)).toBeInTheDocument(),
    );
  });

  it("does not distinguish a silence tombstone from a silence that never arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("silence.v-probe.state", SILENT);
    });
    await waitFor(() =>
      expect(screen.getByText(/reacquire in/i)).toBeInTheDocument(),
    );

    act(() => {
      // `!silence` is true for `null` too, so a confirmed "no silence record" is drawn as nominal, like never-arrived.
      fixture.emit("silence.v-probe.state", null, { validAt: 100 });
    });

    await waitFor(() => expect(screen.queryByText(/reacquire/i)).toBeNull());
    expect(screen.queryByText(/no contact/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
  });

  it("reads a silence record with no predicted reacquisition as `no contact`, never as overdue", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      // An absent field and an explicit null both mean `waiting`, so no countdown is invented from the deadline.
      fixture.emit("silence.v-probe.state", {
        state: "Silent",
        silenceSinceUt: 1_000,
        deadlineUt: 9_000,
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/no contact/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/reacquire/i)).toBeNull();
  });
});
