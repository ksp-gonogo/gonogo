/**
 * Stage entry for the README's hero: the app's own react-grid-layout dashboard,
 * mounted on a saved layout, with every widget reading one shared stream that
 * replays the committed flight.
 *
 * The dashboard is the app's `Dashboard` driven by its `useDashboardState`
 * against a saved layout in `localStorage`, so the tiles are placed, clipped and
 * headed exactly as they are on a screen. The only thing standing in for the
 * game is the stream: a `setupStreamFixture` store the replay writes to.
 */
import "./probe-install-host";
import {
  getComponent,
  getDataSource,
  registerDataSource,
  registerStockBodies,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import {
  DomainAvailabilityProvider,
  defaultDarkTheme,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import {
  SerialDeviceProvider,
  SerialDeviceService,
} from "../../../serial/dist/index.js";
import "../../src";
import { Dashboard } from "../../../app/src/components/Dashboard";
import { useDashboardState } from "../../../app/src/components/Dashboard/useDashboardState";
import { MissionBanner } from "../../../app/src/components/MissionBanner";
import { SettingsProvider, SettingsService } from "../../../app/src/settings";
import { AugmentAvailabilityFeeder } from "../../../app/src/telemetry/AugmentAvailabilityFeeder";
import { KspCalendarObserver } from "../../../app/src/telemetry/KspCalendarObserver";
import { AlarmsLauncherProvider } from "../../src/shared/AlarmsLauncher";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";
import type { HeroFrame } from "../heroFlightWire";
import "./uplinkClients";

registerStockBodies();

export interface HeroItem {
  i: string;
  componentId: string;
  config?: Record<string, unknown>;
}

export interface HeroLayoutEntry {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HeroSpec {
  /** Width of the page the dashboard lays out in, which picks its breakpoint and column width. */
  width: number;
  /** Height of the picture. */
  height: number;
  items: HeroItem[];
  /** The saved layout at the 36-column breakpoint. */
  layout: HeroLayoutEntry[];
  /** `today` keeps every piece of the screen's chrome; `clean` hides the drag bar of each tile and the strip above the grid. */
  chrome: "today" | "clean";
  frames: HeroFrame[];
  /** The first UT, which pins the view clock before anything arrives. */
  startUt: number;
}

declare global {
  interface Window {
    __hero: {
      mount: (spec: HeroSpec) => Promise<void>;
      /** Replays every frame up to and including `index`, then waits for the paint. */
      seek: (index: number) => Promise<void>;
    };
  }
}

const STORAGE_KEY = "gonogo:dashboard:main";

/**
 * What a render-only stylesheet needs to take the screen's chrome away the way
 * a screen with its tile headers and top strip hidden looks: the drag bar and
 * its buttons go, resize grips go, the tiles keep their panel edges.
 */
const CLEAN_CHROME = `
  .dashboard-grid .drag-handle { display: none !important; }
  .dashboard-grid .react-resizable-handle { display: none !important; }
`;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let root: Root | null = null;
const serialService = new SerialDeviceService({ screenKey: "main" });
const settingsService = new SettingsService();
let stream: StreamFixture | null = null;
let frames: HeroFrame[] = [];
let replayed = -1;

const noopAlarm = {
  launcher: () => {},
  creator: () => {},
  manager: { find: () => null, remove: () => {} },
};

/** The saved layout the app's own hook reads, through the app's own storage key. */
function SavedDashboard({ chrome }: { chrome: HeroSpec["chrome"] }) {
  const dashboard = useDashboardState(STORAGE_KEY, { items: [], layouts: {} });
  return (
    <main
      aria-label="Mission control"
      style={{
        padding: "var(--gutter-screen)",
        background: "var(--color-surface-app)",
        minHeight: "100%",
      }}
    >
      {chrome === "today" ? <MissionBanner /> : null}
      <Dashboard
        items={dashboard.items}
        layouts={dashboard.layouts}
        currentLayouts={dashboard.currentLayouts}
        breakpoint={dashboard.breakpoint}
        onLayoutChange={dashboard.handleLayoutChange}
        onBreakpointChange={dashboard.handleBreakpointChange}
        updateItemConfig={dashboard.updateItemConfig}
        updateItemMappings={dashboard.updateItemMappings}
        updateItemMobileWidth={dashboard.updateItemMobileWidth}
        updateItemMobileHeight={dashboard.updateItemMobileHeight}
        removeItem={dashboard.removeItem}
        moveItemUp={dashboard.moveItemUp}
        moveItemDown={dashboard.moveItemDown}
        lastAddedId={dashboard.lastAddedId}
        clearLastAdded={dashboard.clearLastAdded}
      />
    </main>
  );
}

function emitFrame(frame: HeroFrame): void {
  if (!stream) throw new Error("Hero: nothing mounted");
  stream.scrubTo(frame.ut);
  for (const line of frame.lines) {
    stream.emit(line.topic, line.payload, {
      validAt: line.meta.validAt,
      deliveredAt: line.meta.deliveredAt,
      quality: line.meta.quality,
    } as never);
  }
}

window.__hero = {
  async mount(spec) {
    const host = document.getElementById("root");
    if (!host) throw new Error("Hero: #root missing");
    root?.unmount();
    host.replaceChildren();
    host.style.width = `${spec.width}px`;
    host.style.height = `${spec.height}px`;
    host.style.overflow = "hidden";
    host.style.background = "var(--color-surface-app)";
    const chromeStyle = document.getElementById("hero-chrome");
    if (chromeStyle)
      chromeStyle.textContent = spec.chrome === "clean" ? CLEAN_CHROME : "";
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        items: spec.items,
        layouts: { lg: spec.layout },
      }),
    );
    for (const item of spec.items) {
      if (!getComponent(item.componentId))
        throw new Error(`Hero: widget "${item.componentId}" is not registered`);
    }
    // The guard on every tile asks for a connected `sitrep` source before it draws anything.
    if (!getDataSource("sitrep")) {
      const sitrep = new MockDataSource({ id: "sitrep", keys: [] });
      registerDataSource(sitrep);
      await sitrep.connect();
    }
    frames = spec.frames;
    replayed = -1;
    stream = setupStreamFixture({ pinnedUt: spec.startUt });
    const { Provider } = stream;
    if (document.fonts?.load) {
      await Promise.all([
        document.fonts.load('400 1em "JetBrains Mono"'),
        document.fonts.load('700 1em "JetBrains Mono"'),
      ]);
      await document.fonts.ready;
    }
    root = createRoot(host);
    root.render(
      <ThemeProvider theme={defaultDarkTheme}>
        <Provider>
          <DomainAvailabilityProvider>
            <AugmentAvailabilityFeeder />
            <KspCalendarObserver />
            <ScreenProvider value="main">
              <ModalProvider>
                <SettingsProvider service={settingsService}>
                  <SerialDeviceProvider service={serialService}>
                    <AlarmsLauncherProvider {...noopAlarm}>
                      <SavedDashboard chrome={spec.chrome} />
                    </AlarmsLauncherProvider>
                  </SerialDeviceProvider>
                </SettingsProvider>
              </ModalProvider>
            </ScreenProvider>
          </DomainAvailabilityProvider>
        </Provider>
      </ThemeProvider>,
    );
    // Let every widget subscribe, then give the first frame twice: a topic a widget subscribes to only once an earlier one has landed would otherwise miss it.
    for (let i = 0; i < 12; i++) await nextFrame();
    await settle(300);
    emitFrame(frames[0]);
    await settle(150);
    emitFrame(frames[0]);
    replayed = 0;
    await settle(300);
  },
  async seek(index) {
    if (index < replayed) throw new Error("Hero: a replay only moves forward");
    for (let i = replayed + 1; i <= index; i++) emitFrame(frames[i]);
    replayed = index;
    await nextFrame();
    await nextFrame();
    await settle(40);
  },
};
