/**
 * A main screen and its stations replaying one recorded flight, and the check
 * that they all show the same thing at the same moment.
 *
 * Only the main screen reads the recording, through `wire-replay-server.mjs`
 * on its real WebSocket path; every station gets the flight from the main
 * over the real peer path. The replay moves only when a spec calls
 * `replay.advanceTo`, so between two calls every screen has been sent the same
 * frames and a reading taken then is a reading of one instant.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import { getHostPeerId, seedApprovedStation } from "./helpers";

const REPLAY_URL = `http://localhost:${PORTS.wireReplay}`;

export interface ReplayWidget {
  componentId: string;
  /** The dashboard item id, and so the `data-i` the widget is found by. Defaults to the component id. */
  i?: string;
  size?: { w: number; h: number };
  config?: Record<string, unknown>;
}

export interface ReplayState {
  fixture: string | null;
  cursorMs: number;
  durationMs: number;
  clients: number;
}

/** Steps the recording the main screen reads. */
export interface ReplayControl {
  /** Sends every frame up to `ms` after the recording's first frame. */
  advanceTo(ms: number): Promise<ReplayState>;
  state(): Promise<ReplayState>;
}

export interface Screen {
  name: string;
  context: BrowserContext;
  page: Page;
}

export interface MissionControl {
  replay: ReplayControl;
  /** The main screen first, then each station. */
  screens: Screen[];
  main: Page;
  stations: Page[];
  close(): Promise<void>;
}

