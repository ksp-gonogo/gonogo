import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * Characterisation of what `undefined` MEANS at every read site in this widget,
 * recorded before `useTelemetry` starts returning a `Reading`.
 *
 * `vessel.target` already reads as a `Reading` here, and its four arms are
 * pinned in `reading.test.tsx`. What is NOT pinned, and is what the migration
 * moves, is everything downstream of a read that is still a bare payload:
 *
 * - `vessel.dock` is still `useTelemetry`, and every consumer of it gates on
 *   `undefined`. Those gates carry a MEANING ("this is not a docking
 *   scenario"), not a currency question, and after the migration a `Reading` is
 *   always truthy so each one silently stops gating
 * - the field-level gates inside an OBSERVED `vessel.target` record, where the
 *   record arrived and a field did not. Those are a third meaning again: the
 *   producer had nothing to say about this field
 *
 * Every assertion here records observed behaviour. Two of them pin renders that
 * are arguably wrong (a named absence claim from a nameless record, a tombstone
 * read as a non-scenario); they are here so the change shows up when someone
 * fixes them.
 *
 * `vessel.dock` has since migrated too, and every assertion below still holds: its
 * geometry now reaches the widget through `judgeable`, which answers `undefined`
 * for a never-arrived record and for a tombstone exactly as the old bare read did.
 * What it also answers `undefined` for is a record that stopped being current, and
 * that case is NOT characterised here because it was unreachable before the
 * migration: `stale.test.tsx` covers it.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

/** Vec3 purely along z, so `|relativePosition|` (the mode driver) === `d`. */
function atRange(d: number) {
  return { x: 0, y: 0, z: d };
}

const KIND = { Vessel: 0, CelestialBody: 1 } as const;

function renderWidget(
  fixture: StreamFixture,
  props: { id?: string; w?: number; h?: number } = {},
) {
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider
        value={{ instanceId: props.id ?? "dtt-c" }}
      >
        <TargetingComponent
          id={props.id ?? "dtt-c"}
          w={props.w ?? 12}
          h={props.h ?? 10}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(view.unmount);
  return view;
}

function dockingFixture() {
  return setupStreamFixture({
    carriedChannels: ["vessel.target", "vessel.dock"],
    pinnedUt: 1000,
  });
}

describe("Targeting: nothing has arrived on either topic", () => {
  it("renders the waiting empty state and none of the three value surfaces", () => {
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);

    // Named specifically rather than asserting an empty container: this widget
    // has four whole-body branches and three of them are absence renderings, so
    // "renders nothing" would pass against any of them.
    expect(screen.getByText("Waiting for target telemetry")).toBeTruthy();
    // The confident absence claim is a DIFFERENT branch and must not be here.
    expect(visibleText(container)).not.toContain("No target set in KSP");
    // Neither specialised view can be entered from nothing: both assert
    // something about now.
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    expect(screen.queryByText("APPROACH")).toBeNull();
    // And no age caption: there is no observation for an age to be measured
    // from, so `readingAge` answers undefined and the caption is skipped.
    expect(visibleText(container)).not.toMatch(/ago/);
  });
});

describe("Targeting: the vessel.dock absence gate", () => {
  /**
   * `dockingAvailable = dockRelPos !== undefined` is the gate. `undefined` on
   * `vessel.dock` means "the mod is not publishing a dock channel, so this is
   * not a docking scenario", NOT "waiting". The widget is deliberately inside
   * HUD range in both tests below, so only the gate keeps it out.
   */
  it("stays in the approach view at HUD range while vessel.dock has never arrived", async () => {
    const fixture = dockingFixture();
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Free Flyer",
        kind: KIND.Vessel,
        relativePosition: atRange(60),
        relativeVelocity: atRange(-0.5),
      });
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    // 60 m is well inside HUD_ENTER_M (100), so distance alone would promote.
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    // The approach view still renders every row it can: the dock gate costs the
    // reticle, not the numbers.
    expect(screen.getByText("Distance")).toBeTruthy();
    expect(screen.getByText("Closing rate")).toBeTruthy();
  });

  it("treats a vessel.dock tombstone exactly as it treats never-arrived, and drops the HUD", async () => {
    // null vs undefined: the store means `null` = the subject confirms there is
    // no dock scenario, `undefined` = nothing has arrived. This widget implements
    // NEITHER distinction, deliberately and still: the two reach it as `absent`
    // and `pending`, both answer `undefined` through `judgeable`, and the only
    // visible consequence either way is a HUD that does not open, so the
    // tombstone below produces the identical render to the never-arrived case
    // above.
    const fixture = dockingFixture();
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Port Mk2",
        kind: KIND.Vessel,
        relativePosition: atRange(60),
        relativeVelocity: atRange(-0.5),
      });
      fixture.emit("vessel.dock", {
        relativePosition: atRange(60),
        relativeVelocity: atRange(-0.5),
        distance: 60,
        forwardDot: 0.999,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Port Mk2/ }),
      ).toBeTruthy(),
    );

    act(() => {
      fixture.emit("vessel.dock", null);
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });
});

