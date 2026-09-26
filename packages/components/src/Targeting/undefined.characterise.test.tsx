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
 * What `undefined` means at every read site downstream of the readings: for
 * `vessel.dock`, "not a docking scenario" (never-arrived and tombstone alike),
 * and inside an observed `vessel.target`, "the producer said nothing about this
 * field". A dock record no longer current is `stale.test.tsx`'s subject.
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
    suspendFrames: true,
  });
}

describe("Targeting: nothing has arrived on either topic", () => {
  it("renders the waiting empty state and none of the three value surfaces", () => {
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);

    // Named specifically: three of the four whole-body branches are absence renderings.
    expect(screen.getByText("Waiting for target telemetry")).toBeTruthy();
    // The confident absence claim is a different branch and must not be here.
    expect(visibleText(container)).not.toContain("No target set in KSP");
    // Neither specialised view can be entered from nothing: both assert something about now.
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    expect(screen.queryByText("APPROACH")).toBeNull();
    // No observation, so no age caption.
    expect(visibleText(container)).not.toMatch(/ago/);
  });
});

describe("Targeting: the vessel.dock absence gate", () => {
  /** An undefined `vessel.dock` means "not a docking scenario", not "waiting"; both tests sit inside HUD range so only the gate keeps the HUD shut. */
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
    // The dock gate costs the reticle, not the numbers.
    expect(screen.getByText("Distance")).toBeTruthy();
    expect(screen.getByText("Closing rate")).toBeTruthy();
  });

  it("treats a vessel.dock tombstone exactly as it treats never-arrived, and drops the HUD", async () => {
    // A dock tombstone renders identically to never-arrived: a HUD that does not open.
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
  /** A missing dock distance or relative velocity is silently answered by the target-derived figure, not a placeholder. */
  it("falls back to the target's distance and closing rate when the dock record omits them", async () => {
    const fixture = dockingFixture();
    const { container } = renderWidget(fixture);
    act(() => {
      // Target-derived figures unlike anything the dock geometry could produce, so they can only come through the fallback.
      fixture.emit("vessel.target", {
        name: "Port Mk2",
        kind: KIND.Vessel,
        relativePosition: atRange(77),
        relativeVelocity: atRange(-0.77),
      });
      // Dock record present with only the reticle geometry.
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
    // The headline is the TARGET's 77 m.
    expect(visibleText(container)).toContain("77.0 m");
    // The Δv row is the target's radial rate.
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
    // α and β are derived off `dock.relativePosition`; γ (roll) is not on the wire.
    expect(visibleText(container)).toContain(`2.9° · -2.1° · ${NULL_DISPLAY}`);
  });
});

describe("Targeting: a partial vessel.target record", () => {
  it("reports a confident absence for an OBSERVED record that carries no name", async () => {
    // A current record with no name renders the confirmed-absence branch: pinned as observed behaviour, not endorsed.
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
    // "confirmed", not "last seen": the arm is `observed`.
    expect(visibleText(container)).toMatch(/confirmed/i);
    // The distance the record DID carry is discarded with it.
    expect(visibleText(container)).not.toContain("1.5 km");
    expect(screen.queryByText("APPROACH")).toBeNull();
  });

  it("renders the display dash and no closing-rate row when the record carries no relative position", async () => {
    // A nameable record with no geometry: the producer said nothing about these fields.
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
    // The headline is the null placeholder at display tier, not a zero and not the waiting state.
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(screen.queryByText("Waiting for target telemetry")).toBeNull();
    // No geometry also blocks the mode effect, so the target never reaches approach or the HUD.
    expect(screen.queryByText("APPROACH")).toBeNull();
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    // No relVel, so the Δv sub-readout is absent rather than placeholdered.
    expect(visibleText(container)).not.toContain("Δv");
  });

  it("renders TCA as the null placeholder when the record carries no closest approach", async () => {
    // No solver output renders the placeholder rather than a T-0 countdown.
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
    // Only the TCA row degrades.
    expect(visibleText(container)).toMatch(/2\.0 km/);
    expect(visibleText(container)).toMatch(/−5\.0 m\/s/);
    // No T± countdown anywhere.
    expect(visibleText(container)).not.toMatch(/T[−+]/);
  });
});
