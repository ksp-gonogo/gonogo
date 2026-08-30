import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * The withholding of the docking alignment, asserted from outside the component.
 *
 * `reading.test.tsx` already covers the whole link going quiet, where the TARGET
 * reading is what drops the HUD and the tracking panel states its own age. This
 * file covers the case that reading cannot see: `vessel.dock` alone stops being
 * current while `vessel.target` keeps arriving. The geometry on the dock record
 * is a judgement (a reticle, an alignment angle) and is withheld, and a withheld
 * reticle is invisible: the HUD's absence looks identical to a target that
 * stopped being a docking port. So the assertions here are on the stated REASON,
 * not on the absence.
 *
 * A per-topic staleness is server-stamped rather than transport-wide, which is
 * why these emit `Staleness.HeldStale` on the dock point instead of dropping the
 * transport: that is the wire shape for "this specific channel is not current".
 */
afterEach(() => {
  clearActionHandlers();
});

/** Vec3 purely along z, so `|relativePosition|` (the mode driver) === `d`. */
function atRange(d: number) {
  return { x: 0, y: 0, z: d };
}

const VESSEL_KIND = 0;
const PINNED_UT = 1000;
/** Both topics' first observation, 10 s of UT behind the pinned view time. */
const OBSERVED_AT = PINNED_UT - 10;

function mountAtDockingRange() {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.target", "vessel.dock"],
    pinnedUt: PINNED_UT,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "dtt-dock-stale" }}>
        <TargetingComponent id="dtt-dock-stale" w={12} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );

  const emitTarget = (validAt: number) =>
    fixture.emit(
      "vessel.target",
      {
        name: "Port Mk2",
        kind: VESSEL_KIND,
        relativePosition: atRange(62),
        relativeVelocity: atRange(-0.4),
      },
      { validAt },
    );

  act(() => {
    emitTarget(OBSERVED_AT);
    fixture.emit(
      "vessel.dock",
      {
        relativePosition: { x: 2, y: -1.5, z: 40 },
        relativeVelocity: atRange(-0.4),
        distance: 62,
        forwardDot: 0.9999,
      },
      { validAt: OBSERVED_AT },
    );
  });

  return { fixture, emitTarget };
}

describe("Targeting: the dock channel alone stops being current", () => {
  it("withholds the alignment reticle and says why, while the approach numbers keep coming", async () => {
    const { fixture, emitTarget } = mountAtDockingRange();

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Docking HUD for Port Mk2" }),
      ).toBeTruthy(),
    );
    // The notice must carry information, so it cannot be on screen while the
    // alignment is current.
    expect(visibleText()).not.toMatch(/no longer current/i);

    act(() => {
      // Same geometry, now stamped as held-stale: the channel is not being
      // updated, and the numbers on it are the ones the mod last managed to
      // send. The target keeps arriving, so this is the dock channel alone.
      fixture.emit(
        "vessel.dock",
        {
          relativePosition: { x: 2, y: -1.5, z: 40 },
          relativeVelocity: atRange(-0.4),
          distance: 62,
          forwardDot: 0.9999,
        },
        { validAt: PINNED_UT - 8, staleness: Staleness.HeldStale },
      );
      emitTarget(PINNED_UT);
    });

    // Withheld, not frozen: an alignment reticle drawn from data we know we have
    // missed updates on asserts an attitude it cannot know.
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull(),
    );
    // And the operator can tell withheld from broken from out here, which is the
    // whole point: the reason is named and dated.
    expect(
      screen.getByText(/Docking alignment no longer current/),
    ).toBeTruthy();
    expect(visibleText()).toMatch(/last seen .+ ago/);
    // The alignment row itself is gone with the HUD rather than lingering as
    // placeholders that look like a partial record.
    expect(visibleText()).not.toContain("α/β/γ");

    // Still a working widget: the target-derived figures are current and keep
    // being drawn, so this is one instrument withheld rather than the widget
    // giving up. A render that failed outright would pass the assertions above.
    expect(screen.getByText("APPROACH")).toBeTruthy();
    expect(visibleText()).toContain("62.0 m");
    expect(visibleText()).toMatch(/−0\.4 m\/s/);
  });

  it("blames nothing when the pairing is genuinely gone rather than not current", async () => {
    // The distinction the notice exists for. A tombstone means the pairing is
    // genuinely gone (the operator deselected the port, or our side lost its
    // free one), and that is a fact about the craft with no reason to caption.
    // Staleness is a fact about the link. Same missing HUD, different statement.
    const { fixture, emitTarget } = mountAtDockingRange();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Docking HUD for Port Mk2" }),
      ).toBeTruthy(),
    );

    act(() => {
      fixture.emit("vessel.dock", null, { validAt: PINNED_UT });
      emitTarget(PINNED_UT);
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    expect(visibleText()).not.toMatch(/no longer current/i);
  });
});
