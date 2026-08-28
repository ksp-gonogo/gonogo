#!/usr/bin/env tsx
/**
 * Render the Panel delay rail (`Panel.Delay`) at a set of hand-built handle
 * scenarios to PNGs under `local_docs/renders/delay-ux-v3/`. Exists because the
 * dashboard visual-gate probe does not mount `DelayRailProvider`, so the rail
 * is invisible in CI; this driver + `delay-rail-probe/` close that gap. Model
 * copied from `render-alarm-banner.ts` (same esbuild -> injected HTML ->
 * playwright screenshot pipeline).
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "delay-rail-probe");
const PROBE_ENTRY = join(PROBE_DIR, "delay-rail-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "delay-rail-probe.html");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/delay-ux-v3");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const VIEWPORT_W = 380;
const VIEWPORT_H = 360;

// Hand-built CommandDelayHandle scenarios. Plain data (no spine), the same
// shape `useCommand(...)` returns, so the rail draws exactly as it would for a
// real in-flight command.
// Noisier sample sets so the graph conveys VOLUME / activity, not a near-flat
// line (v3 round 6): the control input varies over the 3T axis the way a real
// hand-flown axis does.
const THROTTLE_STREAM = {
  id: "vessel.control.throttle",
  label: "Throttle",
  oneWaySeconds: 1.6,
  inTransit: [
    { age: 0, value: 0.44 },
    { age: 0.6, value: 0.61 },
    { age: 1.2, value: 0.53 },
    { age: 1.9, value: 0.7 },
    { age: 2.6, value: 0.58 },
    { age: 3.4, value: 0.74 },
    { age: 4.2, value: 0.63 },
    { age: 4.8, value: 0.67 },
  ],
  echo: [
    { age: 3.0, value: 0.5 },
    { age: 3.6, value: 0.63 },
    { age: 4.2, value: 0.55 },
    { age: 4.8, value: 0.64 },
  ],
  current: 0.44,
};
const PITCH_STREAM = {
  id: "vessel.control.pitch",
  label: "Pitch",
  oneWaySeconds: 1.6,
  inTransit: [
    { age: 0, value: 0.5 },
    { age: 0.6, value: 0.41 },
    { age: 1.2, value: 0.56 },
    { age: 1.9, value: 0.47 },
    { age: 2.6, value: 0.6 },
    { age: 3.4, value: 0.49 },
    { age: 4.2, value: 0.54 },
    { age: 4.8, value: 0.46 },
  ],
  echo: [
    { age: 3.0, value: 0.5 },
    { age: 3.6, value: 0.58 },
    { age: 4.2, value: 0.74 },
    { age: 4.8, value: 0.8 },
  ],
  current: 0.5,
};

const SCENARIOS: ReadonlyArray<{
  name: string;
  panelTitle: string;
  handles: unknown[];
}> = [
  {
    name: "01-resting-empty-queue",
    panelTitle: "NAVBALL",
    // Delay set but nothing in flight: the rail renders null (no motion when
    // the queue is empty). This is the resting baseline.
    handles: [{ inFlight: [], shape: "discrete", effectiveDelaySeconds: 6 }],
  },
  {
    name: "02-discrete-single-in-flight",
    panelTitle: "TARGET",
    handles: [
      {
        inFlight: [
          {
            id: "c0",
            label: "Set target",
            command: "vessel.target.set",
            glyph: "TGT",
            reachEtaSeconds: 2,
            replyEtaSeconds: 8,
            predictedPhase: "in-transit",
          },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 6,
      },
    ],
  },
  {
    name: "04-continuous-stream-in-flight",
    panelTitle: "NAVBALL",
    // A fly-by-wire axis in flight: the v3 ControlDelayStream at the 16px rail
    // size (mini, no labels), grown to full graph + labels when pinned. Two
    // axes on one graph, one diverging in the confirmed zone.
    handles: [
      {
        inFlight: [],
        shape: "stream",
        effectiveDelaySeconds: 1.6,
        streams: [THROTTLE_STREAM, PITCH_STREAM],
      },
    ],
  },
  {
    name: "03-discrete-multiple-in-flight",
    panelTitle: "NAVBALL",
    // Several discrete commands: their grazing glows sit at their own progress
    // positions along the top edge collapsed, and stack as a list when grown.
    handles: [
      {
        inFlight: [
          {
            id: "c1",
            label: "SAS Prograde",
            command: "vessel.control.setSasMode",
            glyph: "PRO",
            reachEtaSeconds: -2,
            replyEtaSeconds: 4,
            predictedPhase: "in-transit",
          },
          {
            id: "c2",
            label: "RCS on",
            command: "vessel.control.setRcs",
            glyph: "RCS",
            reachEtaSeconds: 5,
            replyEtaSeconds: 11,
            predictedPhase: "awaiting-reply",
          },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 3,
      },
    ],
  },
  {
    name: "05-combined-discrete-and-stream",
    panelTitle: "NAVBALL",
    // Both kinds in flight at once: a discrete handle (two commands) AND a
    // stream handle. Collapsed, the grazing glows and the mini sparkline share
    // the one 16px band; grown, they stack as list + full graph.
    handles: [
      {
        inFlight: [
          {
            id: "d1",
            label: "SAS Prograde",
            command: "vessel.control.setSasMode",
            glyph: "PRO",
            reachEtaSeconds: -3,
            replyEtaSeconds: 3,
            predictedPhase: "awaiting-reply",
          },
          {
            id: "d2",
            label: "Stage",
            command: "vessel.staging.activate",
            glyph: "STG",
            reachEtaSeconds: 4,
            replyEtaSeconds: 10,
            predictedPhase: "in-transit",
          },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 3,
      },
      {
        inFlight: [],
        shape: "stream",
        effectiveDelaySeconds: 1.6,
        streams: [THROTTLE_STREAM],
      },
    ],
  },
  {
    name: "06-discrete-failed-overdue-lost",
    panelTitle: "NAVBALL",
    // Failed commands: an amber overdue and a red lost. Each square keeps the
    // command's own glyph; the lost/overdue square is a real clear button.
    handles: [
      {
        inFlight: [
          {
            id: "f1",
            label: "SAS Prograde",
            command: "vessel.control.setSasMode",
            glyph: "PRO",
            reachEtaSeconds: 0,
            replyEtaSeconds: 1,
            predictedPhase: "overdue",
          },
          {
            id: "f2",
            label: "SAS Retrograde",
            command: "vessel.control.setSasMode",
            glyph: "RET",
            reachEtaSeconds: null,
            replyEtaSeconds: null,
            predictedPhase: "lost",
          },
          {
            id: "f3",
            label: "RCS on",
            command: "vessel.control.setRcs",
            glyph: "RCS",
            reachEtaSeconds: -1,
            replyEtaSeconds: 5,
            predictedPhase: "awaiting-reply",
          },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 3,
      },
    ],
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  console.log("Bundling delay-rail-probe-entry with esbuild…");
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
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-delay-rail driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./delay-rail-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-delay-rail-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      deviceScaleFactor: 2,
      // Capture the settled grown state, not a mid-transition frame: the rail's
      // grow honours prefers-reduced-motion (transition: none), so the pinned
      // shot shows the full content deterministically. The transition itself is
      // exercised for real (non-reduced-motion) users.
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
      () =>
        typeof (window as unknown as { __renderDelayRail?: unknown })
          .__renderDelayRail === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const scenario of SCENARIOS) {
      await page.evaluate(
        (payload) =>
          (
            window as unknown as {
              __renderDelayRail: (p: unknown) => Promise<void>;
            }
          ).__renderDelayRail(payload),
        {
          handles: scenario.handles,
          panelTitle: scenario.panelTitle,
          pxW: VIEWPORT_W,
          pxH: VIEWPORT_H,
        },
      );
      // Park the cursor away from the top rail so a stationary pointer left over
      // from the previous scenario's click cannot hover-open the float in this
      // scenario's COLLAPSED shot.
      await page.mouse.move(VIEWPORT_W / 2, VIEWPORT_H - 10);
      await page.waitForTimeout(80);

      const outName = `${scenario.name}.png`;
      await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
      console.log(`  ${outName}`);

      // Where a rail exists, also click it to pin the detail float open and
      // capture that (the collapsed strip alone does not show the v3 float).
      const railBtn = await page.$("[data-panel-rail]");
      if (railBtn) {
        await railBtn.click();
        // Past the grow transition (--duration-slow) plus settle, so the fully
        // grown height (and every stacked pill) is captured, not a mid-animation
        // frame.
        await page.waitForTimeout(600);
        const pinnedName = `${scenario.name}-pinned.png`;
        await page.screenshot({
          path: join(OUT_DIR, pinnedName),
          fullPage: false,
        });
        console.log(`  ${pinnedName}`);
      }
    }
    console.log(`\nRendered ${SCENARIOS.length} delay-rail shots → ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

/** The theme sheet whole, checked to be the tokens file. The border-box reset
 *  the kit's primitives are drawn against sits outside the `:root` block. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function cleanArtifacts(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".png")) continue;
    await rm(join(dir, e.name));
    removed++;
  }
  if (removed > 0) console.log(`Cleaned ${removed} stale PNG(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
