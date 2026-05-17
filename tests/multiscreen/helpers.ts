/**
 * Shared helpers for multi-screen Playwright specs. Every widget-DOM
 * mirror test follows the same shape:
 *
 *   1. Seed both browser contexts with the test Telemachus endpoint
 *      AND a dashboard config that places the widget under test on
 *      the grid (so we don't have to drive the FAB/modal click chain).
 *   2. Open the main page, wait for the widget to render, grab the
 *      host's peer id.
 *   3. Open the station page with `?host=<id>`, wait for the widget
 *      to render.
 *   4. Read the rendered value on each side, assert they match.
 *
 * `bootstrapPair` runs steps 1-3 and returns the open pages so the
 * spec can do the widget-specific reads.
 *
 * Don't add widget-specific logic here — keep this generic so a new
 * widget test is "import bootstrapPair; read DOM on both sides; assert".
 */
import { type Browser, type BrowserContext, type Page, expect } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";

const TELEMACHUS_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.telemachusReplay,
});

export interface DashboardItem {
  i: string;
  componentId: string;
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  moved: boolean;
  static: boolean;
}

/**
 * Build a dashboard config containing a single widget under `componentId`.
 * The default 8×6 footprint is large enough for any widget's rich
 * layout (CurrentOrbit's diagram slot etc.) — use `size` to override
 * for niche cases.
 */
export function dashboardWithWidget(
  componentId: string,
  opts: { i?: string; size?: { w: number; h: number }; config?: Record<string, unknown> } = {},
): { items: DashboardItem[]; layouts: Record<string, DashboardLayout[]> } {
  const i = opts.i ?? `widget-${componentId}`;
  const { w, h } = opts.size ?? { w: 8, h: 6 };
  const layoutAt = (cw: number) => [
    { i, x: 0, y: 0, w: Math.min(w, cw), h, moved: false, static: false },
  ];
  return {
    items: [{ i, componentId, ...(opts.config ? { config: opts.config } : {}) }],
    layouts: {
      lg: layoutAt(12),
      md: layoutAt(10),
      sm: layoutAt(8),
      xs: layoutAt(6),
      xxs: layoutAt(4),
    },
  };
}

export async function seedContext(
  context: BrowserContext,
  dashboardKey: "gonogo:dashboard:main" | "gonogo:dashboard:station",
  dashboard: ReturnType<typeof dashboardWithWidget>,
): Promise<void> {
  const dashboardJson = JSON.stringify(dashboard);
  await context.addInitScript(
    ({ teleCfg, dashboardKey, dashboard }: {
      teleCfg: string;
      dashboardKey: string;
      dashboard: string;
    }) => {
      try {
        localStorage.setItem("gonogo.datasource.telemachus", teleCfg);
        localStorage.setItem(dashboardKey, dashboard);
      } catch {
        /* private mode / quota — ignore; the seed just won't apply */
      }
    },
    {
      teleCfg: TELEMACHUS_CONFIG,
      dashboardKey,
      dashboard: dashboardJson,
    },
  );
}

/**
 * Wait for the host's PeerJS open event AND for the id to be stable for
 * ≥500 ms. The local broker can hold a stale id from a prior test run,
 * which would cause the host to auto-rotate; grabbing the first id we
 * see would race with that rotation.
 */
export async function getHostPeerId(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: {
            peerId?: string | null;
            __lastIdSeen?: string | null;
            __lastIdSeenAt?: number;
          };
        };
        const svc = w.peerHostService;
        if (!svc) return null;
        const id = svc.peerId;
        if (typeof id !== "string" || !/^[A-Z0-9]{4,}$/.test(id)) {
          svc.__lastIdSeen = null;
          return null;
        }
        if (svc.__lastIdSeen !== id) {
          svc.__lastIdSeen = id;
          svc.__lastIdSeenAt = Date.now();
          return null;
        }
        if (Date.now() - (svc.__lastIdSeenAt ?? 0) >= 500) return id;
        return null;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

