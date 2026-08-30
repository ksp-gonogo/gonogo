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
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type { MapOverlayContext } from "./index";
import { MapViewComponent } from "./index";

/**
 * What `undefined` MEANS at each of MapView's telemetry reads, as the widget
 * implements it TODAY, ahead of `useTelemetry` returning a `Reading`.
 *
 * MapView reads two things: `useTelemetry("vessel.flight")` for the raw
 * surface-frame lat/lon, and `useStream<VesselState>("vessel.state")` for the
 * quality-picked altitude and the body name. Every consumer of those two
 * reads spells absence as `=== undefined`, `?.` or `?? 0`, so this file pins
 * which of the four incompatible meanings each site actually gives it.
 */

// All eight vessel.state inputs, same list the widget's own test carries: the
// derived channel's carried gate is parent-channel-scoped.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

describe("MapView: what undefined telemetry means today", () => {
  // Unmount before the state-mutating teardown (clearBodies / clearAugments),
  // which would otherwise re-render a still-mounted tree outside act().
  const trees: Array<() => void> = [];

  beforeEach(() => {
    clearRegistry();
    clearBodies();
    registerStockBodies();

    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 600, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
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
      carriedChannels: [...VESSEL_STATE_INPUTS],
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

  /** Flush the provider's beginFrame rAF ticks so stream-driven re-renders
   *  commit inside act rather than landing on a later frame. */
  async function flushFrames(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
  }

  /** Body-name inputs only: identity carries the index, system.bodies the
   *  name. Deliberately WITHOUT vessel.flight, which is what several tests
   *  below are about. */
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

  // ── 1. Nothing has arrived at all ──────────────────────────────────────

  it("nothing emitted: the map reads undefined lat/lon as NOT YET ARRIVED and says so", async () => {
    const { container } = renderMap({}, { w: 14, h: 14 });
    await flushFrames();

    // `targetBodyId === undefined` picks the pending wording over the
    // no-fix wording: this one site is the only place MapView distinguishes
    // "nothing has arrived" from "arrived without a position".
    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
    expect(screen.queryByText("No position data")).toBeNull();
    // `displayName` is undefined, so the body label is absent entirely
    // rather than rendering a placeholder.
    expect(visibleText(container)).toBe(
      "MAP VIEWFollowWaiting for telemetry...",
    );
  });

  it("nothing emitted: no imaging chip at all, because `if (!body)` outranks the altitude gate", async () => {
    renderMap({}, { w: 14, h: 14 });
    await flushFrames();

    // imagingStatus returns null on an unresolved body BEFORE it ever looks
    // at altSea, so the "NO DATA" branch below is unreachable from a cold
    // start and the chip is simply missing.
    expect(screen.queryByText("NO DATA")).toBeNull();
    expect(screen.queryByText("IMAGING")).toBeNull();
    expect(screen.queryByText("TOO LOW")).toBeNull();
  });

  it("nothing emitted, compact size: undefined lat/lon render as the null dash, and the Alt row is absent", async () => {
    const { container } = renderMap({}, { w: 4, h: 4 });
    await flushFrames();

    // `lat === undefined ? NULL_DISPLAY : <Unit/>`: pending reads as a dash,
    // the same dash a confirmed-absent value would get.
    expect(visibleText(container)).toBe(
      `MAP VIEWLat${NULL_DISPLAY}Lon${NULL_DISPLAY}`,
    );
    // `altSea !== undefined && rows >= 5` gates the whole row away, so an
    // undefined altitude is NOT a dash here, it is a missing label.
    expect(screen.queryByText("Alt")).toBeNull();
    expect(screen.getByText("Lat")).toBeInTheDocument();
  });

  // ── 2. Gates that test for absence ─────────────────────────────────────

  it("a pinned body with no telemetry at all: the SAME undefined lat/lon now reads as NO FIX", async () => {
    // config.bodyOverride makes targetBodyId defined without any telemetry
    // arriving, which flips the NoSignal wording. Both branches of that gate
    // are reachable from an all-undefined stream; only the config differs.
    renderMap({ bodyOverride: "Mun" }, { w: 14, h: 14 });
    await flushFrames();

    expect(screen.getByText("No position data")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for telemetry...")).toBeNull();
    expect(screen.getByText(/Mun \(pinned\)/)).toBeInTheDocument();
  });

  it("body inputs without vessel.flight: vessel.state stays undefined, so even the body LABEL never appears", async () => {
    const { fixture, container } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    await flushFrames();

    // The Loaded basis returns `undefined` for the whole vessel.state record
    // when vessel.flight has no point, so `bodyName` is undefined even though
    // vessel.identity and system.bodies both arrived and jointly name the
    // body. One missing input erases a label two present inputs could fill.
    expect(screen.queryByText(/Kerbin/)).toBeNull();
    expect(visibleText(container)).toBe(
      "MAP VIEWFollowWaiting for telemetry...",
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

    // `vesselLat: vesselOnThisBody ? lat?.magnitude : undefined` and
    // `bodyRadius: body?.radius`: an augment ranking anomalies by distance to
    // the craft is handed undefined rather than 0,0, so the absence is at
    // least visible to it.
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
    // A position but no surfaceSpeed field: enough to satisfy the follow
    // effect's lat/lon gate and reach `followZoom(speed ?? 0, baseZoom)`.
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

    // The same widget, told the craft is doing 2 km/s, zooms out. So the
    // `?? 0` above is not a harmless default: it asserts "stationary" from a
    // read that only ever said "I do not know".
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

  // ── 3. null versus undefined ───────────────────────────────────────────

  it("a CONFIRMED-ABSENT vessel (tombstoned vessel.flight) renders identically to nothing having arrived", async () => {
    const { fixture, container } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    act(() => {
      // A tombstone: the subject says there is no vessel.flight, which is a
      // strictly stronger statement than "not yet".
      fixture.emit("vessel.flight", null);
    });
    await flushFrames();

    // MapView reaches every field through `flight?.x` / `vesselState?.x`, and
    // `altSea = vesselState?.altitudeAsl ?? undefined` flattens the null arm
    // too, so the widget implements NO distinction: a confirmed absence and a
    // cold start are the same "Waiting for telemetry..." screen.
    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
    expect(visibleText(container)).toBe(
      "MAP VIEWFollowWaiting for telemetry...",
    );
  });

  // ── 4. A partial payload: the record arrived, a field did not ──────────

  it("a vessel.flight WITHOUT altitudeAsl reports NO DATA, because the missing field now arrives as null", async () => {
    const { fixture } = renderMap({}, { w: 14, h: 14 });
    emitBodyOnly(fixture);
    act(() => {
      fixture.emit("vessel.flight", { latitude: 12, longitude: 35 });
    });
    await flushFrames();

    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    // This case read IMAGING until 2026-08-25, and it was the most legible
    // symptom of a real defect rather than a quirk of this widget. The
    // derivation mapped an absent wire field to NaN, `altSea ?? undefined`
    // kept NaN (`??` catches null and undefined, not NaN), `altSea ===
    // undefined` was false, and both `NaN < min` and `NaN > max` are false.
    // So the one gate written for "no altitude" was bypassed and the widget
    // stated positively that the craft was inside the imaging window, off a
    // reading nobody had sent.
    //
    // `vessel.state` now answers null for an unreported field, which is what
    // that field has always declared, so the gate fires and the widget says it
    // does not know.
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

    // This rendered an `Alt` row with a null dash until 2026-08-25, because
    // NaN passed `altSea !== undefined`. It was the one place the widget told a
    // partial payload from an absent one, and it did so by accident. With null
    // reaching it instead, the row is gone and the two read alike, which is the
    // honest answer: an unreported altitude and an unreported flight record are
    // both "no altitude to show".
    expect(screen.queryByText("Alt")).toBeNull();
    expect(visibleText(container)).toBe("MAP VIEWLat12.00°Lon35.00°");
  });
});
