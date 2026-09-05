import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { clearReckoners, registerReckoner } from "@ksp-gonogo/sitrep-client";
import { type TopicPayload, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * The `Reading<T>` proof. Targeting carried the worst defect the
 * absence-gate audit found: `tarName === undefined` rendered **"No target set
 * in KSP"**, a positive claim about game state derived from the absence of a
 * frame. A dropped link said "no target set". `vessel.target` is declared
 * `absenceIsData: true` mod-side (`VesselUplink.cs`), so all four reading
 * states are reachable on the real wire, which is what makes this widget the
 * proof rather than a demonstration.
 */
afterEach(() => {
  clearActionHandlers();
  // The reckoner registry is module-level, so a test that registers one must
  // clear it or the widget keeps a model in every later test in the file.
  clearReckoners();
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
    suspendFrames: true,
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
        <TargetingComponent id={instanceId} w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, legacyAux, rendered };
}

describe("Targeting: pending is no longer reported as a confirmed absence", () => {
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

// A describe block asserting that KSP's "No Target Selected." sentinel rendered
// as a confirmed absence was DELETED here, and its premise was wrong rather than
// merely obsolete. I wrote it yesterday off the recorded fixture, calling the
// sentinel a third encoding of absence that the wire could produce. It cannot:
// `KspHost.BuildTarget` returns null before `name` is read, and `vessel.target`
// is declared `absenceIsData`, so the only thing a cleared target produces is the
// tombstone the test above already covers. The string belonged to the legacy
// data source, which was retired in 806e7fe2.
//
// So the fixture that taught me the "lesson" was itself preserving a dead
// producer's vocabulary, which is the trap in miniature: a fixture is not
// evidence that a shape exists on the wire, and I read one as current twice in
// two days.
describe("Targeting: stale renders the last observation as an observation", () => {
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

  it("renders the modelled range beside the observation once a model exists", async () => {
    // The `reckoning: "available"` axis end to end. The shipped reckoner
    // declines (nothing can honestly model this yet), so the test registers one:
    // the point is that the widget renders BOTH figures, the observation with
    // its age and the model with its basis, rather than substituting one for the
    // other.
    registerReckoner<TopicPayload<"vessel.target">>(
      "vessel.target",
      // The same owner the shipped decliner registers under: this test replaces
      // that module's model rather than competing with it, and two owners on one
      // topic is a conflict the registry answers with nothing.
      "targeting",
      (p) => ({
        // Covers the payload ROOT, which is what a whole-topic read needs. A
        // real relative-position model would name just that path and this read
        // would stay stale, which is the point of the coverage declaration; a
        // widget wanting the field alone reads the field subtopic.
        modelled: [{ path: "", basis: "linear-dead-reckoning" }],
        // 12 km: visibly different from the observed 10 km, so a test that
        // silently rendered the observation twice would fail. `value("m", n)`
        // rather than bare numbers because a reckoner returns the SAME payload
        // shape the decode produces, and the widget reads `.magnitude` off each
        // component.
        reckon: () =>
          ({
            ...(p.payload as TopicPayload<"vessel.target">),
            relativePosition: {
              x: value("m", 7200),
              y: value("m", 0),
              z: value("m", 9600),
            },
          }) as unknown as TopicPayload<"vessel.target">,
      }),
    );

    const { fixture, legacyAux } = await mount("dtt-reckon", 10);
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

    await waitFor(() => expect(visibleText()).toMatch(/reckoned/i));
    // Both, side by side. The observation is what we know; the model is what we
    // infer, named so the operator can calibrate their trust in it.
    expect(visibleText()).toContain("10.0 km");
    expect(visibleText()).toContain("12.0 km");
    expect(visibleText()).toContain("linear-dead-reckoning");
    expect(visibleText()).toMatch(/last contact/i);

    teardownMockDataSource(legacyAux);
  });

  it("drops out of the docking HUD rather than drawing alignment from stale data", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-hud-stale" }}>
          <TargetingComponent id="dtt-hud-stale" w={12} h={10} />
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