describe("Targeting: a partial vessel.dock record", () => {
  /**
   * These pin the `??` fallbacks. `dock.distance` and `dock.relativeVelocity`
   * each fall back to the vessel-to-vessel figure derived off `vessel.target`
   * when absent, so a missing dock field is silently answered by a DIFFERENT
   * quantity rather than by a placeholder.
   */
  it("falls back to the target's distance and closing rate when the dock record omits them", async () => {
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);
    act(() => {
      // Target-derived figures, deliberately unlike anything the dock record
      // could produce from its own geometry (|(2,-1.5,40)| is ~40, not 77), so
      // the numbers below can only have come through the fallback.
      fixture.emit("vessel.target", {
        name: "Port Mk2",
        kind: KIND.Vessel,
        relativePosition: atRange(77),
        relativeVelocity: atRange(-0.77),
      });
      // Dock record present (so the HUD opens) but carrying only the geometry
      // the reticle needs: no `distance`, no `relativeVelocity`.
      fixture.emit("vessel.dock", {
        relativePosition: { x: 2, y: -1.5, z: 40 },
        forwardDot: 0.9999,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Port Mk2/ }),
      ).toBeTruthy(),
    );
    // `dockDistanceStream ?? tarDistance`: the headline is the TARGET's 77 m,
    // not a placeholder, even though the dock channel said nothing about range.
    expect(visibleText(container)).toContain("77.0 m");
    // `derivedDockRelVel ?? relVel`: the Δv row is the target's radial rate.
    expect(visibleText(container)).toContain("-0.77 m/s");
  });

  it("renders the alignment row from derived angles when forwardDot is absent, with roll always null", async () => {
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Port Mk2",
        kind: KIND.Vessel,
        relativePosition: atRange(62),
        relativeVelocity: atRange(-0.4),
      });
      fixture.emit("vessel.dock", {
        relativePosition: { x: 2, y: -1.5, z: 40 },
        relativeVelocity: atRange(-0.4),
        distance: 62,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Port Mk2/ }),
      ).toBeTruthy(),
    );
    // α and β are derived client-side off `dock.relativePosition`, so they
    // survive `forwardDot` being absent. γ (roll) is not on the wire at all and
    // is the widget's own permanent `undefined`, hard-coded rather than read.
    expect(visibleText(container)).toContain(`2.9° · -2.1° · ${NULL_DISPLAY}`);
  });
});

describe("Targeting: a partial vessel.target record", () => {
  it("reports a confident absence for an OBSERVED record that carries no name", async () => {
    // The belt-and-braces `|| tarName === undefined` arm, which survives
    // alongside the `absent` arm. A record DID arrive and is current, so the
    // reading is `observed`, and the widget nonetheless renders the
    // confirmed-absence branch: "No target set in KSP, confirmed N ago", from a
    // frame that only failed to carry a name. Pinned as observed behaviour, not
    // endorsed.
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        kind: KIND.Vessel,
        relativePosition: atRange(1500),
        relativeVelocity: atRange(-3.4),
      });
    });

    await waitFor(() =>
      expect(screen.getByText("No target set in KSP")).toBeTruthy(),
    );
    // "confirmed", not "last seen": the arm is `observed`, so the widget states
    // the absence in the present tense.
    expect(visibleText(container)).toMatch(/confirmed/i);
    // The distance the record DID carry is discarded with it.
    expect(visibleText(container)).not.toContain("1.5 km");
    expect(screen.queryByText("APPROACH")).toBeNull();
  });

  it("renders the display dash and no closing-rate row when the record carries no relative position", async () => {
    // The record is whole enough to be a target (it has a name) but carries no
    // geometry, so `tarDistance` and `relVel` are both undefined. This is the
    // "producer said nothing about this field" meaning, distinct from both
    // never-arrived and tombstoned.
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture, { w: 6, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Geometry-Free Station",
        kind: KIND.Vessel,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Geometry-Free Station")).toBeTruthy(),
    );
    // Tracking mode: the headline is the null-display placeholder at the value's
    // own display tier, NOT a zero and NOT the waiting empty state.
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(screen.queryByText("Waiting for target telemetry")).toBeNull();
    // `tarDistance === undefined` also blocks the mode effect outright, so a
    // nameable Vessel target never reaches approach or the HUD without geometry.
    expect(screen.queryByText("APPROACH")).toBeNull();
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    // `showSubReadout` gates on relVel, so the Δv sub-readout is absent
    // entirely rather than rendered as a placeholder.
    expect(visibleText(container)).not.toContain("Δv");
  });

  it("renders TCA as the null placeholder when the record carries no closest approach", async () => {
    // `magnitudeOf(target?.closestApproach?.time)` is undefined for a record
    // with no solver output, and the approach view converts that to `null` and
    // renders the placeholder rather than a T-0 countdown.
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture, { w: 6, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Rendezvous Target",
        kind: KIND.Vessel,
        relativePosition: atRange(2000),
        relativeVelocity: atRange(-5),
      });
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    expect(screen.getByText("TCA")).toBeTruthy();
    // The rows that DO have data still render, so this is the TCA row alone
    // degrading rather than the view.
    expect(visibleText(container)).toMatch(/2\.0 km/);
    expect(visibleText(container)).toMatch(/−5\.0 m\/s/);
    // No countdown anywhere: `Countdown` renders a T± string, and its absence is
    // what says the placeholder took its place.
    expect(visibleText(container)).not.toMatch(/T[−+]/);
  });
});
