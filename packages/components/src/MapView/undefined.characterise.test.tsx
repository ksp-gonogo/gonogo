import {
  clearAugments,
  clearBodies,
  clearRegistry,
  DashboardItemContext,
  registerAugment,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type { MapOverlayContext } from "./index";
import { MapViewComponent } from "./index";

/** What absence means at each of MapView's telemetry reads: `vessel.flight` for position and altitude, `vessel.identity` and `system.bodies` for the body. */

const MAP_VIEW_CHANNELS = [
  "vessel.flight",
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
] as const;

describe("MapView: what undefined telemetry means today", () => {
  let restoreResizeObserver: () => void = () => {};
  // Unmount before the state-mutating teardown, which would otherwise re-render a mounted tree outside act().
  const trees: Array<() => void> = [];

  beforeEach(() => {
    clearRegistry();
    clearBodies();
    registerStockBodies();

    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 600,
      height: 300,
    });
  });

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    restoreResizeObserver();
    vi.unstubAllGlobals();
    clearAugments();
    clearBodies();
  });

  /** MapView reads DashboardItemContext via useActionInput. */
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <DashboardItemContext.Provider value={{ instanceId: "map-test" }}>
        {children}
      </DashboardItemContext.Provider>
    );
  }

  function renderMap(
    config: Record<string, unknown> = {},
    size?: { w: number; h: number },
  ) {
    const fixture = setupStreamFixture({
      carriedChannels: [...MAP_VIEW_CHANNELS],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const result = render(
      <fixture.Provider>
        <Wrap>
          <MapViewComponent
            config={config}
            id="map-test"
            w={size?.w}
            h={size?.h}
          />
        </Wrap>
      </fixture.Provider>,
    );
    trees.push(result.unmount);
    return { ...result, fixture };
  }

  /** Flush the provider's frames so stream-driven re-renders commit inside act. */
  async function flushFrames(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
  }

  /** Body-name inputs only, deliberately without vessel.flight. */
  function emitBodyOnly(fixture: StreamFixture): void {
    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Kerbal X",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }],
      });
    });
  }

  it("nothing emitted: the map reads undefined lat/lon as NOT YET ARRIVED and says so", async () => {
    const { container } = renderMap({}, { w: 14, h: 14 });
    await flushFrames();

    // The one site that tells "nothing has arrived" from "arrived without a position".
    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
    expect(screen.queryByText("No position data")).toBeNull();
    // No body name, so no body label at all rather than a placeholder.
    expect(visibleText(container)).toBe(
      "MAP VIEWFollowWaiting for telemetry...",
    );
  });

  it("nothing emitted: no imaging chip at all, because `if (!body)` outranks the altitude gate", async () => {
    renderMap({}, { w: 14, h: 14 });
    await flushFrames();

    // An unresolved body returns no imaging chip before altitude is consulted, so "NO DATA" is unreachable from a cold start.
    expect(screen.queryByText("NO DATA")).toBeNull();
    expect(screen.queryByText("IMAGING")).toBeNull();
    expect(screen.queryByText("TOO LOW")).toBeNull();
  });

  it("nothing emitted, compact size: undefined lat/lon render as the null dash under a notice, and the Alt row is absent", async () => {
    const { container } = renderMap({}, { w: 4, h: 4 });
    await flushFrames();

    // Pending reads as the same dash a confirmed absence gets; the notice underneath is what separates them.
    expect(visibleText(container)).toBe(
      `MAP VIEWLat${NULL_DISPLAY}Lon${NULL_DISPLAY}Waiting for telemetry...`,
    );
    // The Alt row is gated away entirely, so an undefined altitude is a missing label, not a dash.
    expect(screen.queryByText("Alt")).toBeNull();
    expect(screen.getByText("Lat")).toBeInTheDocument();
  });

  it("a pinned body with no telemetry at all: the SAME undefined lat/lon now reads as NO FIX", async () => {
    // bodyOverride defines the target body with no telemetry, which flips the notice wording.
    renderMap({ bodyOverride: "Mun" }, { w: 14, h: 14 });
    await flushFrames();

    expect(screen.getByText("No position data")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for telemetry...")).toBeNull();
    expect(screen.getByText(/Mun \(pinned\)/)).toBeInTheDocument();
  });

  it("names the body from identity and the catalogue alone, with no vessel.flight", async () => {
    const { fixture, container } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    await flushFrames();

    // The body is a join of identity and system.bodies, neither of which is flight data, so the label and map stand without vessel.flight and only the position is missing.
    expect(screen.getByText(/Kerbin/)).toBeInTheDocument();
    expect(visibleText(container)).toBe(
      "MAP VIEWKerbinNO DATAFollowNo position data",
    );
  });

  it("undefined vessel position is passed straight through to the overlay slot as undefined, never zeroed", async () => {
    registerAugment({
      id: "characterise-overlay-undefined",
      augments: "map-view.overlay",
      component: (ctx: MapOverlayContext) => (
        <div>
          {`lat=${String(ctx.vesselLat)} lon=${String(ctx.vesselLon)} radius=${String(ctx.bodyRadius)} body=${String(ctx.bodyName)}`}
        </div>
      ),
    });

    const { container } = renderMap({}, { w: 14, h: 14 });
    await flushFrames();

    // An augment is handed undefined rather than 0,0, so the absence is visible to it.
    expect(visibleText(container)).toContain(
      "lat=undefined lon=undefined radius=undefined body=undefined",
    );
  });

  it("follow mode coerces an undefined surface speed to ZERO, giving the tightest follow zoom", async () => {
    registerAugment({
      id: "characterise-overlay-zoom",
      augments: "map-view.overlay",
      component: (ctx: MapOverlayContext) => (
        <div>{`zoom=${ctx.camera.zoom.toFixed(4)}`}</div>
      ),
    });

    const { container, fixture } = renderMap({}, { w: 14, h: 14 });
    // A position with no surfaceSpeed reaches `followZoom(speed ?? 0, baseZoom)`.
    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        latitude: 12,
        longitude: 35,
        altitudeAsl: 1000,
      });
    });
    await flushFrames();

    await userEvent.click(screen.getByLabelText("Follow"));
    await flushFrames();

    const zoomWithNoSpeed = visibleText(container);
    expect(zoomWithNoSpeed).toContain("zoom=1.1719");

    // At 2 km/s it zooms out, so `?? 0` asserts "stationary" from a read that said "I do not know".
    act(() => {
      fixture.emit("vessel.flight", {
        latitude: 12,
        longitude: 35,
        altitudeAsl: 1000,
        surfaceSpeed: 2000,
      });
    });
    await flushFrames();

    expect(visibleText(container)).toContain("zoom=0.4883");
  });

  it("a CONFIRMED-ABSENT vessel (tombstoned vessel.flight) renders identically to nothing having arrived", async () => {
    const { fixture, container } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    act(() => {
      // A tombstone: a strictly stronger statement than "not yet".
      fixture.emit("vessel.flight", null);
    });
    await flushFrames();

    // Position fields go through `flight?.x`, so a tombstone and a cold start render alike for position; the body still resolves.
    expect(screen.getByText("No position data")).toBeInTheDocument();
    expect(visibleText(container)).toBe(
      "MAP VIEWKerbinNO DATAFollowNo position data",
    );
  });

  it("a vessel.flight WITHOUT altitudeAsl reports NO DATA, because the missing field now arrives as null", async () => {
    const { fixture } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    act(() => {
      fixture.emit("vessel.flight", { latitude: 12, longitude: 35 });
    });
    await flushFrames();

    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    // An unreported `altitudeAsl` is absent, not NaN, which would pass both window comparisons and claim the craft was imaging.
    expect(screen.getByText("NO DATA")).toBeInTheDocument();
    expect(screen.queryByText("IMAGING")).toBeNull();
  });

  it("compact size with the same partial payload: the Alt row is ABSENT, the same as a cold start", async () => {
    const { container, fixture } = renderMap({}, { w: 4, h: 5 });
    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", { latitude: 12, longitude: 35 });
    });
    await flushFrames();

    // An unreported altitude and an unreported flight record both mean no altitude to show.
    expect(screen.queryByText("Alt")).toBeNull();
    expect(visibleText(container)).toBe("MAP VIEWLat12.00°Lon35.00°");
  });
});