export interface BootstrappedPair {
  mainContext: BrowserContext;
  stationContext: BrowserContext;
  main: Page;
  station: Page;
  peerId: string;
}

/**
 * Boot main + station with the same widget seeded on both dashboards.
 * `waitFor` is a per-page predicate that must succeed before the
 * function returns — typically `page.getByText("WIDGET-TITLE")
 * .toBeVisible()`. Don't make the predicate widget-specific in the
 * helper itself; let the spec supply it.
 */
export async function bootstrapPair(
  browser: Browser,
  componentId: string,
  opts: {
    waitForMain: (page: Page) => Promise<void>;
    waitForStation?: (page: Page) => Promise<void>;
    widget?: { i?: string; size?: { w: number; h: number }; config?: Record<string, unknown> };
  },
): Promise<BootstrappedPair> {
  const dashboard = dashboardWithWidget(componentId, opts.widget);
  const mainContext = await browser.newContext();
  await seedContext(mainContext, "gonogo:dashboard:main", dashboard);
  const stationContext = await browser.newContext();
  await seedContext(stationContext, "gonogo:dashboard:station", dashboard);

  const main = await mainContext.newPage();
  await main.goto(MAIN_URL);
  await opts.waitForMain(main);
  const peerId = await getHostPeerId(main);

  const station = await stationContext.newPage();
  await station.goto(`${STATION_URL}?host=${peerId}`);
  await (opts.waitForStation ?? opts.waitForMain)(station);

  return { mainContext, stationContext, main, station, peerId };
}

/**
 * Tear down a bootstrapped pair. Order matters — close pages before
 * contexts so Playwright reports clean shutdown.
 */
export async function teardownPair(pair: BootstrappedPair): Promise<void> {
  await pair.main.close();
  await pair.station.close();
  await pair.mainContext.close();
  await pair.stationContext.close();
}

/**
 * Read the value cell adjacent to a label inside the panel whose title
 * text equals `panelTitle`. Looks for an element with text matching
 * `valuePattern` *after* the label in DOM order.
 *
 * The widgets render `<Label>X</Label><Value>…</Value>` pairs inside a
 * grid; this walks `nextElementSibling` from the label until it finds
 * a match. Use this for grid-laid-out widgets like CurrentOrbit. For
 * widgets with a single readout (CommSignal headline, etc.) just
 * `page.getByText` directly.
 */
export async function readPanelLabelValue(
  page: Page,
  opts: { panelTitle: string; label: string; valuePattern: RegExp },
): Promise<string> {
  const handle = await page.waitForFunction(
    ({ panelTitle, label, valuePatternSource, valuePatternFlags }: {
      panelTitle: string;
      label: string;
      valuePatternSource: string;
      valuePatternFlags: string;
    }) => {
      const valuePattern = new RegExp(valuePatternSource, valuePatternFlags);
      const titles = Array.from(document.querySelectorAll("*")).filter(
        (el) => el.textContent?.trim() === panelTitle,
      );
      for (const title of titles) {
        const panel = title.parentElement;
        if (!panel) continue;
        const labels = Array.from(panel.querySelectorAll("*")).filter(
          (el) => el.textContent?.trim() === label,
        );
        if (labels.length === 0) continue;
        let cursor: Element | null = labels[0].nextElementSibling;
        while (cursor) {
          const txt = cursor.textContent?.trim() ?? "";
          if (valuePattern.test(txt)) return txt;
          cursor = cursor.nextElementSibling;
        }
      }
      return null;
    },
    {
      panelTitle: opts.panelTitle,
      label: opts.label,
      valuePatternSource: opts.valuePattern.source,
      valuePatternFlags: opts.valuePattern.flags,
    },
    { timeout: 30_000, polling: 250 },
  );
  return await handle.jsonValue();
}

export { expect };
