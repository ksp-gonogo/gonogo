import {
  clearAugments,
  clearBodies,
  clearRegistry,
  DashboardItemContext,
  registerAugment,
  registerDataSource,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  AugmentSettingsProvider,
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  ModalChromeContext,
  type ModalChromeValue,
  useAugmentSettings,
  useWidgetScope,
} from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import type { MapBaseLayerContext, MapOverlayContext } from "./index";
import { MapViewComponent, VanillaSuppressionProbe } from "./index";
import { MapViewConfigComponent } from "./MapViewConfig";

const MAP_VIEW_CHANNELS = [
  "vessel.flight",
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
] as const;

interface VesselScenario {
  lat?: number;
  lon?: number;
  altitude?: number;
  /** Parent body name, as `system.bodies` reports it: drives every body read. */
  body?: string;
  /** Mean radius the stream reports for it. Kerbin's unless a case says otherwise. */
  bodyRadius?: number;
  /** The nested atmosphere block; omitted entirely when a case does not set one. */
  atmosphere?: { depth: number };
}

/** The per-augment settings block of a widget config, or `undefined`. */
function augmentSettingsOf(
  config: Record<string, unknown> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const settings = config?.augmentSettings;
  return typeof settings === "object" && settings !== null
    ? (settings as Record<string, Record<string, unknown>>)
    : undefined;
}

