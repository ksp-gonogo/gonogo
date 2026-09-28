import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { clearReckoners, registerReckoner } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { registerCoreReckoners } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * The `TopicReading<T>` proof: `vessel.target` is `absenceIsData`, so all four
 * reading states are reachable on the real wire, and a missing frame must never
 * render as "No target set in KSP".
 */
/*
 * The reckoner registry is module-level, so each test starts from core's own
 * models alone rather than inheriting one an earlier test registered.
 */
beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

afterEach(() => {
  clearActionHandlers();
});

const TARGET = {
  name: "Rendezvous Target",
  kind: 0,
  vesselId: "target-vessel",
  bodyIndex: null,
  // |(6000, 0, 8000)| = 10 000 m; radial rate = 500000 / 10000 = 50, opening.
  relativePosition: { x: 6000, y: 0, z: 8000 },
  relativeVelocity: { x: 30, y: 0, z: 40 },
};

function mount(instanceId: string, pinnedUt = 10) {
  const fixture = setupStreamFixture({
    pinnedUt,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <TargetingComponent id={instanceId} w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, rendered };
}

describe("Targeting: pending is no longer reported as a confirmed absence", () => {
  it("says it is waiting, not that no target is set, before anything arrives", async () => {
    mount("dtt-pending");

    // A missing frame must never assert "No target set in KSP".
    expect(screen.getByText("Waiting for target telemetry")).toBeTruthy();
    expect(screen.queryByText("No target set in KSP")).toBeNull();
  });

  it("says no target is set only once the wire confirms it, without dating the absence", async () => {
    const { fixture } = mount("dtt-absent", 10);

    act(() => {
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));

    // A tombstone is a confirmed fact about the subject, not a gap in the link.
    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() =>
      expect(screen.getByText("No target set in KSP")).toBeTruthy(),
    );
    // Time is only shown through Unit, and an absence has no figure to carry it.
    expect(visibleText()).not.toMatch(/confirmed|last seen|\bago\b/i);
    expect(screen.queryByText("10.0 km")).toBeNull();
  });
});

describe("Targeting: stale renders the last observation as an observation", () => {
  it("keeps the last distance, marked held by Unit rather than captioned, once the link drops", async () => {
    const { fixture } = mount("dtt-stale", 10);

    act(() => {
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));
    // While current there is no mark: delay is not staleness.
    expect(document.querySelector("[data-held]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(visibleText()).not.toMatch(/last contact/i);
    // The last real value stays reachable on the same reading.
    expect(visibleText()).toContain("10.0 km");
    // The mark is on each derived FIGURE, asserted by which carry one, since a count would pass with one reverted.
    const marked = [...document.querySelectorAll("[data-held]")].map(
      // Whitespace normalised: `Unit` uses a thin space.
      (el) => (el.textContent ?? "").replace(/\s+/g, " "),
    );
    expect(marked.some((text) => text.includes("10.0 km"))).toBe(true);
    expect(marked.some((text) => text.includes("50.00 m/s"))).toBe(true);
    // And it is not passed off as current.
    expect(screen.queryByText("No target set in KSP")).toBeNull();
    expect(screen.queryByText("Waiting for target telemetry")).toBeNull();
  });

  it("shows no reckoned figure while nothing can honestly model one", async () => {
    clearReckoners();
    const { fixture } = mount("dtt-noreckon", 10);

    act(() => {
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );

    // No model is registered for the topic, so no reckoned row: presence of the row is the statement of trust.
    expect(visibleText()).not.toMatch(/reckoned/i);
  });

  it("renders the modelled range beside the observation once a model exists", async () => {
    // With a model available, the widget renders BOTH the observation with its age and the model with its basis.
    registerReckoner(
      "vessel.target",
      // A non-core owner, so the election prefers it over core's own model.
      "targeting",
      {
        deps: [],
        reckon: () => ({
          // Covers the payload ROOT, which is what a whole-topic read needs.
          modelled: [{ path: "", basis: "linear-dead-reckoning" }],
          // 12 km, visibly different from the observed 10 km; a reckoner returns the decoded payload shape.
          reckon: () => ({
            relativePosition: {
              x: value("m", 7200),
              y: value("m", 0),
              z: value("m", 9600),
            },
          }),
        }),
      },
    );

    const { fixture } = mount("dtt-reckon", 10);
    act(() => {
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(visibleText()).toMatch(/reckoned/i));
    // Both, side by side: the observation, and the model named so trust can be calibrated.
    expect(visibleText()).toContain("10.0 km");
    expect(visibleText()).toContain("12.0 km");
    expect(visibleText()).toContain("linear-dead-reckoning");
    expect(document.querySelector("[data-held]")).not.toBeNull();
  });

  it("drops out of the docking HUD rather than drawing alignment from stale data", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-hud-stale" }}>
          <TargetingComponent id="dtt-hud-stale" w={12} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.target", {
        name: "Docking Port Mk2",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 62 },
        relativeVelocity: { x: 0, y: 0, z: -0.4 },
      });
      fixture.emit("vessel.dock", {
        relativePosition: { x: 2, y: -1.5, z: 40 },
        relativeVelocity: { x: 0, y: 0, z: -0.40078 },
        distance: 62,
        forwardDot: 0.9999,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", {
          name: "Docking HUD for Docking Port Mk2",
        }),
      ).toBeTruthy(),
    );

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // An alignment reticle from data known to be missing updates asserts something about NOW it cannot know.
    await waitFor(() =>
      expect(
        screen.queryByRole("region", {
          name: "Docking HUD for Docking Port Mk2",
        }),
      ).toBeNull(),
    );
    expect(document.querySelector("[data-held]")).not.toBeNull();
  });
});