async function postReplay(path: string, body: unknown): Promise<ReplayState> {
  const res = await fetch(`${REPLAY_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as ReplayState;
}

const replay: ReplayControl = {
  advanceTo: (ms) => postReplay("/replay/advance", { toMs: ms }),
  state: async () =>
    (await (await fetch(`${REPLAY_URL}/replay/state`)).json()) as ReplayState,
};

function dashboardOf(widgets: readonly ReplayWidget[]) {
  let y = 0;
  const items = [];
  const layout = [];
  for (const widget of widgets) {
    const i = widget.i ?? widget.componentId;
    const { w, h } = widget.size ?? { w: 9, h: 6 };
    items.push({
      i,
      componentId: widget.componentId,
      ...(widget.config ? { config: widget.config } : {}),
    });
    layout.push({ i, x: 0, y, w, h, moved: false, static: false });
    y += h;
  }
  return JSON.stringify({ items, layout });
}

/* The scene comes off the recording's `game-state`, and each scene keeps its own layout, so the base and the flight slot are both seeded. */
async function seedScreen(
  context: BrowserContext,
  screen: "main" | "station",
  dashboard: string,
): Promise<void> {
  await context.addInitScript(
    ({ keys, dashboard, sitrep }) => {
      try {
        for (const key of keys) localStorage.setItem(key, dashboard);
        localStorage.setItem("gonogo.datasource.sitrep", sitrep);
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode / quota: the seed just won't apply */
      }
    },
    {
      keys: [`gonogo:dashboard:${screen}`, `gonogo:dashboard:${screen}:Flight`],
      dashboard,
      sitrep: JSON.stringify({ port: PORTS.wireReplay }),
    },
  );
  await seedApprovedStation(context);
}

async function waitForWidgets(
  page: Page,
  widgets: readonly ReplayWidget[],
): Promise<void> {
  for (const widget of widgets) {
    await page
      .locator(`[data-i="${widget.i ?? widget.componentId}"]`)
      .waitFor({ state: "visible", timeout: 30_000 });
  }
}

/**
 * Loads `fixture` (a wire recording, relative to the repo root), plays it to
 * `startMs`, and boots a main screen and `stations` stations with `widgets` on
 * every dashboard. The stations connect once the main has the recording's
 * opening frames, as they would join a flight in progress.
 */
export async function bootMissionControl(
  browser: Browser,
  opts: {
    fixture: string;
    widgets: readonly ReplayWidget[];
    stations?: number;
    startMs?: number;
  },
): Promise<MissionControl> {
  await postReplay("/replay/load", { fixture: opts.fixture });
  await replay.advanceTo(opts.startMs ?? 0);

  const dashboard = dashboardOf(opts.widgets);
  const screens: Screen[] = [];

  const mainContext = await browser.newContext();
  await seedScreen(mainContext, "main", dashboard);
  const main = await mainContext.newPage();
  screens.push({ name: "main", context: mainContext, page: main });
  await main.goto("/?uplinkLoaderIds=");
  await waitForWidgets(main, opts.widgets);
  const shareCode = await getHostPeerId(main);

  for (let n = 1; n <= (opts.stations ?? 2); n++) {
    const context = await browser.newContext();
    await seedScreen(context, "station", dashboard);
    const page = await context.newPage();
    screens.push({ name: `station ${n}`, context, page });
    await page.goto(`/station?host=${shareCode}&uplinkLoaderIds=`);
    await waitForWidgets(page, opts.widgets);
  }

  return {
    replay,
    screens,
    main,
    stations: screens.slice(1).map((screen) => screen.page),
    close: async () => {
      for (const screen of screens) await screen.context.close();
    },
  };
}

/**
 * How current a figure is drawn as: `live` is a reading of now, `held` the
 * last reading kept past its time, `modelled` a figure worked out rather than
 * read.
 */
export type FigureState = "live" | "held" | "modelled";

/** One figure as an operator reads it off the screen. */
export interface ShownFigure {
  /** The visible text, without the words only a screen reader hears. */
  text: string;
  state: FigureState;
}

/** A widget as one screen shows it: its figures and every reckoning mark it draws, in DOM order. */
export interface WidgetView {
  present: boolean;
  figures: ShownFigure[];
  /** Each mark's kind (`held`, `modelled`, `current`, with `/elsewhere` for the hollow form), and `held-hatch` or `modelled-alongside` for those drawings. */
  marks: string[];
}

/** Reads the widget with dashboard id `i` off `page`. */
export async function readWidget(page: Page, i: string): Promise<WidgetView> {
  return await page.evaluate((id) => {
    const root = document.querySelector(`[data-i="${id}"]`);
    if (!root) return { present: false, figures: [], marks: [] };
    const figures = [...root.querySelectorAll("[data-figure]")]
      .filter((el) => el.querySelector("[data-figure]") === null)
      .map((el) => {
        const clone = el.cloneNode(true) as Element;
        for (const hidden of clone.querySelectorAll("[data-unit-word]")) {
          hidden.remove();
        }
        const text = (clone.textContent ?? "")
          .replace(/[   ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const reckoned = el.closest("[data-reckoned]");
        const state = reckoned
          ? reckoned.getAttribute("data-reckoned")
          : el.closest("[data-held]")
            ? "held"
            : "live";
        return { text, state: state as "live" | "held" | "modelled" };
      });
    const marks = [
      ...root.querySelectorAll(
        "[data-reckoning-mark], [data-held-hatch], [data-modelled-alongside]",
      ),
    ].map((el) => {
      const kind = el.getAttribute("data-reckoning-mark");
      if (kind === null) {
        return el.hasAttribute("data-held-hatch")
          ? "held-hatch"
          : "modelled-alongside";
      }
      return el.hasAttribute("data-elsewhere") ? `${kind}/elsewhere` : kind;
    });
    return { present: true, figures, marks };
  }, i);
}

function describeFigure(figure: ShownFigure | undefined): string {
  return figure ? `"${figure.text}" (${figure.state})` : "nothing";
}

/**
 * Every way each station's view differs from the main screen's, one line
 * each, naming the screen and the figure. Empty when they all agree.
 */
export function diffViews(
  views: readonly { name: string; view: WidgetView }[],
): string[] {
  const [main, ...stations] = views;
  const lines: string[] = [];
  for (const { name, view } of stations) {
    if (view.present !== main.view.present) {
      lines.push(
        `${name}: widget ${view.present ? "shown" : "missing"}, ${main.name}: ${main.view.present ? "shown" : "missing"}`,
      );
      continue;
    }
    const count = Math.max(view.figures.length, main.view.figures.length);
    for (let n = 0; n < count; n++) {
      const ours = view.figures[n];
      const theirs = main.view.figures[n];
      if (ours?.text === theirs?.text && ours?.state === theirs?.state) {
        continue;
      }
      lines.push(
        `${name}: figure ${n + 1} is ${describeFigure(ours)}, ${main.name} shows ${describeFigure(theirs)}`,
      );
    }
    if (view.marks.join(",") !== main.view.marks.join(",")) {
      lines.push(
        `${name}: marks [${view.marks.join(", ")}], ${main.name}: [${main.view.marks.join(", ")}]`,
      );
    }
  }
  return lines;
}

/**
 * Waits until every screen shows widget `i` with the same figures, in the
 * same states, with the same marks, and throws with the differences if they
 * have not agreed within `timeout`. A screen that is still catching up passes
 * once it arrives; one that settles on something else fails.
 *
 * Also fails when the main screen draws no figure at all, since screens that
 * agree on an empty widget prove nothing. Pass `allowEmpty` for a case where
 * that is the point.
 */
export async function expectScreensAgree(
  mc: Pick<MissionControl, "screens" | "replay">,
  i: string,
  opts: { timeout?: number; allowEmpty?: boolean } = {},
): Promise<WidgetView> {
  const deadline = Date.now() + (opts.timeout ?? 10_000);
  for (;;) {
    const views = await Promise.all(
      mc.screens.map(async ({ name, page }) => ({
        name,
        view: await readWidget(page, i),
      })),
    );
    const differences = diffViews(views);
    const empty = !opts.allowEmpty && views[0].view.figures.length === 0;
    if (differences.length === 0 && !empty) return views[0].view;
    if (Date.now() > deadline) {
      const { cursorMs } = await mc.replay.state();
      const shown = views
        .map(
          ({ name, view }) =>
            `  ${name}: ${view.figures.map(describeFigure).join(" | ") || "no figures"}; marks [${view.marks.join(", ")}]`,
        )
        .join("\n");
      throw new Error(
        [
          `screens disagree on "${i}" at replay ${cursorMs} ms:`,
          ...(empty ? [`  ${views[0].name} shows no figures`] : []),
          ...differences.map((line) => `  ${line}`),
          "shown:",
          shown,
        ].join("\n"),
      );
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}