describe("MapViewComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  // Unmount before the state-mutating teardown, which would otherwise re-render a mounted tree.
  const trees: Array<() => void> = [];
  let restoreResizeObserver: () => void = () => {};

  beforeEach(async () => {
    clearRegistry();
    clearBodies();
    registerStockBodies();

    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 600,
      height: 300,
    });

    source = new MockDataSource();
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    buffered.disconnect();
    restoreResizeObserver();
    vi.unstubAllGlobals();
    clearBodies();
  });

  /** Stand-in for `ModalDialog` chrome: renders the footer `useModalSaveBar` registers, so Save is reachable. */
  function ModalChromeHost({ children }: { children: ReactNode }) {
    const [footer, setFooter] = useState<ReactNode>(null);
    // Memoized like the real `ModalDialog`: an unstable `chrome` object loops forever against a config component's recreated onSave.
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

  /**
   * The provider pair the dashboard puts round every widget: the instance for
   * `useActionInput`, and the identity `Panel` resolves its universal
   * `sections` and `actions` slot ids from.
   */
  function Wrap({
    config,
    onConfigChange,
    children,
  }: {
    config?: Record<string, unknown>;
    onConfigChange?: (config: Record<string, unknown>) => void;
    children: ReactNode;
  }) {
    const augmentSettings = augmentSettingsOf(config);
    return (
      <WidgetMetaContext.Provider
        value={{ componentId: "map-view", contributionSlots: [] }}
      >
        <AugmentSettingsProvider
          settings={augmentSettings}
          setAugmentSetting={(augmentId, key, valueToSave) =>
            onConfigChange?.({
              ...config,
              augmentSettings: {
                ...augmentSettings,
                [augmentId]: {
                  ...augmentSettings?.[augmentId],
                  [key]: valueToSave,
                },
              },
            })
          }
        >
          <DashboardItemContext.Provider value={{ instanceId: "map-test" }}>
            {children}
          </DashboardItemContext.Provider>
        </AugmentSettingsProvider>
      </WidgetMetaContext.Provider>
    );
  }

  function renderMap(
    config: Record<string, unknown> = {},
    size?: { w: number; h: number },
    onConfigChange?: (config: Record<string, unknown>) => void,
  ) {
    const fixture = setupStreamFixture({
      carriedChannels: [...MAP_VIEW_CHANNELS],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const result = render(
      <fixture.Provider>
        <Wrap config={config} onConfigChange={onConfigChange}>
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

  /** Emit the vessel kinematics and body, then flush the provider's frames inside act. */
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
          bodies: [
            {
              index: 1,
              name: s.body,
              radius: s.bodyRadius ?? 600_000,
              ...(s.atmosphere ? { atmosphere: s.atmosphere } : {}),
            },
          ],
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

  /**
   * The imaging window comes from the body's radius and atmosphere off the
   * stream, not a stock table keyed by name. 100 km is inside Kerbin's window
   * and well below Earth's, so a Kerbin-sized window wearing Earth's name fails.
   */
  describe("a body the stock table has never heard of", () => {
    const EARTH = {
      body: "Earth",
      bodyRadius: 6_371_000,
      atmosphere: { depth: 140_000 },
    };

    it("calls 100 km too low for an Earth-sized body", async () => {
      const { fixture } = renderMap({}, { w: 14, h: 14 });
      await emitVessel(fixture, { ...EARTH, altitude: 100_000 });
      expect(await screen.findByText("TOO LOW")).toBeInTheDocument();
    });

    it("calls the same altitude imaging on Kerbin", async () => {
      const { fixture } = renderMap({}, { w: 14, h: 14 });
      await emitVessel(fixture, { body: "Kerbin", altitude: 100_000 });
      expect(await screen.findByText("IMAGING")).toBeInTheDocument();
    });

    it("images from an altitude that suits the body it actually reported", async () => {
      const { fixture } = renderMap({}, { w: 14, h: 14 });
      await emitVessel(fixture, { ...EARTH, altitude: 1_000_000 });
      expect(await screen.findByText("IMAGING")).toBeInTheDocument();
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
    await expectNoA11yViolations(container);
  }, 20000);

  // axe over the body picker is slow, so the a11y smoke gets a generous timeout.
  it("a11y smoke: config component (body picker + toggles) has no violations", async () => {
    const { container } = render(
      <MapViewConfigComponent config={{}} onSave={() => {}} />,
    );
    await expectNoA11yViolations(container);
  }, 20000);

  it("config body picker offers a Follow-vessel default and stock bodies", () => {
    render(<MapViewConfigComponent config={{}} onSave={() => {}} />);
    const select = screen.getByLabelText("Body") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(within(select).getByText("Follow vessel")).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Kerbin" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Mun" }),
    ).toBeInTheDocument();
  });

  it("config no longer offers per-scan-type coverage layer toggles (moved to the owning Uplink's own settings)", () => {
    render(<MapViewConfigComponent config={{}} onSave={() => {}} />);
    expect(screen.queryByText("Fog layers")).toBeNull();
    expect(screen.queryByText("Altimetry HiRes")).toBeNull();
  });

  // Throwaway augments prove the slots compose and pass their props, and that empty slots are inert.
  describe("augment slots", () => {
    // Runs before the outer afterEach, so the trees unmount before clearAugments() notifies them.
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
        const el = container.querySelector<HTMLElement>(
          '[data-testid="overlay-probe"]',
        );
        if (el === null)
          throw new Error("overlay augment has not rendered yet");
        return el;
      });
      // The map canvases still render beneath the overlay layer.
      expect(container.querySelectorAll("canvas").length).toBeGreaterThan(0);
      // The overlay received a real pixel width and a working `project` (numeric screen coordinates) as slot props.
      expect(visibleText(probe)).toMatch(/w=\d+ px=-?\d+ py=-?\d+/);
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
        const el = container.querySelector<HTMLElement>(
          '[data-testid="overlay-vessel-pos-probe"]',
        );
        if (el === null || !visibleText(el).includes("vesselLat=12.5"))
          throw new Error("overlay augment has not rendered vessel pos yet");
        return el;
      });
      expect(visibleText(probe)).toContain("vesselLat=12.5");
      expect(visibleText(probe)).toContain("vesselLon=-70");
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
        const el = container.querySelector<HTMLElement>(
          '[data-testid="overlay-anomaly-probe"]',
        );
        if (el === null)
          throw new Error("overlay augment has not rendered yet");
        return el;
      });
      expect(visibleText(probe)).toContain("vesselLat=undefined");
      expect(visibleText(probe)).toContain("vesselLon=undefined");
    });

    it("renders the map with the overlay slot empty when no augment is registered", async () => {
      const { container, fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      // The map still renders (canvases present) with nothing composed in.
      await waitFor(() => {
        if (container.querySelector("canvas") === null) {
          throw new Error("map has not rendered yet");
        }
      });
      expect(
        container.querySelector<HTMLElement>('[data-testid="overlay-probe"]'),
      ).toBeNull();
    });

    it("composes a fake map-view.sections augment below the map", async () => {
      // The mapped body reaches the augment through the widget's published scope; a universal segment carries no props.
      function SectionsAugment() {
        const bodyName = useWidgetScope("map-view")?.bodyName;
        return <div>Sections for {bodyName}</div>;
      }
      registerAugment({
        id: "test-map-sections",
        augments: "map-view.sections",
        component: SectionsAugment,
      });

      const { container, fixture } = renderMap();
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!visibleText(container).includes("Sections for Kerbin")) {
          throw new Error("sections augment has not rendered yet");
        }
      });
    });

    it("map-view.base: every registered augment mounts and can contribute a canvas, no single-pick gating", async () => {
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

    it("map-view.actions: a registered augment can toggle a base layer's show, writing the SAME augmentSettings the settings panel reads", async () => {
      // `useAugmentSettings` writes under the augment's own id, so a quick toggle and the settings checkbox are one value.
      function ToggleAugment() {
        const settings = useAugmentSettings("scan-layer");
        return (
          <button type="button" onClick={() => settings.set("show", false)}>
            Toggle scan layer
          </button>
        );
      }
      registerAugment({
        id: "test-map-actions",
        augments: "map-view.actions",
        component: ToggleAugment,
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

    it("map-view.actions reads the widget's current augmentSettings, the same values the settings panel reads", async () => {
      function ReadAugment() {
        const settings = useAugmentSettings("scan-layer");
        return (
          <div data-testid="actions-probe">
            show={String(settings.values.show)}
          </div>
        );
      }
      registerAugment({
        id: "test-map-actions-read",
        augments: "map-view.actions",
        component: ReadAugment,
      });

      const { container, fixture } = renderMap({
        augmentSettings: { "scan-layer": { show: false } },
      });
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!visibleText(container).includes("show=false")) {
          throw new Error("actions augment has not read back the setting yet");
        }
      });
    });
  });

  /*
   * Vanilla-base suppression must respect the same Domain-presence gate
   * `<AugmentSlot>` applies, not mere registration: a client bundle registers
   * its augments unconditionally. Tested on the probe directly because jsdom
   * cannot exercise the canvas paint; the pure combination is covered in
   * vanillaSuppression.test.ts.
   */
  describe("VanillaSuppressionProbe (regression guard: suppression must respect Domain availability)", () => {
    const probeTrees: Array<() => void> = [];
    afterEach(() => {
      for (const unmount of probeTrees) unmount();
      probeTrees.length = 0;
    });

    it("case 1: reports available=false while the augment's required Domain has not announced (vanilla base would still paint)", () => {
      const calls: Array<[string, boolean]> = [];
      // The gate reads ui-kit's availability store, so drive it store-first: an unannounced Domain reads unavailable.
      const store = createDomainAvailabilityStore();

      const result = render(
        <DomainAvailabilityContext.Provider value={store}>
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
        </DomainAvailabilityContext.Provider>,
      );
      probeTrees.push(result.unmount);

      // Registered with suppressesVanillaBase alone must not report available: the Domain was never announced.
      expect(calls).toEqual([["fake-suppressing-base", false]]);
    });

    it("case 2: reports available=true once the augment's required Domain announces (vanilla base is suppressed)", async () => {
      const calls: Array<[string, boolean]> = [];
      const store = createDomainAvailabilityStore();

      const result = render(
        <DomainAvailabilityContext.Provider value={store}>
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
        </DomainAvailabilityContext.Provider>,
      );
      probeTrees.push(result.unmount);

      expect(calls).toEqual([["fake-suppressing-base-2", false]]);

      act(() => store.setAvailable("test-suppress-domain-2", true));

      await waitFor(() => {
        expect(calls[calls.length - 1]).toEqual([
          "fake-suppressing-base-2",
          true,
        ]);
      });
    });
  });

  // An augment's `settings` reach the config UI, a saved edit lands namespaced by augment id, and the widget surfaces it back on `ctx.augmentSettings`.
  describe("augment settings read-back", () => {
    afterEach(() => {
      for (const unmount of trees) unmount();
      trees.length = 0;
      clearAugments();
    });

    it("a config edit saved through AugmentSettingsPanel reads back on the augment's own settings at render time", async () => {
      const user = userEvent.setup();
      function SettingsProbe() {
        const settings = useAugmentSettings("test-map-sections-settings");
        return (
          <div data-testid="sections-settings-probe">
            show={String(settings.values.show)}
          </div>
        );
      }
      registerAugment({
        id: "test-map-sections-settings",
        augments: "map-view.sections",
        component: SettingsProbe,
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
      const saved = onSave.mock.calls[0]?.[0];
      expect(
        augmentSettingsOf(saved)?.["test-map-sections-settings"]?.show,
      ).toBe(false);

      const { container, fixture } = renderMap(saved);
      await emitVessel(fixture, { body: "Kerbin" });

      await waitFor(() => {
        if (!visibleText(container).includes("show=false")) {
          throw new Error(
            "sections augment has not read back the saved setting yet",
          );
        }
      });
    });
  });
});
