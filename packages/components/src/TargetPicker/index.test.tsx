import {
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

/**
 * TargetPicker's Suggested + categorised UX, driven entirely by the
 * `target.available` channel (`useTelemetry("target.available")`: the
 * CANONICAL one-arg Topic read, which has no legacy fallback at all, so
 * every test here needs a real `TelemetryProvider` mounted, unlike the old
 * Bodies-tree/Vessels-roster/Current-tab widget this replaces). Set/clear
 * dispatch (delayed-command-ux migration) rides the same stream via
 * `useCommand`, asserted against `fixture.transport.sentCommands`.
 */
function renderPicker(
  fixture: StreamFixture,
  opts: { w?: number; h?: number; instanceId?: string } = {},
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider
        value={{ instanceId: opts.instanceId ?? "tp" }}
      >
        <TargetPickerComponent
          id={opts.instanceId ?? "tp"}
          w={opts.w ?? 10}
          h={opts.h ?? 14}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

function emitAvailable(
  fixture: StreamFixture,
  entries: readonly Record<string, unknown>[],
) {
  act(() => {
    fixture.emit("target.available", { entries });
  });
}

/** One body, two vessels (one a hidden-by-default SpaceObject), one docking
 * port: enough to exercise Suggested composition, per-category sort, the
 * asteroid toggle, and all three dispatch kinds in one fixture. */
const KERBIN = {
  kind: 1, // Body
  name: "Kerbin",
  bodyIndex: 1,
  distance: 500,
  isCurrent: false,
};
const MUN = {
  kind: 1,
  name: "Mun",
  bodyIndex: 2,
  distance: 2000,
  isCurrent: false,
};
const MINMUS = {
  kind: 1,
  name: "Minmus",
  bodyIndex: 3,
  distance: 50_000,
  isCurrent: false,
};
const RELAY_ONE = {
  kind: 0, // Vessel
  name: "Relay One",
  vesselId: "vessel-relay-1",
  vesselType: 6, // Relay
  situation: 3, // Orbiting
  distance: 1000,
  isCurrent: false,
};
const RELAY_TWO = {
  kind: 0,
  name: "Relay Two",
  vesselId: "vessel-relay-2",
  vesselType: 6,
  situation: 3,
  distance: 2000,
  isCurrent: false,
};
const RELAY_THREE = {
  kind: 0,
  name: "Relay Three",
  vesselId: "vessel-relay-3",
  vesselType: 6,
  situation: 3,
  distance: 5000,
  isCurrent: false,
};
const ASTEROID = {
  kind: 0,
  name: "Ast. UQR-118",
  vesselId: "vessel-asteroid-1",
  vesselType: 10, // SpaceObject: closer than every vessel above, hidden by default
  situation: 3,
  distance: 10,
  isCurrent: false,
};
const PORT_ALPHA = {
  kind: 4, // Part
  name: "Port Alpha",
  vesselId: "vessel-relay-1",
  partId: 11,
  vesselType: 6,
  distance: 800,
  isCurrent: false,
};
const PORT_BETA = {
  kind: 4,
  name: "Port Beta",
  vesselId: "vessel-relay-2",
  partId: 22,
  vesselType: 6,
  distance: 1500,
  isCurrent: false,
};

const FULL_ENTRIES = [
  MINMUS,
  KERBIN,
  MUN,
  RELAY_THREE,
  RELAY_ONE,
  RELAY_TWO,
  ASTEROID,
  PORT_BETA,
  PORT_ALPHA,
];

describe("TargetPickerComponent: Suggested + categorised list", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({ carriedChannels: [], pinnedUt: 0 });
  });

  it("shows a waiting hint before target.available arrives", () => {
    renderPicker(fixture);
    expect(screen.getByText(/Waiting for target list/i)).toBeInTheDocument();
  });

  it("shows a no-targets hint for an empty entries list", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, []);
    await screen.findByText(/No targets in range/i);
  });

  // T1: a modded ITargetable surfaces as TargetKind.Other (2), and any kind the
  // consumer doesn't recognise (e.g. Position = 3) must degrade gracefully too,
  // both bucket into an "Other" section rather than falling into no list and
  // rendering invisibly, and carry a distance (kind-agnostic, Jon's explicit
  // requirement).
  it("buckets Other / unknown-kind targetables into an 'Other' section with distance (T1)", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, [
      KERBIN,
      {
        kind: 2,
        name: "Deployed Ground Station",
        distance: 340,
        isCurrent: true,
      },
      { kind: 3, name: "Flag Marker", distance: 12_000, isCurrent: false },
    ]);

    // The Other category section appears (2 entries), previously an Other/
    // unknown-kind entry landed in no list and was invisible.
    await screen.findByRole("button", { name: /^Other/ });
    expect(screen.getByText("Deployed Ground Station")).toBeInTheDocument();
    expect(screen.getByText("Flag Marker")).toBeInTheDocument();
    // Distance is populated + shown for the Other bucket, same as every other
    // category.
    expect(visibleText()).toMatch(/340\.0\s*m/);
  });

  it("builds Suggested from the 2 closest bodies + 2 closest vessels + all parts, hidden SpaceObject excluded", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    await screen.findByText("Suggested");
    const suggestedSection = screen.getByText("Suggested")
      .parentElement as HTMLElement;
    const names = within(suggestedSection)
      .getAllByRole("button")
      .map((el) => el.textContent);

    // 2 closest bodies (Kerbin 500, Mun 2000, Minmus 50000 excluded),
    // 2 closest vessels (Relay One 1000, Relay Two 2000, the asteroid at
    // distance 10 is closer than both but hidden by default so it's
    // excluded from "closest", and Relay Three 5000 doesn't make the cut),
    // then ALL parts regardless of distance (Port Alpha, Port Beta).
    expect(names).toHaveLength(6);
    expect(names[0]).toMatch(/Kerbin/);
    expect(names[1]).toMatch(/Mun/);
    expect(names[2]).toMatch(/Relay One/);
    expect(names[3]).toMatch(/Relay Two/);
    expect(names[4]).toMatch(/Port Alpha/);
    expect(names[5]).toMatch(/Port Beta/);
    expect(screen.queryByText(/Ast\. UQR-118/)).not.toBeInTheDocument();
  });

  it("sorts each category by ascending distance", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    const bodiesToggle = await screen.findByRole("button", {
      name: /^Bodies/,
    });
    const bodiesPanelId = bodiesToggle.getAttribute("aria-controls");
    expect(bodiesPanelId).toBeTruthy();
    const bodiesPanel = document.getElementById(bodiesPanelId as string);
    const bodyNames = within(bodiesPanel as HTMLElement)
      .getAllByRole("button")
      .map((el) => el.textContent);
    expect(bodyNames[0]).toMatch(/Kerbin/);
    expect(bodyNames[1]).toMatch(/Mun/);
    expect(bodyNames[2]).toMatch(/Minmus/);

    const vesselsToggle = screen.getByRole("button", { name: /^Vessels/ });
    const vesselsPanelId = vesselsToggle.getAttribute("aria-controls");
    const vesselsPanel = document.getElementById(vesselsPanelId as string);
    const vesselNames = within(vesselsPanel as HTMLElement)
      .getAllByRole("button")
      .map((el) => el.textContent);
    // Asteroid hidden by default: only the three Relay vessels, closest first.
    expect(vesselNames).toEqual([
      expect.stringContaining("Relay One"),
      expect.stringContaining("Relay Two"),
      expect.stringContaining("Relay Three"),
    ]);
  });

  it("omits a category section entirely when it has no entries", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, [KERBIN]);
    await screen.findByRole("button", { name: /^Bodies/ });
    expect(
      screen.queryByRole("button", { name: /^Vessels/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Parts/ }),
    ).not.toBeInTheDocument();
  });

  it("collapses a category via its disclosure button", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    const bodiesToggle = await screen.findByRole("button", {
      name: /^Bodies/,
    });
    expect(bodiesToggle).toHaveAttribute("aria-expanded", "true");
    const panelId = bodiesToggle.getAttribute("aria-controls") as string;
    expect(document.getElementById(panelId)).not.toBeNull();

    await user.click(bodiesToggle);
    expect(bodiesToggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(panelId)).toBeNull();
  });

  it("hides SpaceObject vessels by default and reveals them via the toggle", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    // Scoped to the Vessels category panel: once revealed, the asteroid
    // (distance 10) is also the globally closest vessel, so it legitimately
    // appears a SECOND time in Suggested too; scoping avoids that collision.
    const vesselsToggle = await screen.findByRole("button", {
      name: /^Vessels/,
    });
    const panelId = vesselsToggle.getAttribute("aria-controls") as string;
    expect(
      within(document.getElementById(panelId) as HTMLElement).queryByText(
        /Ast\. UQR-118/,
      ),
    ).not.toBeInTheDocument();
    const spaceObjectToggle = screen.getByRole("button", {
      name: /Asteroids: hidden \(1\)/,
    });

    await user.click(spaceObjectToggle);
    expect(
      screen.getByRole("button", { name: /Asteroids: shown \(1\)/ }),
    ).toBeInTheDocument();
    expect(
      within(document.getElementById(panelId) as HTMLElement).getByText(
        /Ast\. UQR-118/,
      ),
    ).toBeInTheDocument();
  });

  it("filters rows across every section by name, case-insensitive", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    await screen.findByRole("button", { name: /^Bodies/ });
    const filterInput = screen.getByLabelText("Filter targets");
    await user.type(filterInput, "relay one");

    expect(screen.queryByRole("button", { name: /^Bodies/ })).toBeNull();
    expect(screen.queryByText(/Relay Two/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Relay One/).length).toBeGreaterThan(0);
  });

  it("shows a no-match hint when the filter excludes every entry", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    await screen.findByRole("button", { name: /^Bodies/ });
    const filterInput = screen.getByLabelText("Filter targets");
    await user.type(filterInput, "nonexistent-zzz");

    expect(screen.getByText(/No targets match/i)).toBeInTheDocument();
  });

  it("dispatches vessel.target.set with the Body kind and bodyIndex on a Body row", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    // Kerbin appears both in Suggested and in the Bodies category, either
    // instance dispatches identically, so the first match is fine.
    const rows = await screen.findAllByRole("button", { name: /^Kerbin/ });
    await user.click(rows[0]);
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.target.set",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ kind: 1, bodyIndex: 1 });
    });
  });

  it("dispatches vessel.target.set with the Vessel kind and vesselId on a Vessel row", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    // Relay Three only appears in the Vessels category, not Suggested,
    // proves the category (not just Suggested) rows dispatch correctly.
    const row = await screen.findByRole("button", { name: /Relay Three/ });
    await user.click(row);
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.target.set",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ kind: 0, vesselId: "vessel-relay-3" });
    });
  });

  it("dispatches vessel.target.set with the Part kind, vesselId and partId on a Part row", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, FULL_ENTRIES);

    // Port Alpha appears both in Suggested (parts are always ALL included)
    // and in the Parts category: either instance dispatches identically.
    const rows = await screen.findAllByRole("button", { name: /Port Alpha/ });
    await user.click(rows[0]);
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.target.set",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({
        kind: 4,
        vesselId: "vessel-relay-1",
        partId: 11,
      });
    });
  });

  it("marks the current target with a TARGET tag", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, [KERBIN, { ...MUN, isCurrent: true }, RELAY_ONE]);
    // Mun appears in both Suggested and the Bodies category (only 2 bodies
    // total, both fit in "2 closest"): both instances carry the tag.
    const rows = await screen.findAllByRole("button", { name: /^Mun/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText("TARGET")).toBeInTheDocument();
    }
  });

  it("renders current target details and clears via vessel.target.clear", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    act(() => {
      // producer-consumer-T4: tarType/tarDistance/tarRelVel now derive
      // NATIVELY off `vessel.target` alone (kind/relativePosition/
      // relativeVelocity): no `vessel.state` emission (no
      // `vessel.orbit`/`vessel.flight` inputs) needed to unblock them, unlike
      // before the fix. kind: 0 -> targetKind "Vessel". relativePosition
      // magnitude 1500 -> targetDistance; dot(relPos, relVel)/|relPos| ==
      // -2.5 -> closing.
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
        relativeVelocity: { x: -2.5, y: 0, z: 0 },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("Test Station").length).toBeGreaterThan(0);
      expect(screen.getByText("Vessel")).toBeInTheDocument();
      expect(visibleText()).toContain("1.5 km");
      expect(visibleText()).toContain("Δv -2.50 m/s");
    });

    await user.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.target.clear",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toBeNull();
    });
  });

  it("producer-consumer-T4: current-target kind/distance/Δv render off vessel.target's kind/Part TargetKind, with no vessel.state emission at all", async () => {
    renderPicker(fixture);
    act(() => {
      // kind: 4 -> Part (a docking port) -> targetKindLabel "Docking Port".
      // No `vessel.orbit`/`vessel.flight`/any `vessel.state` input is emitted
      // anywhere in this test: proves the derived `vessel.state` channel is
      // no longer a dependency of the current-target detail readout.
      fixture.emit("vessel.target", {
        name: "Port Alpha",
        kind: 4,
        relativePosition: { x: 30, y: 40, z: 0 },
        relativeVelocity: { x: 0, y: 0, z: 1 },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Docking Port")).toBeInTheDocument();
      // |relativePosition| = hypot(30,40,0) = 50 m.
      expect(visibleText()).toContain("50.0 m");
    });
  });

  it("shows a no-target hint when nothing is targeted", () => {
    renderPicker(fixture);
    expect(screen.getByText(/No target set in KSP/i)).toBeInTheDocument();
  });

  it("treats a cleared target as no target in compact mode", () => {
    // Replaces a test that emitted the string "No Target Selected." and asserted
    // the widget hid it. That was Telemachus's sentinel for a null target, and no
    // producer can generate it: `KspHost.BuildTarget` returns null before `name`
    // is ever read, and `vessel.target` is declared `absenceIsData`, so a cleared
    // target arrives as the tombstone below. The old test asserted behaviour
    // against synthetic input, and the translator it was protecting is deleted.
    renderPicker(fixture, { w: 3, h: 4 });
    act(() => {
      fixture.emit("vessel.target", null);
    });
    expect(screen.getByText(/No target set/i)).toBeInTheDocument();
  });

  it("has no axe violations with a populated list and a current target", async () => {
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("vessel.target", { name: "Relay One", kind: 0 });
    });
    emitAvailable(fixture, [
      KERBIN,
      MUN,
      { ...RELAY_ONE, isCurrent: true },
      PORT_ALPHA,
    ]);
    await screen.findByRole("button", { name: /^Bodies/ });
    await expectNoA11yViolations(container);
  });
});

