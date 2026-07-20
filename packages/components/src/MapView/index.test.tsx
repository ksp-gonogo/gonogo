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
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ModalChromeContext, type ModalChromeValue } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type {
  MapActionsContext,
  MapBadgesContext,
  MapBaseLayerContext,
  MapOverlayContext,
  MapSectionsContext,
} from "./index";
import { MapViewComponent, VanillaSuppressionProbe } from "./index";
import { MapViewConfigComponent } from "./MapViewConfig";

// The vessel kinematics/body read off the stream (vessel.flight + the
// derived vessel.state); the per-key TelemetryRow stays on the legacy "data"
// shim, so a legacy source is registered alongside the stream fixture for it
// even though this suite doesn't emit any legacy keys onto it.

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

    source = new MockDataSource();
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

  /**
   * Minimal stand-in for `ui`'s `ModalDialog` chrome — renders whatever
   * footer `useModalSaveBar` registers so a config component's Save button
   * is reachable in an isolated render (see `ModalSaveBar.test.tsx` for the
   * same pattern in `ui-kit`).
   */
  function ModalChromeHost({ children }: { children: ReactNode }) {
    const [footer, setFooter] = useState<ReactNode>(null);
    // Memoized exactly like the real `ModalDialog` (`ui/src/Modal.tsx`) —
    // an unstable `chrome` object here would make every consumer re-render
    // on every footer update via context propagation, which (combined with
    // a config component's `onSave: () => onSave(candidate)` closure being
    // recreated each render) loops forever.
    const chrome = useMemo<ModalChromeValue>(
      () => ({ setFooter, setDirty: () => {} }),
      [],
    );
    return (
      <ModalChromeContext.Provider value={chrome}>
        {children}
        {footer}
      </ModalChromeContext.Provider>
    );
  }

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
    onConfigChange?: (config: Record<string, unknown>) => void,
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
            onConfigChange={onConfigChange}
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

  it("renders without crashing with no data", () => {
    renderMap();
    expect(screen.getByTestId("map-view-base-canvas")).toBeInTheDocument();
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

  it("body override pins the map to another body and suppresses vessel chrome", async () => {
    const { fixture } = renderMap({ bodyOverride: "Mun" }, { w: 14, h: 12 });
    await emitVessel(fixture, { lat: 12, lon: 35, body: "Kerbin" });
    // Label shows the pinned body, not the vessel's Kerbin.
    expect(await screen.findByText(/Mun \(pinned\)/)).toBeInTheDocument();
    // Follow toggle is suppressed (vessel isn't on the mapped body).
    expect(screen.queryByLabelText("Follow")).toBeNull();
  });

  it("a11y smoke: widget with vessel + trajectory data has no violations", async () => {
    const { container, fixture } = renderMap({}, { w: 14, h: 14 });
    await emitVessel(fixture, {
      lat: 12,
      lon: 35,
      altitude: 100_000,
      body: "Kerbin",
    });
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

  it("config no longer offers per-scan-type fog layer toggles (moved to the owning Uplink's own settings)", () => {
    render(<MapViewConfigComponent config={{}} onSave={() => {}} />);
    expect(screen.queryByText("Fog layers")).toBeNull();
    expect(screen.queryByText("Altimetry HiRes")).toBeNull();
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

    it("passes the raw vessel position to the overlay slot", async () => {
      registerAugment({
        id: "test-map-overlay-vessel-pos",
        augments: "map-view.overlay",
        component: (ctx: MapOverlayContext) => (
          <div data-testid="overlay-vessel-pos-probe">
            vesselLat={String(ctx.vesselLat)} vesselLon={String(ctx.vesselLon)}
          </div>
        ),
      });

      const { container, fixture } = renderMap();
      await emitVessel(fixture, { lat: 12.5, lon: -70, body: "Kerbin" });

      const probe = await waitFor(() => {
        const el = container.querySelector(
          '[data-testid="overlay-vessel-pos-probe"]',
        );
        if (el === null || !el.textContent?.includes("vesselLat=12.5"))
          throw new Error("overlay augment has not rendered vessel pos yet");
        return el;
      });
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

    it("map-view.base: every registered augment mounts and can contribute a canvas — no single-pick gating", async () => {
      const onLayerCalls: string[] = [];
      registerAugment({
        id: "fake-base-a",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once and reports; mirrors a real base-layer augment's own onLayer call shape
          useEffect(() => {
            const c = document.createElement("canvas");
            c.width = ctx.width;
            c.height = ctx.height;
            ctx.onLayer("fake-base-a", c, 1);
            onLayerCalls.push("fake-base-a");
          }, []);
          return null;
        },
      });
      registerAugment({
        id: "fake-base-b",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once and reports; mirrors a real base-layer augment's own onLayer call shape
          useEffect(() => {
            const c = document.createElement("canvas");
            ctx.onLayer("fake-base-b", c, 1);
            onLayerCalls.push("fake-base-b");
          }, []);
          return null;
        },
      });

      const { fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (onLayerCalls.length !== 2) {
          throw new Error("both base augments have not mounted yet");
        }
      });
      expect(onLayerCalls).toContain("fake-base-a");
      expect(onLayerCalls).toContain("fake-base-b");
    });

    it("map-view.base: a per-layer augmentSettings[id].show reads back on ctx.augmentSettings, letting one layer suppress itself while a sibling still contributes", async () => {
      const calls: string[] = [];
      registerAugment({
        id: "fake-base-off",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          useEffect(() => {
            if (ctx.augmentSettings?.["fake-base-off"]?.show === false) {
              ctx.onLayer("fake-base-off", null, 0);
              return;
            }
            ctx.onLayer("fake-base-off", document.createElement("canvas"), 1);
            calls.push("fake-base-off");
          }, [ctx.augmentSettings, ctx.onLayer]);
          return null;
        },
      });
      registerAugment({
        id: "fake-base-on",
        augments: "map-view.base",
        component: (ctx: MapBaseLayerContext) => {
          useEffect(() => {
            ctx.onLayer("fake-base-on", document.createElement("canvas"), 1);
            calls.push("fake-base-on");
          }, [ctx.onLayer]);
          return null;
        },
      });

      const { fixture } = renderMap({
        augmentSettings: { "fake-base-off": { show: false } },
      });
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!calls.includes("fake-base-on")) {
          throw new Error("the un-suppressed sibling has not mounted yet");
        }
      });
      expect(calls).not.toContain("fake-base-off");
    });

    it("map-view.actions: a registered augment can toggle a base layer's show via setAugmentShow, writing the SAME augmentSettings the settings panel reads", async () => {
      registerAugment({
        id: "test-map-actions",
        augments: "map-view.actions",
        component: (ctx: MapActionsContext) => (
          <button
            type="button"
            onClick={() => ctx.setAugmentShow("scan-layer", false)}
          >
            Toggle scan layer
          </button>
        ),
      });

      const onConfigChange = vi.fn();
      const { fixture } = renderMap({}, undefined, onConfigChange);
      await emitVessel(fixture, { body: "Kerbin" });

      const user = userEvent.setup();
      await user.click(
        await screen.findByRole("button", { name: "Toggle scan layer" }),
      );

      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({
          augmentSettings: expect.objectContaining({
            "scan-layer": expect.objectContaining({ show: false }),
          }),
        }),
      );
    });

    it("map-view.actions receives the widget's current augmentSettings, the same values the settings panel reads", async () => {
      registerAugment({
        id: "test-map-actions-read",
        augments: "map-view.actions",
        component: (ctx: MapActionsContext) => (
          <div data-testid="actions-probe">
            show={String(ctx.augmentSettings?.["scan-layer"]?.show)}
          </div>
        ),
      });

      const { container, fixture } = renderMap({
        augmentSettings: { "scan-layer": { show: false } },
      });
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!container.textContent?.includes("show=false")) {
          throw new Error("actions augment has not read back the setting yet");
        }
      });
    });
  });

  // Regression guard (2026-07-20): vanilla-base suppression must respect the
  // SAME Domain-presence gate `<AugmentSlot>` itself applies before ever
  // rendering an augment's component — NOT merely that the augment is
  // registered. An earlier version of this fix suppressed off registry
  // presence alone, which (since a client bundle registers its augments
  // unconditionally at import time, whether or not the mod is running in
  // KSP) blacked out the map for every user without that Uplink installed.
  // `VanillaSuppressionProbe` is the piece that must get this right — it
  // reports a `suppressesVanillaBase` augment's live availability up to
  // MapView independently of whether that augment's own component ever
  // mounts (it CAN'T report anything itself while ungated, since it never
  // renders). Tested directly (white-box) rather than through MapView's own
  // canvas paint, which jsdom can't exercise (`installDomStubs` stubs
  // `getContext` to null) — the pure combination of this signal with
  // `suppressesVanillaBase` is covered separately in
  // vanillaSuppression.test.ts.
  describe("VanillaSuppressionProbe (regression guard: suppression must respect Domain availability)", () => {
    const probeTrees: Array<() => void> = [];
    afterEach(() => {
      for (const unmount of probeTrees) unmount();
      probeTrees.length = 0;
    });

    it("case 1: reports available=false while the augment's required Domain has not announced (vanilla base would still paint)", () => {
      const calls: Array<[string, boolean]> = [];
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);

      const result = render(
        <TelemetryProvider client={client}>
          <VanillaSuppressionProbe
            augment={{
              id: "fake-suppressing-base",
              augments: "map-view.base",
              requires: "test-suppress-domain",
              suppressesVanillaBase: true,
              component: () => null,
            }}
            onAvailableChange={(id, available) => calls.push([id, available])}
          />
        </TelemetryProvider>,
      );
      probeTrees.push(result.unmount);

      // The regression: registered + suppressesVanillaBase alone must NOT
      // report available — the Domain was never announced.
      expect(calls).toEqual([["fake-suppressing-base", false]]);
    });

    it("case 2: reports available=true once the augment's required Domain announces (vanilla base is suppressed)", async () => {
      const calls: Array<[string, boolean]> = [];
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);

      const result = render(
        <TelemetryProvider client={client}>
          <VanillaSuppressionProbe
            augment={{
              id: "fake-suppressing-base-2",
              augments: "map-view.base",
              requires: "test-suppress-domain-2",
              suppressesVanillaBase: true,
              component: () => null,
            }}
            onAvailableChange={(id, available) => calls.push([id, available])}
          />
        </TelemetryProvider>,
      );
      probeTrees.push(result.unmount);

      expect(calls).toEqual([["fake-suppressing-base-2", false]]);

      act(() => {
        transport.emit(
          "test-suppress-domain-2.available",
          { available: true },
          { quality: Quality.Loaded, source: "test-suppress-domain-2" },
        );
      });

      await waitFor(() => {
        expect(calls[calls.length - 1]).toEqual([
          "fake-suppressing-base-2",
          true,
        ]);
      });
    });
  });

  // Proves T10's read-back loop end to end: an augment's `settings` block
  // reaches the config UI via `AugmentSettingsPanel`, a saved edit lands in
  // the widget's persisted config namespaced by augment id, and a subsequent
  // render of the widget itself surfaces that value back on
  // `ctx.augmentSettings` — the same object `useCoverageGate` and any
  // augment's own settings already know how to read.
  describe("augment settings read-back", () => {
    afterEach(() => {
      for (const unmount of trees) unmount();
      trees.length = 0;
      clearAugments();
    });

    it("a config edit saved through AugmentSettingsPanel reads back on ctx.augmentSettings at render time", async () => {
      const user = userEvent.setup();
      registerAugment({
        id: "test-map-sections-settings",
        augments: "map-view.sections",
        component: (ctx: MapSectionsContext) => (
          <div data-testid="sections-settings-probe">
            show=
            {String(ctx.augmentSettings?.["test-map-sections-settings"]?.show)}
          </div>
        ),
        settings: [
          {
            key: "show",
            type: "boolean",
            label: "Show section",
            default: true,
          },
        ],
      });

      const onSave = vi.fn();
      render(
        <ModalChromeHost>
          <MapViewConfigComponent config={{}} onSave={onSave} />
        </ModalChromeHost>,
      );

      expect(
        screen.getByRole("checkbox", { name: "Show section" }),
      ).toBeChecked();
      await user.click(screen.getByRole("checkbox", { name: "Show section" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      const saved = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(
        (saved.augmentSettings as Record<string, Record<string, unknown>>)?.[
          "test-map-sections-settings"
        ]?.show,
      ).toBe(false);

      const { container, fixture } = renderMap(saved);
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!container.textContent?.includes("show=false")) {
          throw new Error(
            "sections augment has not read back the saved setting yet",
          );
        }
      });
    });
  });
});
