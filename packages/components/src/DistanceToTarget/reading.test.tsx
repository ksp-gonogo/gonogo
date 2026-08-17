import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DistanceToTargetComponent } from "./index";

/**
 * The `Reading<T>` proof. DistanceToTarget carried the worst defect the
 * absence-gate audit found: `tarName === undefined` rendered **"No target set
 * in KSP"**, a positive claim about game state derived from the absence of a
 * frame. A dropped link said "no target set". `vessel.target` is declared
 * `absenceIsData: true` mod-side (`VesselUplink.cs`), so all four reading
 * states are reachable on the real wire, which is what makes this widget the
 * proof rather than a demonstration.
 */
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

async function mount(instanceId: string, pinnedUt = 10) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.target"],
    pinnedUt,
  });
  // `tar.type` maps to the derived `vessel.state.targetKind`, which is not
  // carried here, so the aux source supplies it exactly as `stream.test.tsx`
  // does. Nothing about the reading path routes through it.
  const legacyAux = await setupMockDataSource({
    id: "data",
    keys: [{ key: "tar.name" }, { key: "tar.type" }],
    connectSource: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <DistanceToTargetComponent id={instanceId} w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, legacyAux, rendered };
}

describe("DistanceToTarget: pending is no longer reported as a confirmed absence", () => {
  it("says it is waiting, not that no target is set, before anything arrives", async () => {
    const { legacyAux } = await mount("dtt-pending");

    // The defect this whole workstream exists to make unrepresentable: the
    // widget used to assert "No target set in KSP" here, from nothing but a
    // missing frame.
    expect(screen.getByText("Waiting for target telemetry")).toBeTruthy();
    expect(screen.queryByText("No target set in KSP")).toBeNull();

    teardownMockDataSource(legacyAux);
  });

  it("says no target is set only once the wire confirms it, and says when", async () => {
    const { fixture, legacyAux } = await mount("dtt-absent", 10);

    act(() => {
      legacyAux.source.emit("tar.name", "Rendezvous Target");
      legacyAux.source.emit("tar.type", "Vessel");
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));

    // Target cleared in KSP: a tombstone for the whole record, which is a
    // confirmed fact about the subject rather than a gap in the link.
    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() =>
      expect(screen.getByText("No target set in KSP")).toBeTruthy(),
    );
    // "Confirmed nothing, as of when". A tombstone can itself go old, and the
    // age is what stops the claim being asserted indefinitely.
    expect(visibleText()).toMatch(/confirmed/i);
    expect(screen.queryByText("10.0 km")).toBeNull();

    teardownMockDataSource(legacyAux);
  });
});

describe("DistanceToTarget: stale renders the last observation as an observation", () => {
  it("keeps the last distance but marks it at-last-contact once the link drops", async () => {
    const { fixture, legacyAux } = await mount("dtt-stale", 10);

    act(() => {
      legacyAux.source.emit("tar.name", "Rendezvous Target");
      legacyAux.source.emit("tar.type", "Vessel");
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));
    // While current, the readout carries no caveat: delay is not staleness, and
    // a caveat on every value would carry no information.
    expect(visibleText()).not.toMatch(/last contact/i);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(visibleText()).toMatch(/last contact/i));
    // The last REAL value stays reachable: it is the same reading, never a
    // second channel the operator has to go and find.
    expect(visibleText()).toContain("10.0 km");
    // And it is not passed off as current.
    expect(screen.queryByText("No target set in KSP")).toBeNull();
    expect(screen.queryByText("Waiting for target telemetry")).toBeNull();

    teardownMockDataSource(legacyAux);
  });

  it("shows no reckoned figure while nothing can honestly model one", async () => {
    const { fixture, legacyAux } = await mount("dtt-noreckon", 10);

    act(() => {
      legacyAux.source.emit("tar.name", "Rendezvous Target");
      legacyAux.source.emit("tar.type", "Vessel");
      fixture.emit("vessel.target", TARGET);
    });
    await waitFor(() => expect(visibleText()).toContain("10.0 km"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() => expect(visibleText()).toMatch(/last contact/i));

    // The reckoning is stubbed, so absence of a reckoned row is the honest
    // rendering. Presence of the row is the statement of trust, so a stub that
    // rendered one would be the exact dishonesty the type exists to prevent.
    expect(visibleText()).not.toMatch(/reckoned/i);

    teardownMockDataSource(legacyAux);
  });

  it("drops out of the docking HUD rather than drawing alignment from stale data", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-hud-stale" }}>
          <DistanceToTargetComponent id="dtt-hud-stale" w={12} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("tar.name", "Docking Port Mk2");
      legacyAux.source.emit("tar.type", "Vessel");
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

    // An alignment reticle drawn from data we know we have missed updates on is
    // the sharpest form of the failure this type exists to prevent: it asserts
    // something about NOW that it cannot know. Fall back to a rendering that
    // can state its own age instead.
    await waitFor(() =>
      expect(
        screen.queryByRole("region", {
          name: "Docking HUD for Docking Port Mk2",
        }),
      ).toBeNull(),
    );
    expect(visibleText()).toMatch(/last contact/i);

    teardownMockDataSource(legacyAux);
  });
});
