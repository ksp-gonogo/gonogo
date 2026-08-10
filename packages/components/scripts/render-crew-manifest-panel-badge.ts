#!/usr/bin/env tsx
/**
 * Render CrewManifest's WIDGET-LEVEL panel badges to a PNG under
 * `local_docs/renders/crew-manifest-panel-badge/`, the header chips two
 * SEPARATE `crew-manifest.badges` contributions drop into the panel chrome:
 * the base widget's own info-tone "N/M aboard" headcount
 * (`src/CrewManifest/badge.ts`, `crewAboardBadge`) and the Kerbalism
 * Uplink's nogo-tone "N crew critical" danger badge
 * (`mod/GonogoKerbalismUplink/client/src/CrewSurvival/badge.ts`). Both are
 * registered against the SAME automatic slot and coexist (info is
 * unconditional, nogo only fires once a kerbal crosses into the critical
 * band), so this fixture (crew-critical) exercises both at once.
 *
 * The shared widget probe (`scripts/probe/probe-entry.tsx`, used for every
 * other widget's review render and the visual-gate baselines) deliberately
 * never mounts `PanelBadgesProvider`, so no widget's panel badge shows up
 * there. This is a dedicated probe (`crew-badge-probe/`), same esbuild ->
 * injected HTML -> playwright pipeline as `render-provenance-card.ts`, that
 * wires the real app's badge-composition chain (`WidgetMetaContext` ->
 * `ContributionsProvider` -> `useWidgetBadges` -> `PanelBadgesProvider` ->
 * `Panel`, see `crew-badge-probe-entry.tsx`'s own doc comment) around the
 * real `CrewManifestComponent`, so the PNG shows exactly what the dashboard
 * would render, not a hand-built mock.
 *
 * Replays the existing crew-critical fixture
 * (`src/CrewManifest/__render_kerbalism_survival__/crew-critical.json`,
 * already used for the per-row survival render) so the two renders describe
 * the SAME vessel state: Jebediah at 94% radiation and Bill's 240s death
 * clock both cross the "nogo" threshold, so the header reads "2 crew
 * critical" alongside the per-row badges/meters, plus the "3/4 aboard" info
 * chip from the crew count itself.
 *
 * The tile is rendered WIDE (`PANEL_PX_W` below) rather than at the
 * `defaultSize` 6x8's actual grid width: `Panel`'s header runs a measured-fit
 * collapse (`usePanelAsideSize`/`PanelHeader` in ui-kit's `Panel.tsx`) that
 * hides the aside behind a dots+chevron summary the moment title + both
 * badges don't fit inline side by side, and that collapsed summary reflects
 * `useStatusBreakdown()` (stream/alarm severity), a completely SEPARATE
 * signal from badge content, so a collapsed shot of this fixture shows an
 * empty chevron even though both badges are genuinely present in state. This
 * render exists to show badge CONTENT, so it uses a width both badges
 * actually fit at, the same as an operator would see on a sufficiently wide
 * tile; the collapse behavior itself is real dashboard behavior, not
 * something to work around in the component.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
import type { CrewBadgeProbePayload } from "./crew-badge-probe/crew-badge-probe-entry";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "crew-badge-probe");
const PROBE_ENTRY = join(PROBE_DIR, "crew-badge-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "crew-badge-probe.html");
const OUT_DIR = resolve(
  HERE,
  "../../../local_docs/renders/crew-manifest-panel-badge",
);
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const FIXTURE_PATH = resolve(
  HERE,
  "../src/CrewManifest/__render_kerbalism_survival__/crew-critical.json",
);

// Wide enough for "CREW" + both badges ("3/4 ABOARD" info + "2 CREW
// CRITICAL" nogo) to sit inline in the header without tripping the
// measured-fit collapse (see this file's own top comment). Verified against
// the real Panel header chain, not guessed: 260px (the widget's actual 6x8
// grid-formula width) collapses both away, 420px does not.
const PANEL_PX_W = 420;
const PANEL_PX_H = 320;
const VIEWPORT_W = 460;
const VIEWPORT_H = 420;

// Same rationale as `widgetRenderHarness.ts`'s own copy: a real `.css`
// import (from a transitive dependency) must not break the esbuild bundle,
// even though nothing this probe imports today has one. Kept for parity so
// this script degrades the same way the shared harness would if that changed.
const cssSideEffectPlugin: Plugin = {
  name: "css-side-effect",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => {
      const resolvedPath = require.resolve(args.path, {
        paths: [args.resolveDir],
      });
      return { path: resolvedPath, sideEffects: true };
    });
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      return {
        loader: "js",
        contents: `const __style = document.createElement("style");
__style.textContent = ${JSON.stringify(css)};
document.head.appendChild(__style);`,
      };
    });
  },
};

interface FixtureEmit {
  channel: string;
  value: unknown;
  meta?: unknown;
}

interface FixtureFile {
  _stream: {
    carriedChannels: string[];
    pinnedUt?: number;
    emits: FixtureEmit[];
  };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  const fixture: FixtureFile = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

  console.log("Bundling crew-badge-probe-entry with esbuild…");
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
    plugins: [cssSideEffectPlugin],
  });
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(PROBE_HTML_TEMPLATE, "utf8");
  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      /<style id="probe-theme">[\s\S]*?<\/style>/,
      () => `<style id="probe-theme">${fontFace}${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./crew-badge-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-crew-badge-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      deviceScaleFactor: 2,
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
        typeof (window as unknown as { __renderCrewBadgeProbe?: unknown })
          .__renderCrewBadgeProbe === "function",
      undefined,
      { timeout: 10_000 },
    );

    // `w`/`h` (6x8, the widget's `defaultSize`) still gate the roster branch
    // so per-row badges/meters render; the PIXEL box is wider than that
    // grid size would actually render at (`PANEL_PX_W`, see this file's own
    // top comment) specifically so both header badges stay inline instead
    // of collapsing behind the dots+chevron summary.
    const payload: CrewBadgeProbePayload = {
      carriedChannels: fixture._stream.carriedChannels,
      pinnedUt: fixture._stream.pinnedUt,
      emits: fixture._stream.emits,
      w: 6,
      h: 8,
      pxW: PANEL_PX_W,
      pxH: PANEL_PX_H,
    };

    await page.evaluate(
      (p) =>
        (
          window as unknown as {
            __renderCrewBadgeProbe: (payload: typeof p) => Promise<void>;
          }
        ).__renderCrewBadgeProbe(p),
      payload,
    );
    const outName = "crew-manifest-panel-badge-crew-critical.png";
    await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
    console.log(`  ${outName}`);
    console.log(`\nRendered crew-manifest panel badge -> ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

/** Inline JetBrains Mono as a data-URI @font-face so the file:// render uses
 *  the locked font deterministically, matching the app's self-hosted face.
 *  Verbatim copy of `widgetRenderHarness.ts`'s own helper; not exported from
 *  there, and small enough that duplicating it here (as `render-provenance-
 *  card.ts` already does for its own helpers) is simpler than exporting a
 *  new shared surface for one caller. */
async function jetbrainsMonoFontFace(): Promise<string> {
  const regular = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  );
  const bold = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2",
  );
  const b64 = async (p: string) => (await readFile(p)).toString("base64");
  return `
    @font-face{font-family:"JetBrains Mono";font-weight:400;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(regular)}) format("woff2");}
    @font-face{font-family:"JetBrains Mono";font-weight:700;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(bold)}) format("woff2");}
  `;
}

function extractRootBlock(css: string): string {
  const m = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!m) throw new Error("tokens.css: no :root block found");
  return m[0];
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
