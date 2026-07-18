import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearBodies,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerAugment,
  registerDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type {
  MapBadgesContext,
  MapBaseLayerContext,
  MapOverlayContext,
  MapSectionsContext,
} from "./index";
import { MapViewComponent } from "./index";
import { MapViewConfigComponent } from "./MapViewConfig";

// The vessel kinematics/body now read off the stream (vessel.flight + the
// derived vessel.state); the SCANsat reads (coverage / scanningVessels /
// anomalies) and the per-key TelemetryRow stay on the legacy "data" shim, so a
// legacy source is registered alongside the stream fixture for those.
const SCANSAT_KEYS: DataKey[] = [
  { key: "scansat.scanningVessels" },
  { key: "scansat.anomalies.Kerbin" },
  { key: "scansat.coverage.Kerbin.2" },
  { key: "scansat.coverage.Kerbin.1" },
  { key: "scansat.coverage.Kerbin.8" },
  { key: "scansat.coverage.Kerbin.256" },
  { key: "scansat.coverage.Kerbin.128" },
];

// All eight vessel.state inputs — the carried gate is parent-channel-scoped.
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

interface VesselScenario {
  lat?: number;
  lon?: number;
  altitude?: number;
  /** Parent body name (drives vessel.state.parentBodyName → getBody + labels). */
  body?: string;
}

