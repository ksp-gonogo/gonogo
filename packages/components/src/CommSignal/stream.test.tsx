import {
  ContributionsProvider,
  clearContributions,
  DashboardItemContext,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

// `ContributionsProvider` only aggregates a widget's declared slots, and these
// tests mount the component directly rather than through its registration, so
// they supply the meta the dashboard would. Note what that CANNOT prove: for as
// long as the registration itself was missing `contributionSlots`, this meta was
// the only place the slot was declared anywhere, and the tests passed on their
// own fixture while no real app ever aggregated it.
const HOP_RATE_META = {
  componentId: "comm-signal",
  contributionSlots: ["comm-signal.hop-rates"] as const,
};

// The hop-rate tests register a contribution into the global registry, and the
// many no-provider CommSignal tests in this file expect that slot empty, so it
// has to be cleared between tests.
//
// BEFORE each, deliberately, not after. Clearing after fires the registry's
// `useSyncExternalStore` subscribers while the tree is still mounted, and every
// one of those re-renders lands outside `act`: this exact hook was emitting five
// act warnings a run as an `afterEach`. Clearing before leaves the same
// guarantee (no test ever starts with another's contribution) with nothing
// mounted to notify.
beforeEach(() => {
  clearContributions();
});

/**
 * CommSignal genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`: no legacy
 * `DataSource` is registered anywhere in this file.
 *
 * All five reads are clean homes now (`map-topic.ts`):
 * - `comm.connected` -> `comms.link.connected` (the dedicated Delayed,
 *   freeze-exempt connectivity MetaTopic: comms-delay-model-consistency spec),
 *   `comm.signalStrength` -> `vessel.comms.signalStrength` (raw field subtopic
 *   of the `vessel.comms` struct).
 * - `comm.controlState` -> `vessel.state.commsControlStateOrdinal`,
 *   `comm.controlStateName` -> `vessel.state.commsControlStateName` (both
 *   SDK-derived off `vessel.comms.controlState`'s rich `ControlState` enum:
 *   so carrying them means carrying every `vesselStateChannel` input).
 * - `comm.signalDelay` -> `comms.delay.oneWaySeconds`.
 *
 * A fixture that carries only `vessel.comms` therefore streams
 * connected/signalStrength but leaves control state + delay unresolved (their
 * derived/other homes aren't carried, and no legacy source exists here), the
 * widget renders the `describeControl`/delay NULL_DISPLAY placeholders. The
 * final test carries the full set to prove control state + delay stream too.
 */
// Every input `vesselStateChannel` declares (vessel-state.ts) plus `comms.delay`,
// the full allowlist needed for control state + delay to be carried.
const FULL_CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "comms.delay",
];

