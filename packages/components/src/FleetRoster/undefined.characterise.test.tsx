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

/**
 * Characterisation: what FleetRoster DOES today when its telemetry reads come
 * back `undefined`, recorded before `useTelemetry` starts returning a
 * `Reading`. Every assertion here is an observation, not an endorsement.
 *
 * The absence-sensitive reads, in the order the widget makes them:
 * - `useTelemetry("system.vessels")`, consumed twice and differently:
 *   `system?.vessels ?? []` for the rows, and `known: system !== undefined`
 *   for the empty-state wording. `known` is the ONE site in this widget that
 *   distinguishes `undefined` from `null`
 * - `useTelemetry("system.bodies")` via `bodies?.bodies ?? []`, so an
 *   unarrived bodies topic silently becomes an empty name map
 * - `useTelemetry("commandCentre.roster")` via
 *   `centres?.find(...)?.displayName ?? vantage`
 * - `useFleetVesselSilence(guid)` behind `if (!silence || nowUt == null ...)`
 * - `useFleetVesselLink(guid)` behind `link == null` and `oneWay != null`
 * - per-field: `magnitudeOf(v.crewCount)`, `v.bodyIndex != null`, and
 *   `rosterCommsLink(undefined)`
 */

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
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt });
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

// ---------------------------------------------------------------------------
// 1. Nothing has arrived at all
// ---------------------------------------------------------------------------