describe("TargetPicker: augment slots (Uplink architecture spec §4)", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({ carriedChannels: [], pinnedUt: 0 });
  });

  it("exposes the two host slots empty by default (no augment DOM)", () => {
    renderPicker(fixture);
    // Neither slot has a bound augment, so nothing extra renders, the frame is
    // unchanged from before the slots existed. Registry-side, both are exposable.
    expect(getAugmentsForSlot("target-picker.sections")).toHaveLength(0);
    expect(getAugmentsForSlot("target-picker.badges")).toHaveLength(0);
    expect(screen.queryByText("FLEET FILTER")).toBeNull();
    expect(screen.queryByText("LINK")).toBeNull();
  });

  it("renders an augment bound to the body sections slot", () => {
    registerAugment({
      id: "test-fleet-filter",
      augments: "target-picker.sections",
      component: () => <div>FLEET FILTER</div>,
    });
    renderPicker(fixture);
    expect(
      getAugmentsForSlot("target-picker.sections").map((a) => a.id),
    ).toEqual(["test-fleet-filter"]);
    expect(screen.getByText("FLEET FILTER")).toBeInTheDocument();
  });

  it("renders an augment bound to the header badges slot", () => {
    registerAugment({
      id: "test-badge",
      augments: "target-picker.badges",
      component: () => <span>LINK</span>,
    });
    renderPicker(fixture);
    expect(getAugmentsForSlot("target-picker.badges").map((a) => a.id)).toEqual(
      ["test-badge"],
    );
    expect(screen.getByText("LINK")).toBeInTheDocument();
  });
});