describe("CommSignal: genuinely runs off the stream (R6 Wave 1)", () => {
  it("reads connected/signalStrength off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-stream" }}>
          <CommSignalComponent id="comm-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: hasData is false (connected/strength/
    // controlState all undefined), so the empty state renders.
    expect(screen.getByText("No signal data")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all,
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);

    act(() => {
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
      });
    });

    // ceil(0.87 * 4) = 4 lit bars; headline reads the percentage.
    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    // Control state (derived, needs the full vessel.state input set) and delay
    // (comms.delay) aren't carried in THIS fixture, and there's no legacy
    // source, so `describeControl` falls through to NULL_DISPLAY and the delay
    // readout renders its NULL_DISPLAY placeholder, two independent NULL_DISPLAY cells.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });

  it(
    "reflects a signal-loss transition (connected True->False->True) as LOS, " +
      "never a stuck-stale 'connected' readout",
    async () => {
      // Connectivity now rides the dedicated comms.link MetaTopic (comm.connected
      // -> comms.link.connected); signalStrength still rides vessel.comms.
      const fixture = setupStreamFixture({
        carriedChannels: ["vessel.comms", "comms.link"],
        pinnedUt: 10,
      });
      const { container } = render(
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "comm-loss" }}>
            <CommSignalComponent id="comm-loss" w={6} h={5} />
          </DashboardItemContext.Provider>
        </fixture.Provider>,
      );

      act(() => {
        fixture.emit("comms.link", { connected: true });
        fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
      });
      await waitFor(() => expect(visibleText()).toContain("87 %"));
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();

      // Signal lost: the wire actively reports connected:false on comms.link
      // (not silence/absence). The widget must show LOS, not hold the stale 87%.
      act(() => {
        fixture.emit("comms.link", { connected: false });
        fixture.emit("vessel.comms", { connected: false, signalStrength: 0 });
      });
      await waitFor(() => {
        if (visibleText(container).includes("SYNCING")) {
          throw new Error("stream status has not settled to live yet");
        }
        expect(screen.getByText("LOS")).toBeTruthy();
      });
      // `visibleText`, not `queryByText`. <Unit> puts a THIN SPACE between the
      // number and its symbol and splits them across elements, so a
      // `queryByText("87 %")` is null whether or not 87% is on screen: it
      // would pass here for the wrong reason and keep passing if the widget
      // held the stale value.
      expect(visibleText(container)).not.toContain("87 %");
      expect(screen.getByLabelText("Signal 0 of 4")).toBeTruthy();
      expect(screen.getByText("No signal")).toBeTruthy();
      // The polite live region announces the loss (not a live-regioned
      // percentage: see the component's own a11y doc comment).
      expect(screen.getByText("Signal lost")).toBeTruthy();

      // Signal regained.
      act(() => {
        fixture.emit("comms.link", { connected: true });
        fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      });
      await waitFor(() => expect(visibleText()).toContain("60 %"));
      expect(screen.queryByText("LOS")).toBeNull();
      expect(screen.getByText("Signal connected")).toBeTruthy();
    },
  );

  it("holds the last-known value when the wire goes silent (no clear-on-disconnect)", async () => {
    // A TelemetryProvider mounted, `vessel.comms` carried. No further wire
    // activity after the initial value: simulating the underlying
    // connection having gone silent. The streamed path does NOT clear to
    // undefined the way the retired legacy `DataSource` did on a status
    // drop; it holds the last-known value instead of clearing it.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms"],
      pinnedUt: 10,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-stream-hold" }}
        >
          <CommSignalComponent id="comm-stream-hold" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.9,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("90 %"));
    // No new wire samples, no status event at all, nothing further happens
    // by design. The value must still be showing.
    expect(visibleText()).toContain("90 %");
    expect(screen.queryByText("No signal data")).toBeNull();
  });

  it(
    "under delay>0, a newer sample doesn't win until the delay elapses, " +
      "renders the OLDER confirmed value in the meantime, then catches up",
    async () => {
      // `pinnedUt` is deliberately OMITTED: ViewClock.viewUt()'s scrubTo
      // target wins outright over the confirmed-edge/delay computation, so a
      // pinned clock would make `delaySeconds` a no-op (see setupStreamFixture).
      const fixture = setupStreamFixture({
        carriedChannels: ["vessel.comms"],
        delaySeconds: 5,
      });

      render(
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "comm-delay" }}>
            <CommSignalComponent id="comm-delay" w={6} h={5} />
          </DashboardItemContext.Provider>
        </fixture.Provider>,
      );

      // Sample A: validAt/deliveredAt = 0 (wall also starts at 0).
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.5 },
          { validAt: 0, deliveredAt: 0 },
        );
      });
      // Nothing renders yet, even sample A hasn't crossed the delay window
      // (confirmedEdgeUt = utNowEstimate() - delaySeconds is negative before
      // any wall time has passed).
      expect(screen.getByText("No signal data")).toBeTruthy();

      // Advance the wall by exactly the delay, sample A crosses the confirmed
      // edge. Nothing else drives a frame refresh between ingests, so the test
      // calls `beginFrame()` itself to apply the new wall time.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(visibleText()).toContain("50 %"));

      // Sample B: a MUCH more current reading arrives (validAt/deliveredAt =
      // 20), but the delay window means it isn't confirmed yet.
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.9 },
          { validAt: 20, deliveredAt: 20 },
        );
        fixture.store.beginFrame();
      });
      // The OLDER confirmed value (50%) must still be what's rendered.
      expect(visibleText()).toContain("50 %");
      expect(visibleText()).not.toContain("90 %");

      // Advance past the delay window relative to sample B's timing too.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(visibleText()).toContain("90 %"));
      expect(visibleText()).not.toContain("50 %");
    },
  );

  it("streams control state (derived) and signal delay off their clean homes", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: FULL_CARRIED,
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-full" }}>
          <CommSignalComponent id="comm-full" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // The derived `vessel.state.commsControlState*` fields require
      // `vessel.orbit` present: `deriveVesselState` returns the whole record
      // only once the vessel has an orbit (vessel-state.ts).
      fixture.emit("vessel.orbit", {
        sma: 680000,
        ecc: 0.0,
        inc: 0.0,
        argPe: 0.0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 1,
      });
      // `controlState` on the wire is the rich `ControlState` enum ordinal
      // (Partial = 3); the SDK collapses it to the widget's level (1) and
      // resolves the "Partial" name string via `vessel.state.commsControlState*`.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.4,
        controlState: 3,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 1.2 });
    });

    // Derived control state resolves off vessel.comms via the vessel.state
    // channel; delay off comms.delay: both streamed, no legacy source.
    await waitFor(() => expect(screen.getByText("Partial")).toBeTruthy());
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);
    // ceil(0.4 * 4) = 2 lit bars.
    expect(screen.getByLabelText("Signal 2 of 4")).toBeTruthy();
    // formatDuration(1.2, { ms: true }) -> "1s".
    expect(visibleText()).toContain("1s");
  });

  it("names the current command centre instead of assuming KSC", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.commandCentre"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-centre" }}>
          <CommSignalComponent id="comm-centre" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      // The vessel's path resolved to a crewed control-source vessel, not
      // KSC (the vanilla "6-kerbal command center" case): the caption must
      // name it, not fall back to the KSC default.
      fixture.emit("comms.commandCentre", {
        id: "vessel:abc-123",
        displayName: "Constant Companion",
        kind: "CrewedVessel",
        bodyIndex: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Signal to Constant Companion")).toBeTruthy(),
    );
    expect(screen.queryByText("Signal to KSC")).toBeNull();
  });

  it("falls back to Signal to KSC when no command-centre identity has arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.commandCentre"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-centre-default" }}
        >
          <CommSignalComponent id="comm-centre-default" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
    });

    await waitFor(() => expect(screen.getByText("Signal to KSC")).toBeTruthy());
  });

  it("renders the full train-schedule with per-leg distances at a comfortable size", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.comms",
        "comms.commandCentre",
        "comms.path",
        "vessel.identity",
      ],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-route" }}>
          <CommSignalComponent id="comm-route" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Active Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      fixture.emit("comms.path", {
        hops: [
          {
            from: "Active Vessel",
            to: "Relay Sat 1",
            kind: 1,
            distanceMeters: 1_850_000,
          },
          { from: "Relay Sat 1", to: "home", kind: 0, distanceMeters: 640_000 },
        ],
      });
    });

    // The top stop is the source vessel's own name, never "You": Gonogo is
    // the experience FROM the command centre.
    await waitFor(() => expect(screen.getByText("Active Vessel")).toBeTruthy());
    expect(screen.getByText("Relay Sat 1")).toBeTruthy();
    expect(screen.getByText("KSC")).toBeTruthy();
    // The legs carry their own numbers, which is the whole point of the
    // schedule: a widget drawing three empty stops looks identical to one
    // that works, so the distances are asserted by value.
    const visible = visibleText();
    expect(visible).toContain("1.9 Mm");
    expect(visible).toContain("640.0 km");
    // Light-time per leg, derived from the distance because no path-wide delay
    // has arrived (the distance / c fallback): 1,850 km is 6 ms, 640 km is 2.
    expect(visible).toContain("6 ms");
    expect(visible).toContain("2 ms");
    // The whole chain, in order, so a reordered or duplicated stop fails here
    // rather than passing on four independent substring hits.
    expect(visible).toContain(
      "RouteActive Vessel1.9 Mm6 msRelay Sat 1640.0 km2 msKSC",
    );
    // Subtitle keeps the plain centre name once the full schedule has room
    // to render below it: the "(N relays)" hint is the cramped-size
    // fallback, not a duplicate of the schedule.
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });

  it("stays on the hop-count hint (not the full chain) at the registered default size", async () => {
    // 6x5 is the widget's own registered `defaultSize`. Stacked vertically
    // (bars, headline, detail grid, then the route), it doesn't have the
    // headroom for a fourth block: showing the chain there would clip
    // against the panel's bottom edge with nothing useful visible. The hint
    // stays legible at any size the subtitle itself shows.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.path"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-route-default" }}
        >
          <CommSignalComponent id="comm-route-default" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("comms.path", {
        hops: [
          { from: "Active Vessel", to: "Relay Sat 1", kind: 1 },
          { from: "Relay Sat 1", to: "home", kind: 0 },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Signal to KSC (1 relay)")).toBeTruthy(),
    );
    expect(screen.queryByText("Relay Sat 1")).toBeNull();
  });

  it("degrades to a hop-count hint beside the centre name when cramped", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.path"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-route-small" }}
        >
          <CommSignalComponent id="comm-route-small" w={4} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("comms.path", {
        hops: [
          { from: "Active Vessel", to: "Relay Sat 1", kind: 1 },
          { from: "Relay Sat 1", to: "home", kind: 0 },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Signal to KSC (1 relay)")).toBeTruthy(),
    );
    // Too cramped for the full chain: the relay's own name never renders.
    expect(screen.queryByText("Relay Sat 1")).toBeNull();
  });

  it("names a direct link with no relay hint", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.path"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-route-direct" }}
        >
          <CommSignalComponent id="comm-route-direct" w={4} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("comms.path", {
        hops: [{ from: "Active Vessel", to: "home", kind: 0 }],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Signal to KSC (direct)")).toBeTruthy(),
    );
  });

  it("joins a `comm-signal.hop-rates` contribution onto the route and flags the bottleneck hop", async () => {
    // Per-hop bitrate is no longer a core hop field: it arrives via the
    // `comm-signal.hop-rates` slot. A comms Uplink (RealAntennas) fills it off
    // its own Topic keyed by node id; here a local contribution stands in for
    // that, keyed to the two hops emitted below. CommSignal joins the rates onto
    // the route it already renders and flags the slower hop by colour, plus a
    // screen-reader-only hint (no visible label word, it was overflowing the leg).
    registerContribution({
      id: "test-comm-signal-hop-rates",
      contributes: "comm-signal.hop-rates",
      compute: () => [
        {
          fromNodeId: "Active Vessel",
          toNodeId: "Relay 1",
          bitsPerSec: 96_000,
        },
        { fromNodeId: "Relay 1", toNodeId: "home", bitsPerSec: 12_000 },
      ],
    });

    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.path", "vessel.identity"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={HOP_RATE_META}>
          <ContributionsProvider>
            <DashboardItemContext.Provider
              value={{ instanceId: "comm-route-rate" }}
            >
              <CommSignalComponent id="comm-route-rate" w={8} h={8} />
            </DashboardItemContext.Provider>
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Active Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      fixture.emit("comms.path", {
        hops: [
          {
            from: "Active Vessel",
            to: "Relay 1",
            kind: 1,
            distanceMeters: 400_000,
          },
          { from: "Relay 1", to: "home", kind: 0, distanceMeters: 900_000 },
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("Active Vessel")).toBeTruthy());
    // Both legs' rates render through the canonical Unit formatter, by value:
    // 96,000 bit/s on the vessel-to-relay leg, 12,000 on the relay-to-home one.
    const routeText = visibleText();
    expect(routeText).toContain("96.0 kbit/s");
    expect(routeText).toContain("12.0 kbit/s");
    // No literal "LIMITING" word (it was overflowing the leg): the bottleneck
    // hop is flagged by colour on its rate value plus a screen-reader-only
    // hint, never by a space-consuming label.
    expect(screen.queryByText("Limiting")).toBeNull();
    const bottleneckHint = screen.getByText(
      /slowest hop, limits end-to-end rate/i,
    );
    expect(bottleneckHint).toBeTruthy();
    const bottleneckValue = bottleneckHint.closest(
      '[title="Slowest hop: caps end-to-end throughput"]',
    );
    expect(bottleneckValue).toBeTruthy();
    // The flag lands on the SLOWER leg, 12 kbit/s, not merely on some leg.
    // `Unit` joins the magnitude to its symbol with a non-breaking space, so
    // the whitespace class is matched rather than a literal space.
    expect(bottleneckValue?.textContent ?? "").toMatch(/12\.0\skbit\/s/);
    expect(bottleneckValue).toHaveStyle({
      color: "var(--color-status-warning-fg-muted)",
    });
  });

  it("falls back to a generic vessel label before vessel.identity has resolved", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.path"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-route-no-identity" }}
        >
          <CommSignalComponent id="comm-route-no-identity" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("comms.path", {
        hops: [{ from: "Active Vessel", to: "home", kind: 0 }],
      });
    });

    await waitFor(() => expect(screen.getByText("Vessel")).toBeTruthy());
    expect(screen.getByText("KSC")).toBeTruthy();
  });

  it("renders no route section when there is no path home", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms", "comms.link", "comms.path"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-route-none" }}
        >
          <CommSignalComponent id="comm-route-none" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("comms.link", { connected: false });
      fixture.emit("vessel.comms", { connected: false, signalStrength: 0 });
      fixture.emit("comms.path", { hops: [] });
    });

    await waitFor(() => expect(screen.getByText("LOS")).toBeTruthy());
    expect(screen.queryByText("Route")).toBeNull();
  });
});