describe("FleetRoster: nothing has arrived at all", () => {
  it("says fleet data is not available, renders no table at all, and still asserts a comms rollup of zero", () => {
    const fixture = newFixture();
    renderRoster(fixture);

    // `known === false` is the only reason this copy differs from the
    // confirmed-empty copy below.
    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No vessels tracked.")).toBeNull();

    // `total === 0` sheds the whole table: the column header row goes with it,
    // so none of these labels exist rather than sitting above an empty list.
    expect(screen.queryByText("Vessel")).toBeNull();
    expect(screen.queryByText("Body")).toBeNull();
    expect(screen.queryByText("Crew")).toBeNull();
    expect(screen.queryByText("Link")).toBeNull();

    // The footer meter is NOT gated on `known`, so an un-fed widget publishes
    // a fleet-wide comms verdict of "nothing is linked" beside the sentence
    // saying there is no data. Pinned because the migration reassigns exactly
    // this "no data" case.
    const meter = screen.getByRole("meter", { name: "Comms coverage" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(visibleText()).toContain("0 linked · 0 no link");
    // `commsRollup([])`'s own branch, distinct from "No Link".
    expect(screen.getByText("No Vessels")).toBeInTheDocument();
    expect(screen.queryByText("No Link")).toBeNull();
  });

  it("names the vantage as the raw `ksc` id when no command-centre roster has arrived", () => {
    const fixture = newFixture();
    renderRoster(fixture);

    // `centres?.find(...)?.displayName ?? vantage` falls all the way back to
    // the selection id, so the header presents an internal identifier as a
    // command centre's name with no hint it is a fallback.
    expect(screen.getByText(/viewing from:\s*ksc/i)).toBeInTheDocument();
  });

  it("renders the same not-available state with no TelemetryProvider mounted at all", () => {
    // Every read degrades through its `*Optional` variant rather than
    // throwing, so "no stream in the tree" is indistinguishable from "the
    // stream is mounted and cold".
    const { unmount } = render(
      <DashboardItemContext.Provider value={{ instanceId: "fleet-char" }}>
        <FleetRosterComponent config={{}} id="fleet-char" w={8} h={10} />
      </DashboardItemContext.Provider>,
    );
    unmounts.push(unmount);

    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.getByText(/viewing from:\s*ksc/i)).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });
});

// ---------------------------------------------------------------------------
// 2. The `known` gate, and the one null-vs-undefined distinction
// ---------------------------------------------------------------------------

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

    // The gate's whole purpose: an arrived empty roster is a different
    // sentence from a roster that has never arrived.
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
      // A tombstone: `getStreamSnapshot` hands back `point.payload`, which is
      // `null` here, not `undefined`. So `system !== undefined` is TRUE and
      // `known` stays set, while `null?.vessels ?? []` empties the table.
      fixture.emit("system.vessels", null, { validAt: 100 });
    });

    // This is the null-vs-undefined site, and the widget DOES distinguish
    // them: a tombstone reads as "no vessels tracked", never as pending.
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
      // Partial payload: the record landed, the array inside it did not.
      // `known` reads the RECORD, `vessels` reads the field, so the two
      // disagree and the confident copy wins.
      fixture.emit("system.vessels", {});
    });

    await waitFor(() =>
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Fleet data not available yet.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. system.bodies absent, with a roster present
// ---------------------------------------------------------------------------

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
    // The vessel HAS a `bodyIndex` of 1. An unarrived bodies topic collapses
    // to an empty lookup map, so a resolvable index renders identically to an
    // unresolvable one: waiting is drawn as "there is no body".
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(screen.queryByText("Mun")).toBeNull();

    act(() => {
      fixture.emit("system.bodies", BODIES);
    });
    // The other side of the same gate, so the assertion above is pinning an
    // absence rather than a permanently-missing feature.
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
  });

  it("renders the null placeholder for a bodies entry that arrived without a name", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
      // `b.name != null` skips the entry entirely, so the index stays
      // unmapped and the row falls into the same placeholder as above.
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
      // `v.bodyIndex != null` short-circuits before the lookup. A fully
      // populated bodies map makes no difference.
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

// ---------------------------------------------------------------------------
// 4. Per-row partial payloads
// ---------------------------------------------------------------------------

describe("FleetRoster: partial vessel records", () => {
  it("renders the null placeholder for crew when crewCount is absent, and a bare count when only crewCapacity is", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", {
        vessels: [
          {
            // Neither crew field read this tick: `magnitudeOf(undefined)` is
            // null and `crewLabel` returns the placeholder, never a 0.
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
            // The `crewCount === 0 && crewCapacity == null` branch: a real
            // zero with an unread capacity renders "0", not a zero over a dash.
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
    // Exactly one placeholder in the whole table: the first row's crew cell.
    // Every body cell resolved and every link tier is DIRECT, so nothing else
    // can contribute one.
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
    // `rosterCommsLink(undefined)` hits the `default` arm, which is a real
    // tier rather than a fallback: the tag is the null placeholder and the
    // accessible name says unknown, never "No link".
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Link state unknown" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "No link" })).toBeNull();
    // The rollup does NOT hide the unread vessel: with linked === 0 it takes
    // the "No Link" branch, so one unread vessel reads as a fleet with no
    // comms at all.
    expect(screen.getByText("No Link")).toBeInTheDocument();
    expect(visibleText()).toContain("0 linked · 0 no link · 1 unknown");
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });
});

// ---------------------------------------------------------------------------
// 5. fleet.<guid>.delay absent
// ---------------------------------------------------------------------------

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

describe("FleetRoster: the `link == null` absence gate", () => {
  it("reports the link state as `unknown` and omits the delay row entirely before fleet.<guid>.delay arrives", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    // `link == null ? "unknown"` fires. Note the row's own comms tag still
    // reads DIRECT off `system.vessels`, so the two disagree inside one row.
    expect(visibleText(panel)).toContain("unknown");
    // `oneWay != null` gates the whole Delay term, so there is no label at
    // all rather than a delay of zero or a placeholder.
    expect(visibleText(panel)).not.toContain("Delay");
    expect(visibleText(panel)).not.toContain("round-trip");
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
  });

  it("does not distinguish a delay tombstone from a delay that never arrived", async () => {
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
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));

    act(() => {
      // A confirmed "there is no link record" is written `== null`, the same
      // test the never-arrived case takes, so the panel falls back to exactly
      // the cold-start render.
      fixture.emit("fleet.v-probe.delay", null, { validAt: 100 });
    });

    await waitFor(() => expect(visibleText(panel)).toContain("unknown"));
    expect(visibleText(panel)).not.toContain("Delay");
    expect(visibleText(panel)).not.toContain("round-trip");
  });

  it("reads an absent `connected` field inside an arrived delay record as a confident `no path`", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      // Partial payload: a light-time but no reachability flag.
      // `link.connected` is undefined, and the ternary has no third arm, so
      // an unread field is stated as a confirmed lack of a path.
      fixture.emit("fleet.v-probe.delay", { oneWaySeconds: 4.5 });
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    await waitFor(() => expect(visibleText(panel)).toContain("no path"));
    expect(visibleText(panel)).not.toContain("unknown");
    // The delay half of the same record IS present, so this row simultaneously
    // shows a light-time and claims no path exists.
    expect(visibleText(panel)).toMatch(/round-trip[\s~]*9\s*s/i);
  });

  it("omits the delay row for an arrived record whose oneWaySeconds is absent", async () => {
    const fixture = newFixture();
    renderRoster(fixture);

    act(() => {
      fixture.emit("system.vessels", ONE_CRAFT);
    });
    await screen.findByRole("button", { name: /Explorer signal/i });
    act(() => {
      fixture.emit("fleet.v-probe.delay", { connected: true });
    });

    const panel = await openSignalPanel(/Explorer signal/i);
    // `connected` resolves the Link term while `oneWay != null` still gates
    // the Delay term away: the two fields of one record are read separately.
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));
    expect(visibleText(panel)).not.toContain("Delay");
  });
});

// ---------------------------------------------------------------------------
// 6. silence.<guid>.state absent
// ---------------------------------------------------------------------------

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
    // `if (!silence || ...) return null` renders NOTHING, so a vessel whose
    // silence reckoning has never arrived is presented exactly like a vessel
    // confirmed nominal. Asserted as four named absences rather than an empty
    // container, because the cell renders nothing in the nominal case too.
    expect(screen.queryByText(/no contact/i)).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/reacquire/i)).toBeNull();
    expect(screen.queryByText(/lost/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => {
      fixture.emit("silence.v-probe.state", SILENT);
    });
    // The other side of the gate: the cell CAN render, so the absences above
    // are the gate firing rather than a dead code path.
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
      // `!silence` is falsy for `null` too, so a confirmed "no silence record
      // for this vessel" retracts the badge entirely and is drawn as nominal,
      // identical to the never-arrived render.
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
      // Partial payload: the field is simply absent rather than an explicit
      // null. `predicted == null` covers both, so this is the `waiting` phase
      // and no countdown is invented from the deadline.
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