describe("MapViewComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  // Unmount before the state-mutating teardown (buffered.disconnect / clearBodies
  // / clearAugments), which would otherwise re-render a still-mounted tree.
  const trees: Array<() => void> = [];

  beforeEach(async () => {
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

    source = new MockDataSource({ keys: SCANSAT_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    buffered.disconnect();
    vi.unstubAllGlobals();
    clearBodies();
  });

  /** MapView reads DashboardItemContext via useActionInput — wrap in the provider. */
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

  /** Emit the vessel kinematics/body onto the stream, then flush the provider's
   * beginFrame rAF ticks inside act so the stream-driven re-renders (widget +
   * any AugmentSlot) commit inside act rather than landing on a later frame. */
  async function emitVessel(
    fixture: StreamFixture,
    s: VesselScenario,
  ): Promise<void> {
    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        latitude: s.lat ?? 0,
        longitude: s.lon ?? 0,
        altitudeAsl: s.altitude ?? 0,
        dynamicPressureKPa: 0,
        mach: 0,
        surfaceSpeed: 0,
        verticalSpeed: 0,
      });
      if (s.body !== undefined) {
        fixture.emit("vessel.identity", {
          vesselId: "v1",
          name: "Kerbal X",
          vesselType: 0,
          situation: 1,
          parentBodyIndex: 1,
          launchUt: 0,
        });
        fixture.emit("system.bodies", {
          bodies: [{ index: 1, name: s.body, radius: 600_000 }],
        });
      }
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
  }

  /** Emit the SCANsat coverage/vessel/anomaly scenario onto the legacy source,
   * then flush a frame so the buffered delivery settles inside act. */
  async function primeScan(): Promise<void> {
    act(() => {
      source.emit("scansat.anomalies.Kerbin", [
        {
          name: "Near Site",
          latitude: 10,
          longitude: 33,
          known: true,
          detail: true,
        },
        {
          name: "Far Site",
          latitude: -40,
          longitude: -120,
          known: true,
          detail: true,
        },
        {
          name: "Hidden",
          latitude: 0,
          longitude: 0,
          known: false,
          detail: false,
        },
      ]);
      source.emit("scansat.scanningVessels", [
        {
          vesselId: "v1",
          vesselName: "Mapper",
          body: "Kerbin",
          subLatitude: 12,
          subLongitude: 35,
          altitude: 250_000,
          sensors: [
            {
              type: 2,
              fov: 5,
              minAlt: 5000,
              maxAlt: 500_000,
              bestAlt: 250_000,
              inRange: true,
              bestRange: true,
            },
            {
              type: 8,
              fov: 5,
              minAlt: 5000,
              maxAlt: 500_000,
              bestAlt: 250_000,
              inRange: true,
              bestRange: false,
            },
          ],
          groundTrackWidthDeg: 6,
          groundTrackLonHalfDeg: 6.1,
          trackColor: { r: 0, g: 255, b: 200, a: 200 },
        },
      ]);
      source.emit("scansat.coverage.Kerbin.2", 45.6);
      source.emit("scansat.coverage.Kerbin.1", 67.6);
      source.emit("scansat.coverage.Kerbin.8", 29.6);
      source.emit("scansat.coverage.Kerbin.256", 7.4);
      source.emit("scansat.coverage.Kerbin.128", 0);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
  }

  it("renders without crashing with no data", () => {
    const { container } = renderMap();
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("renders without crashing with full prediction + impact data", async () => {
    const { container, fixture } = renderMap();
    await emitVessel(fixture, { lat: 12.5, lon: -70, body: "Kerbin" });
    // 5 canvases: base, overlay, persistent-data, prediction, data.
    await waitFor(() => {
      if (container.querySelectorAll("canvas").length !== 5) {
        throw new Error("map canvases have not all rendered yet");
      }
    });
  });

  it("coverage readout shows per-type percentages and live in-range chips", async () => {
    const { fixture } = renderMap({ showCoverage: true }, { w: 12, h: 12 });
    await emitVessel(fixture, {
      lat: 12,
      lon: 35,
      altitude: 100_000,
      body: "Kerbin",
    });
    await primeScan();
    const panel = await screen.findByRole("region", {
      name: /Scan coverage for Kerbin/i,
    });
    expect(within(panel).getByText("46%")).toBeInTheDocument(); // AltHiRes
    expect(within(panel).getByText("68%")).toBeInTheDocument(); // AltLoRes
    expect(within(panel).getByText("30%")).toBeInTheDocument(); // Biome
    // AltHiRes sensor is bestRange → "best"; Biome sensor inRange → "scan".
    expect(within(panel).getByText("best")).toBeInTheDocument();
    expect(within(panel).getAllByText("scan").length).toBeGreaterThan(0);
  });

  it("body override pins the map to another body and suppresses vessel chrome", async () => {
    const { fixture } = renderMap({ bodyOverride: "Mun" }, { w: 14, h: 12 });
    await emitVessel(fixture, { lat: 12, lon: 35, body: "Kerbin" });
    await primeScan();
    // Label shows the pinned body, not the vessel's Kerbin.
    expect(await screen.findByText(/Mun \(pinned\)/)).toBeInTheDocument();
    // Follow toggle is suppressed (vessel isn't on the mapped body).
    expect(screen.queryByLabelText("Follow")).toBeNull();
  });

  it("a11y smoke: widget with coverage panel has no violations", async () => {
    const { container, fixture } = renderMap(
      { showCoverage: true },
      { w: 14, h: 14 },
    );
    await emitVessel(fixture, {
      lat: 12,
      lon: 35,
      altitude: 100_000,
      body: "Kerbin",
    });
    await primeScan();
    await expect(axe(container)).resolves.toHaveNoViolations();
  }, 20000);

  // axe traversal of the body picker (a select carrying every stock body) is
  // slow enough to blow vitest's 5s default under CI load — give the a11y
  // smoke a generous margin so it doesn't flake (it passes fast locally).
  it("a11y smoke: config component (body picker + toggles) has no violations", async () => {
    const { container } = render(
      <MapViewConfigComponent config={{}} onSave={() => {}} />,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  }, 20000);

  it("config body picker offers a Follow-vessel default and stock bodies", () => {
    render(<MapViewConfigComponent config={{}} onSave={() => {}} />);
    const select = screen.getByLabelText("Body") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(within(select).getByText("Follow vessel")).toBeInTheDocument();
    // Stock bodies are registered in beforeEach.
    expect(
      within(select).getByRole("option", { name: "Kerbin" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Mun" }),
    ).toBeInTheDocument();
  });

  // ── Augment slots ─────────────────────────────────────────────────────
  // MapView exposes an OVERLAY slot over the map canvases (passing the live
  // equirectangular projection) and a BADGES escape-hatch in the header. No
  // first-party augment fills them, so these register throwaway augments
  // (cleared after each) to prove the slots compose and pass their props, and
  // that the empty slots are inert when nothing is registered.
  describe("augment slots", () => {
    // This inner afterEach runs BEFORE the outer one, so unmount the trees here
    // first — otherwise clearAugments() notifies a still-mounted AugmentSlot's
    // subscribers and it re-renders outside act() (CLAUDE.md → act() pattern).
    afterEach(() => {
      for (const unmount of trees) unmount();
      trees.length = 0;
      clearAugments();
    });

    it("renders an overlay augment over the map, passed the live projection", async () => {
      registerAugment({
        id: "test-map-overlay",
        augments: "map-view.overlay",
        component: (ctx: MapOverlayContext) => {
          const p = ctx.project(0, 0);
          return (
            <div data-testid="overlay-probe">
              w={ctx.width} px={Math.round(p.x)} py={Math.round(p.y)}
            </div>
          );
        },
      });

      const { container, fixture } = renderMap();
      await emitVessel(fixture, { lat: 0, lon: 0, body: "Kerbin" });

      const probe = await waitFor(() => {
        const el = container.querySelector('[data-testid="overlay-probe"]');
        if (el === null)
          throw new Error("overlay augment has not rendered yet");
        return el;
      });
      // The map canvases still render beneath the overlay layer.
      expect(container.querySelectorAll("canvas").length).toBeGreaterThan(0);
      // The overlay received a real pixel width and a working `project`
      // (numeric screen coordinates) as slot props.
      expect(probe.textContent).toMatch(/w=\d+ px=-?\d+ py=-?\d+/);
    });

    it("passes the anomaly config toggles + raw vessel position to the overlay slot (P4c-b: AnomalyOverlay's props)", async () => {
      registerAugment({
        id: "test-map-overlay-anomaly-props",
        augments: "map-view.overlay",
        component: (ctx: MapOverlayContext) => (
          <div data-testid="overlay-anomaly-probe">
            showAnomalies={String(ctx.showAnomalies)} showAnomalyPanel=
            {String(ctx.showAnomalyPanel)} vesselLat={String(ctx.vesselLat)}{" "}
            vesselLon={String(ctx.vesselLon)}
          </div>
        ),
      });

      const { container, fixture } = renderMap({
        showAnomalies: true,
        showAnomalyPanel: true,
      });
      await emitVessel(fixture, { lat: 12.5, lon: -70, body: "Kerbin" });

      const probe = await waitFor(() => {
        const el = container.querySelector(
          '[data-testid="overlay-anomaly-probe"]',
        );
        if (el === null || !el.textContent?.includes("vesselLat=12.5"))
          throw new Error("overlay augment has not rendered vessel pos yet");
        return el;
      });
      expect(probe.textContent).toContain("showAnomalies=true");
      expect(probe.textContent).toContain("showAnomalyPanel=true");
      expect(probe.textContent).toContain("vesselLat=12.5");
      expect(probe.textContent).toContain("vesselLon=-70");
    });

    it("clears vesselLat/vesselLon on the overlay slot when a bodyOverride diverges from the vessel's body", async () => {
      registerAugment({
        id: "test-map-overlay-anomaly-override",
        augments: "map-view.overlay",
        component: (ctx: MapOverlayContext) => (
          <div data-testid="overlay-anomaly-probe">
            vesselLat={String(ctx.vesselLat)} vesselLon={String(ctx.vesselLon)}
          </div>
        ),
      });

      const { container, fixture } = renderMap({ bodyOverride: "Mun" });
      await emitVessel(fixture, { lat: 12.5, lon: -70, body: "Kerbin" });

      const probe = await waitFor(() => {
        const el = container.querySelector(
          '[data-testid="overlay-anomaly-probe"]',
        );
        if (el === null)
          throw new Error("overlay augment has not rendered yet");
        return el;
      });
      expect(probe.textContent).toContain("vesselLat=undefined");
      expect(probe.textContent).toContain("vesselLon=undefined");
    });

    it("renders a badges augment in the header, passed the body name", async () => {
      registerAugment({
        id: "test-map-badge",
        augments: "map-view.badges",
        component: (ctx: MapBadgesContext) => (
          <span>badge:{ctx.bodyName ?? "?"}</span>
        ),
      });

      const { container, fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!container.textContent?.includes("badge:Kerbin")) {
          throw new Error("badge augment has not rendered with the body name");
        }
      });
      expect(container.textContent).toContain("badge:Kerbin");
    });

    it("renders the map with both slots empty when no augment is registered", async () => {
      const { container, fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      // The map still renders (canvases present) with nothing composed in.
      await waitFor(() => {
        if (container.querySelector("canvas") === null) {
          throw new Error("map has not rendered yet");
        }
      });
      expect(
        container.querySelector('[data-testid="overlay-probe"]'),
      ).toBeNull();
      expect(container.textContent).not.toContain("badge:");
    });

    it("composes a fake map-view.sections augment below the map", async () => {
      registerAugment({
        id: "test-map-sections",
        augments: "map-view.sections",
        component: (ctx: MapSectionsContext) => (
          <div>Sections for {ctx.bodyName}</div>
        ),
      });

      const { container, fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!container.textContent?.includes("Sections for Kerbin")) {
          throw new Error("sections augment has not rendered yet");
        }
      });
    });

    it("map-view.base: draws the augment's canvas over the stock texture only when activeLayerId matches", async () => {
      const onLayerCalls: Array<HTMLCanvasElement | null> = [];
      registerAugment({
        id: "fake-base",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when this augment's own active/inactive state flips, mirroring the real base-layer augment's own gating contract
          useEffect(() => {
            if (ctx.activeLayerId !== "fake-base") return;
            const c = document.createElement("canvas");
            c.width = ctx.width;
            c.height = ctx.height;
            ctx.onLayer(c, 1);
            onLayerCalls.push(c);
          }, [ctx.activeLayerId]);
          return null;
        },
      });

      const { fixture } = renderMap({ baseLayerId: "fake-base" });
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (onLayerCalls.length !== 1) {
          throw new Error("onLayer has not been called yet");
        }
      });
      expect(onLayerCalls).toHaveLength(1);
    });

    it("map-view.base: an unmatched activeLayerId never calls onLayer with a canvas", async () => {
      let called = false;
      registerAugment({
        id: "fake-base-2",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when this augment's own active/inactive state flips, mirroring the real base-layer augment's own gating contract
          useEffect(() => {
            if (ctx.activeLayerId === "fake-base-2") {
              called = true;
              ctx.onLayer(document.createElement("canvas"), 1);
            }
          }, [ctx.activeLayerId]);
          return null;
        },
      });

      const { fixture } = renderMap({ baseLayerId: "something-else" });
      await emitVessel(fixture, { body: "Kerbin" });

      expect(called).toBe(false);
    });
  });
});
