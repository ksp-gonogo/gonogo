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

// These tests mount the component directly, so they supply the meta the dashboard would derive from its registration.
const HOP_RATE_META = {
  componentId: "comm-signal",
  contributionSlots: ["comm-signal.hop-rates"] as const,
};

// Cleared before each rather than after, so no mounted tree is notified outside act.
beforeEach(() => {
  clearContributions();
});

/** CommSignal off the real stream pipeline via `StubTransport`. */

describe("CommSignal: genuinely runs off the stream", () => {
  it("reads connected/signalStrength off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-stream" }}>
          <CommSignalComponent id="comm-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("No signal data")).toBeTruthy();

    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    // No control state and no delay arrived: two independent NULL_DISPLAY cells.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });

  // The panel stays and every figure nulls; the badge itself is asserted in `panel-badge.test.tsx`.
  it("nulls every line once the link stops arriving", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-nosig" }}>
          <CommSignalComponent id="comm-nosig" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
    });
    await waitFor(() => expect(visibleText()).toContain("87 %"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // The panel stays: no collapse to a single sentence.
    await waitFor(() =>
      expect(screen.queryByText("Link state no longer current")).toBeNull(),
    );
    expect(screen.queryByText("No signal data")).toBeNull();
    expect(screen.getByText("Control")).toBeTruthy();
    expect(screen.getByText("Delay")).toBeTruthy();

    // Every figure nulls: not held, not marked, not reckoned.
    expect(visibleText()).not.toContain("87");
    expect(container.querySelectorAll("[data-held]").length).toBe(0);
    expect(visibleText()).not.toContain("Full");
    // The bars withhold their count, and their aria-label matches the visible badge.
    expect(screen.getByLabelText("No signal")).toBeTruthy();
    expect(screen.queryByLabelText(/Signal \d of 4/)).toBeNull();
    expect(screen.queryByLabelText(/not current/i)).toBeNull();

    expect(visibleText()).not.toMatch(/not current/i);
    expect(visibleText()).not.toMatch(/no longer current/i);
    expect(visibleText()).not.toMatch(/stale/i);

    await act(async () => {});
  });

  it(
    "reflects a signal-loss transition (connected True->False->True) as LOS, " +
      "never a stuck-stale 'connected' readout",
    async () => {
      const fixture = setupStreamFixture({
        pinnedUt: 10,
        suspendFrames: true,
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

      // A reported disconnection, not silence: LOS, never the held 87%.
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
      // `visibleText`, not `queryByText`: `Unit` splits number and symbol across elements, so a text query is always null.
      expect(visibleText(container)).not.toContain("87 %");
      expect(screen.getByLabelText("Signal 0 of 4")).toBeTruthy();
      expect(screen.getByText("No signal")).toBeTruthy();
      expect(screen.getByText("Signal lost")).toBeTruthy();

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
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
    expect(visibleText()).toContain("90 %");
    expect(screen.queryByText("No signal data")).toBeNull();
  });

  it(
    "under delay>0, a newer sample doesn't win until the delay elapses, " +
      "renders the OLDER confirmed value in the meantime, then catches up",
    async () => {
      // No `pinnedUt`: a pinned clock overrides the confirmed edge and makes `delaySeconds` a no-op.
      const fixture = setupStreamFixture({
        delaySeconds: 5,
        suspendFrames: true,
      });

      render(
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "comm-delay" }}>
            <CommSignalComponent id="comm-delay" w={6} h={5} />
          </DashboardItemContext.Provider>
        </fixture.Provider>,
      );

      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.5 },
          { validAt: 0, deliveredAt: 0 },
        );
      });
      // Sample A has not crossed the delay window yet.
      expect(screen.getByText("No signal data")).toBeTruthy();

      // Wall time moving is not itself a frame, so the test mints one.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(visibleText()).toContain("50 %"));

      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.9 },
          { validAt: 20, deliveredAt: 20 },
        );
        fixture.store.beginFrame();
      });
      expect(visibleText()).toContain("50 %");
      expect(visibleText()).not.toContain("90 %");

      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(visibleText()).toContain("90 %"));
      expect(visibleText()).not.toContain("50 %");
    },
  );

  it("streams control state and signal delay off their clean homes", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-full" }}>
          <CommSignalComponent id="comm-full" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // The wire carries the `ControlState` ordinal: Partial is 3.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.4,
        controlState: 3,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 1.2 });
    });

    await waitFor(() => expect(screen.getByText("Partial")).toBeTruthy());
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);
    expect(screen.getByLabelText("Signal 2 of 4")).toBeTruthy();
    expect(visibleText()).toContain("1s");
  });

  it("names the current command centre instead of assuming KSC", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-centre" }}>
          <CommSignalComponent id="comm-centre" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
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
      pinnedUt: 10,
      suspendFrames: true,
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
      // The caption asserts a signal, so it needs a link verdict to render at all.
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
    });

    await waitFor(() => expect(screen.getByText("Signal to KSC")).toBeTruthy());
  });

  it("renders the full train-schedule with per-leg distances at a comfortable size", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-route" }}>
          <CommSignalComponent id="comm-route" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("comms.link", { connected: true });
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

    await waitFor(() => expect(screen.getByText("Active Vessel")).toBeTruthy());
    expect(screen.getByText("Relay Sat 1")).toBeTruthy();
    expect(screen.getByText("KSC")).toBeTruthy();
    // Asserted by value: three empty stops look identical to a working schedule.
    expect(visibleText()).toContain("1.9 Mm");
    expect(visibleText()).toContain("640.0 km");
    // No total delay has arrived, so no leg has a share of one.
    expect(visibleText()).not.toContain("6 ms");

    act(() => {
      fixture.emit("comms.delay", {
        oneWaySeconds: 2_490_000 / 299_792_458,
      });
    });

    // 1,850 km of the 2,490 km route is 6 ms of the 8, and 640 km the remaining 2.
    await waitFor(() => expect(visibleText()).toContain("6 ms"));
    const visible = visibleText();
    expect(visible).toContain("2 ms");
    // The whole chain in order, so a reordered or duplicated stop fails.
    expect(visible).toContain(
      "RouteActive Vessel1.9 Mm6 msRelay Sat 1640.0 km2 msKSC",
    );
    // The "(N relays)" hint is the cramped fallback, not a duplicate of the schedule.
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });

  it("stays on the hop-count hint (not the full chain) at the registered default size", async () => {
    // Portrait 6x5 has no headroom for the route below the detail grid.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
      fixture.emit("comms.link", { connected: true });
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
      pinnedUt: 10,
      suspendFrames: true,
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
      fixture.emit("comms.link", { connected: true });
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

  it("names a direct link with no relay hint", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
      fixture.emit("comms.link", { connected: true });
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
    // A local contribution stands in for a comms Uplink, keyed to the two hops emitted below.
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
      pinnedUt: 10,
      suspendFrames: true,
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
    const routeText = visibleText();
    expect(routeText).toContain("96.0 kbit/s");
    expect(routeText).toContain("12.0 kbit/s");
    // The bottleneck is flagged by colour plus a hidden hint, never a visible label word.
    expect(screen.queryByText("Limiting")).toBeNull();
    const bottleneckHint = screen.getByText(
      /slowest hop, limits end-to-end rate/i,
    );
    expect(bottleneckHint).toBeTruthy();
    const bottleneckValue = bottleneckHint.closest(
      '[title="Slowest hop: caps end-to-end throughput"]',
    );
    expect(bottleneckValue).toBeTruthy();
    // The flag lands on the slower leg; `Unit` joins with a non-breaking space, hence `\s`.
    expect(bottleneckValue?.textContent ?? "").toMatch(/12\.0\skbit\/s/);
    expect(bottleneckValue).toHaveStyle({
      color: "var(--color-status-warning-fg-muted)",
    });
  });

  it("falls back to a generic vessel label before vessel.identity has resolved", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
      pinnedUt: 10,
      suspendFrames: true,
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
