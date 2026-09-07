#!/usr/bin/env tsx
/**
 * Render the `Console` composition across its prop states to PNGs.
 *
 * Run: `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-console-matrix.ts`
 * Output: local_docs/renders/console-states/ (CONSOLE_RENDER_OUT overrides).
 *
 * `Console` is a ui-kit primitive with no widget id, so nothing in the widget
 * harness reaches it. Same esbuild -> injected HTML -> playwright pipeline as
 * `render-delay-rail.ts`, driving `console-matrix-probe/`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "console-matrix-probe");
const PROBE_ENTRY = join(PROBE_DIR, "console-matrix-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "console-matrix-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const OUT_DIR =
  process.env.CONSOLE_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/console-states");

const PX_W = 460;
const PX_H = 340;

/** Prose in the scrollback, so the surface is never blank. */
const LOG = [
  "Kennedy Flight: Ares, Kennedy. Go for the burn.",
  "Jeb: Copy Kennedy, going for the burn.",
  "Kennedy Flight: Reading you five by five.",
];

/** One thing crossing. */
const ONE_OUT = [
  {
    id: "m1",
    label: "Ares, hold at the mark",
    etaSeconds: 187,
    phase: "in-transit" as const,
  },
];

/** Three things crossing, at three different phases. */
const THREE_OUT = [
  {
    id: "m1",
    label: "Ares, hold at the mark",
    etaSeconds: 187,
    phase: "in-transit" as const,
  },
  {
    id: "m2",
    label: "Confirm tank two isolated",
    etaSeconds: 41,
    phase: "awaiting-reply" as const,
  },
  {
    id: "m3",
    label: "Abort the roll programme",
    etaSeconds: null,
    phase: "lost" as const,
  },
];

interface Scenario {
  name: string;
  /** Everything after `panelTitle` goes straight onto the Console. */
  payload: Record<string, unknown>;
  pxH?: number;
}

const SCENARIOS: Scenario[] = [
  {
    // No delay reading at all: `oneWaySeconds` never passed. The foot holds the
    // composer and nothing else.
    name: "01-no-delay-composer",
    payload: { panelTitle: "CONSOLE", composer: "bar", lines: LOG },
  },
  {
    // `null` is NO PATH, and gets neither reading even with things crossing.
    name: "02-delay-null-inflight",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: null,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // A measured zero is a link with no delay to report: also neither reading.
    name: "03-delay-zero-inflight",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 0,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // Short enough that `currentMode` says "live": the standing chip, and the
    // queue stays away even though something is crossing.
    name: "04-short-delay-badge",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 0.4,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // Past a second the countdown is the reading: the strip, no chip.
    name: "05-long-delay-strip-one-item",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    name: "06-long-delay-strip-three-items",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      inFlight: THREE_OUT,
      composer: "bar",
      lines: LOG,
    },
    pxH: 400,
  },
  {
    // Long delay, nothing crossing: `inFlight` is an EMPTY array, so the strip
    // is asked for and renders null.
    name: "07-long-delay-empty-inflight",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      inFlight: [],
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // The same, with NO composer: the foot exists only because the strip asked
    // for it, and the strip draws nothing.
    name: "08-long-delay-empty-inflight-no-composer",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      inFlight: [],
      composer: "omitted",
      lines: LOG,
    },
  },
  {
    // A read-only console at a long delay: neither reading.
    name: "09-long-delay-cannot-queue",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      canQueue: false,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // Forced chip at a long separation (character mode).
    name: "10-always-badge-long-delay",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      alwaysBadge: true,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // Composer OMITTED: no foot at all.
    name: "11-composer-omitted",
    payload: { panelTitle: "CONSOLE", composer: "omitted", lines: LOG },
  },
  {
    // Composer GIVEN but falsy: the foot stays, empty.
    name: "12-composer-given-but-falsy",
    payload: { panelTitle: "CONSOLE", composer: "falsy", lines: LOG },
  },
  {
    // `inFlight` never passed at all, at a long delay: no strip, no foot beyond
    // the composer.
    name: "13-long-delay-no-inflight-prop",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // FROZEN, no path: the queue outlives the live reading it was drawn from.
    name: "14-frozen-delay-null-inflight",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: null,
      inFlight: ONE_OUT,
      inFlightFrozenAtDispatch: true,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // FROZEN, short delay: the chip wins, and the queue is still not drawn.
    name: "15-frozen-short-delay",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 0.4,
      inFlight: ONE_OUT,
      inFlightFrozenAtDispatch: true,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // FROZEN, long delay, cannot queue: the presentation is "none" and the
    // frozen queue draws anyway.
    name: "16-frozen-long-delay-cannot-queue",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 240,
      canQueue: false,
      inFlight: ONE_OUT,
      inFlightFrozenAtDispatch: true,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // FROZEN, measured zero: "none" again, so the frozen queue draws.
    name: "17-frozen-delay-zero",
    payload: {
      panelTitle: "CONSOLE",
      oneWaySeconds: 0,
      inFlight: ONE_OUT,
      inFlightFrozenAtDispatch: true,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    // The `info` tone, which is the one thing the two consoles in the app
    // differ on visually: the composer's border and prompt glyph.
    name: "18-tone-info-long-delay-strip",
    payload: {
      panelTitle: "CONSOLE",
      tone: "info",
      oneWaySeconds: 240,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
  {
    name: "19-tone-info-short-delay-badge",
    payload: {
      panelTitle: "CONSOLE",
      tone: "info",
      oneWaySeconds: 0.4,
      inFlight: ONE_OUT,
      composer: "bar",
      lines: LOG,
    },
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Bundling console-matrix-probe-entry with esbuild...");
  const bundleResult = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text" },
  });
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(PROBE_HTML_TEMPLATE, "utf8");
  const theme = await readFile(THEME_TOKENS_CSS, "utf8");
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const html = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-console-matrix driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./console-matrix-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-console-matrix-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, html, "utf8");

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: PX_W, height: PX_H },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error")
        console.error("  [console error]", msg.text());
    });
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => typeof window.__renderConsoleMatrix === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const scenario of SCENARIOS) {
      const pxH = scenario.pxH ?? PX_H;
      await page.setViewportSize({ width: PX_W, height: pxH });
      await page.evaluate((payload) => window.__renderConsoleMatrix(payload), {
        ...scenario.payload,
        pxW: PX_W,
        pxH,
      } as never);
      await page.waitForTimeout(120);
      const outName = `${scenario.name}.png`;
      await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
      /*
       * The foot's own height, printed beside the shot. Three of these states
       * come out pixel-identical while their DOM differs, and a picture cannot
       * show a band whose background matches the surface above it.
       */
      const measured = await page.evaluate(() => {
        const frame = document.querySelector("[data-console-frame]");
        const foot = frame?.lastElementChild as HTMLElement | undefined;
        const surface = frame?.firstElementChild as HTMLElement | undefined;
        return {
          children: frame?.children.length ?? 0,
          footH:
            frame && foot && foot !== surface
              ? Math.round(foot.getBoundingClientRect().height)
              : null,
          surfaceH: surface
            ? Math.round(surface.getBoundingClientRect().height)
            : null,
        };
      });
      console.log(
        `  ${outName.padEnd(46)} frame children=${measured.children} surface=${measured.surfaceH}px foot=${measured.footH ?? "none"}`,
      );
    }
  } finally {
    await browser.close();
  }
  console.log(`\nWrote ${SCENARIOS.length} renders to ${OUT_DIR}`);
}

declare global {
  interface Window {
    __renderConsoleMatrix: (payload: unknown) => Promise<void>;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
