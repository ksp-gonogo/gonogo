/**
 * Shared helpers for multi-screen Playwright specs. Every widget-DOM
 * mirror test follows the same shape:
 *
 *   1. Seed both browser contexts with the test Sitrep stream endpoint
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
 * Don't add widget-specific logic here: keep this generic so a new
 * widget test is "import bootstrapPair; read DOM on both sides; assert".
 *
 * NOTE: station-side telemetry is currently a known gap: only the MAIN
 * screen mounts `SitrepTelemetryProvider` (see that file's own doc
 * comment: station stream forwarding over PeerJS is "a later task").
 * A spec whose station assertion depends on an actual telemetry VALUE
 * (not just static chrome) will not see it mirrored yet; that's an app
 * gap this harness surfaces rather than papers over.
 */
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";

function sitrepConfig(port: number = PORTS.sitrepReplay): string {
  return JSON.stringify({ host: "localhost", port });
}

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
 * layout (CurrentOrbit's diagram slot etc.): use `size` to override
 * for niche cases.
 */
export function dashboardWithWidget(
  componentId: string,
  opts: {
    i?: string;
    size?: { w: number; h: number };
    config?: Record<string, unknown>;
  } = {},
): { items: DashboardItem[]; layouts: Record<string, DashboardLayout[]> } {
  const i = opts.i ?? `widget-${componentId}`;
  const { w, h } = opts.size ?? { w: 8, h: 6 };
  const layoutAt = (cw: number) => [
    { i, x: 0, y: 0, w: Math.min(w, cw), h, moved: false, static: false },
  ];
  return {
    items: [
      { i, componentId, ...(opts.config ? { config: opts.config } : {}) },
    ],
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
  sitrepPort: number = PORTS.sitrepReplay,
): Promise<void> {
  const dashboardJson = JSON.stringify(dashboard);
  await context.addInitScript(
    ({
      sitrepCfg,
      dashboardKey,
      dashboard,
    }: {
      sitrepCfg: string;
      dashboardKey: string;
      dashboard: string;
    }) => {
      try {
        localStorage.setItem("gonogo.datasource.sitrep", sitrepCfg);
        localStorage.setItem(dashboardKey, dashboard);
        // Pre-answer the analytics consent so the main-screen boot modal
        // (blocking until answered) doesn't sit over the dashboard and
        // intercept clicks. "disabled" = answered + Axiom off.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
        // Mark the first-run setup auto-open as seen so it doesn't pop the
        // Settings modal over the dashboard on a fresh boot.
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode / quota: ignore; the seed just won't apply */
      }
    },
    {
      sitrepCfg: sitrepConfig(sitrepPort),
      dashboardKey,
      dashboard: dashboardJson,
    },
  );
}

/**
 * Wait for the host's PeerJS peer to open on the broker, then return its
 * stable SHARE CODE. Under the stable-host-id model the station derives
 * `gonogo-host-<code>` from this and connects directly: the broker-directory
 * resolve hop (and the host's id-rotation it worked around) are gone, so a
 * plain wait-for-open + return-the-code is all that's needed. The share code
 * is a 4-char `[A-Z0-9]` token; the host's peer id is the derived form.
 */
export async function getHostPeerId(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: { peerId?: string | null; shareCode?: string };
        };
        const svc = w.peerHostService;
        if (!svc) return null;
        // Peer must be open (peerId set) before the station tries to connect.
        if (typeof svc.peerId !== "string" || svc.peerId.length === 0) {
          return null;
        }
        const code = svc.shareCode;
        return typeof code === "string" && /^[A-Z0-9]{4,}$/.test(code)
          ? code
          : null;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

/**
 * Seed a remembered Uplink-consent grant for every id@version in the built
 * registry (`/uplinks/registry.local.json`), so a subsequent boot's runtime
 * loader reaches `import()` without the per-version consent modal. Same
 * mechanism as `uplink-loader.spec.ts`'s `seedConsent`: versions are derived
 * from the registry, never hand-coded. Granting every id is harmless: only the
 * ids named in `?uplinkLoaderIds=` actually load. Call after `goto` (needs a
 * same-origin document to fetch + set localStorage), then `reload`.
 */
async function seedUplinkConsent(page: Page): Promise<void> {
  const keys = await page.evaluate(async () => {
    const res = await fetch("/uplinks/registry.local.json");
    const index = (await res.json()) as {
      uplinks: { id: string; versions: { version: string }[] }[];
    };
    return index.uplinks.map((u) => `${u.id}@${u.versions[0].version}`);
  });
  await page.evaluate((granted) => {
    localStorage.setItem("gonogo.uplinkConsent", JSON.stringify(granted));
  }, keys);
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
 * function returns: typically `page.getByText("WIDGET-TITLE")
 * .toBeVisible()`. Don't make the predicate widget-specific in the
 * helper itself; let the spec supply it.
 */
export async function bootstrapPair(
  browser: Browser,
  componentId: string,
  opts: {
    waitForMain: (page: Page) => Promise<void>;
    waitForStation?: (page: Page) => Promise<void>;
    widget?: {
      i?: string;
      size?: { w: number; h: number };
      config?: Record<string, unknown>;
    };
    /**
     * Per-context overrides applied to both main and station. Use for
     * mobile testing: `{ viewport: { width: 375, height: 667 },
     * hasTouch: true }` triggers the MobileDashboard rendering path
     * (Dashboard/index.tsx:83: `if (isTouch) return <MobileDashboard
     * .../>;`). Without this every spec runs at the default desktop
     * viewport with no touch, so mobile-only sizing regressions (e.g.
     * the camera-feed 2x0.5 squish reported 2026-05-18) never surface
     * in CI.
     */
    contextOptions?: Parameters<Browser["newContext"]>[0];
    /**
     * Uplink ids the runtime loader should actually load, for specs testing a
     * widget PROVIDED BY an Uplink (mechjeb = MechJeb) or one whose data
     * comes from an Uplink feed (target-picker = kos). Default (omitted or
     * empty) = load NOTHING, the loader-agnostic boot every built-in-widget
     * spec wants. When set, both pages run against the PRODUCTION preview
     * server (the loader is build-time-only, see the boot comment below), boot
     * with `?uplinkLoaderIds=<ids>`, have consent pre-seeded (so no modal),
     * then reload so the loader runs with the grant in place. The station runs
     * its own loader (StationUplinkLoader) off the same query, so it loads the
     * widget too.
     */
    loadUplinkIds?: string[];
    /**
     * Which fake Sitrep replay server/port this pair points at. Default
     * `PORTS.sitrepReplay`: the shared snapshot every widget spec normally
     * runs against, deliberately WITHOUT `vessel.parts`/`dv.*` (see
     * sitrep-stream-server.mjs's doc comment). Pass
     * `PORTS.sitrepReplayTopology` for a spec that needs real topology/ΔV
     * data (power-systems, fuel-status): a SEPARATE server carrying those
     * extra topics on top of the same base snapshot, so the shared fixture
     * (and every absence-dependent assertion built on it) is untouched.
     */
    sitrepPort?: number;
  },
): Promise<BootstrappedPair> {
  const dashboard = dashboardWithWidget(componentId, opts.widget);
  const mainContext = await browser.newContext(opts.contextOptions);
  await seedContext(
    mainContext,
    "gonogo:dashboard:main",
    dashboard,
    opts.sitrepPort,
  );
  const stationContext = await browser.newContext(opts.contextOptions);
  await seedContext(
    stationContext,
    "gonogo:dashboard:station",
    dashboard,
    opts.sitrepPort,
  );

  // `?uplinkLoaderIds=<ids>` controls what the runtime Uplink loader loads at
  // boot. Default is EMPTY = load
  // nothing: these specs test widget rendering + the peer handshake, not the
  // loader, and without the override the per-Uplink consent modal ("Load
  // Uplink …?") covers the screen and `waitForMain` times out. `&` for the
  // station because `?host=` is already present.
  //
  // For specs whose widget comes FROM an Uplink (`loadUplinkIds`) we must load
  // that Uplink AND run against the PRODUCTION preview server: the loader is a
  // build-time mechanism (external-entry chunks + a baked import map exist only
  // in `vite build`), so the dev server can't `import()` the /public client
  // bundles. Point those specs at PREVIEW (same broker/relay env is baked in),
  // pre-seed consent, and reload so the loader runs with the grant in place.
  const loadIds = opts.loadUplinkIds ?? [];
  const loaderQuery = `uplinkLoaderIds=${loadIds.join(",")}`;
  const origin = loadIds.length > 0 ? `http://localhost:${PORTS.preview}` : "";

  const main = await mainContext.newPage();
  await main.goto(`${origin}${MAIN_URL}?${loaderQuery}`);
  if (loadIds.length > 0) {
    await seedUplinkConsent(main);
    await main.reload();
  }
  await opts.waitForMain(main);
  const peerId = await getHostPeerId(main);

  const station = await stationContext.newPage();
  await station.goto(`${origin}${STATION_URL}?host=${peerId}&${loaderQuery}`);
  if (loadIds.length > 0) {
    await seedUplinkConsent(station);
    await station.reload();
  }
  await (opts.waitForStation ?? opts.waitForMain)(station);

  return { mainContext, stationContext, main, station, peerId };
}

/**
 * Tear down a bootstrapped pair. Order matters, close pages before
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
    ({
      panelTitle,
      label,
      valuePatternSource,
      valuePatternFlags,
    }: {
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

/**
 * Waits until what a SIGHTED READER sees on the page contains `text`.
 *
 * A readout is no longer one text node: `<Unit>` renders the number, the
 * symbol, and a hidden word for screen readers as separate elements. So
 * `getByText("773.9 km", { exact: true })` finds nothing, and a raw
 * `textContent` check finds "773.9 km kilometres".
 *
 * This is the browser-side twin of `visibleText` in `@ksp-gonogo/test-utils`,
 * and it does the same two things: drop `[data-unit-word]`, and normalise the
 * thin space between a number and its symbol to an ordinary one. Which space
 * it is is a typographic detail; that it is a space is what the reader sees.
 */
export async function expectVisibleText(
  page: Page,
  text: string,
  timeout = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (needle: string) => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      for (const hidden of clone.querySelectorAll("[data-unit-word]")) {
        hidden.remove();
      }
      return (clone.textContent ?? "").replace(/ /g, " ").includes(needle);
    },
    text,
    { timeout, polling: 250 },
  );
}
