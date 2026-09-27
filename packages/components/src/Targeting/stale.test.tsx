import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * `vessel.dock` alone stops being current while `vessel.target` keeps
 * arriving. With a model the reticle draws from reckoned geometry under a
 * caption naming the basis; without one it is withheld and says so. The
 * assertions are on the stated reason in both cases, never on the absence. Emits stamp
 * `Staleness.HeldStale` on the dock point, the wire shape for one channel not
 * being current.
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
  it("carries the alignment forward and captions it, while the approach numbers keep coming", async () => {
    const { fixture, emitTarget } = mountAtDockingRange();

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Docking HUD for Port Mk2" }),
      ).toBeTruthy(),
    );
    // The notice cannot be on screen while the alignment is current.
    expect(visibleText()).not.toMatch(/withheld/i);

    act(() => {
      // Same geometry, now held-stale; the target keeps arriving.
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

    // The reticle stays, drawn from the reckoned separation, and the caption says it is modelled.
    await waitFor(() =>
      expect(screen.getByText(/Alignment reckoned/)).toBeTruthy(),
    );
    expect(visibleText()).toContain("linear-dead-reckoning");
    expect(visibleText()).toMatch(/last seen .+ ago/);
    // A modelled reticle is not a withheld one: two opposite captions on one instrument is worse than either.
    expect(visibleText()).not.toMatch(/withheld/i);
    expect(visibleText()).toContain("α/β/γ");
  });

  it("withholds the reticle, and says why, once the model declines too", async () => {
    // With no model on offer there is nothing left to draw an attitude from.
    const { fixture, emitTarget } = mountAtDockingRange();

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Docking HUD for Port Mk2" }),
      ).toBeTruthy(),
    );

    act(() => {
      // No closing velocity, so the dead reckoner has no rate and declines.
      fixture.emit(
        "vessel.dock",
        {
          relativePosition: { x: 2, y: -1.5, z: 40 },
          distance: 62,
          forwardDot: 0.9999,
        },
        { validAt: PINNED_UT - 8, staleness: Staleness.HeldStale },
      );
      emitTarget(PINNED_UT);
    });

    // Withheld, not frozen.
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull(),
    );
    // The reason is named, so withheld reads differently from broken, and time is left to Unit.
    expect(screen.getByText("Docking alignment withheld")).toBeTruthy();
    expect(visibleText()).not.toMatch(/last seen|\bago\b|no longer current/i);
    // The alignment row goes with the HUD rather than lingering as placeholders.
    expect(visibleText()).not.toContain("α/β/γ");

    // The target-derived figures keep being drawn: one instrument withheld, not the widget giving up.
    expect(screen.getByText("APPROACH")).toBeTruthy();
    expect(visibleText()).toContain("62.0 m");
    expect(visibleText()).toMatch(/−0\.4 m\/s/);
  });

  it("blames nothing when the pairing is genuinely gone rather than not current", async () => {
    // A tombstone means the pairing is genuinely gone, with nothing to caption; staleness is about the link.
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
    expect(visibleText()).not.toMatch(/withheld/i);
  });
});
