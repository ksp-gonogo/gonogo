#!/usr/bin/env tsx
/**
 * Review renders for the stretch of a chart nobody measured.
 *
 * The real `Graph`, mounted on the real stream, plotting `vessel.state`'s own
 * Kepler model across a silence: no `reckoned` prop is fed to anything here.
 * The samples stop at UT 280 and the frame is drawn for UT 900, so the dashed
 * tail exists only because `TimelineStore.sampleReckonedTail` produced it and
 * `useDataSeries` joined it on. That is the difference between this and
 * `render-chart-provenance.ts`, which hand-feeds `LineChart` because when it
 * was written there was no producer to drive it.
 *
 * Two scenes one field apart: the second adds `VesselOrbit.encounter`, so the
 * model withdraws at the patch boundary and the tail stops there. A controlled
 * comparison rather than two drawings of two datasets.
 *
 * Deliberately NOT registered in `widgets.ts`, the same reasoning
 * `render-affordability.ts` gives: that file is the visual gate's input, and a
 * scene added to it with no committed baseline fails the gate as MISSING.
 * These exist to be looked at by a person.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-reckoned-tail`. Pass
 * `--out <dir>` to write somewhere other than this checkout's `local_docs`.
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "graph",
    label: "graph-reckoned-tail",
    slug: "graph-reckoned-tail",
    fixturesPath: "Graph/__render_reckoned__",
    outPath: "renders/reckon-feed",
    modes: (() => {
      const speed = {
        windowSec: 900,
        variant: "chart",
        yUnit: "m/s",
        series: [
          {
            id: "speed",
            key: "vessel.state.orbitalSpeed",
            label: "Orbital speed",
            type: "line",
            axis: "primary",
          },
        ],
      };
      return [
        { name: "default-12x9", w: 12, h: 9, config: speed },
        { name: "wide-18x5", w: 18, h: 5, config: speed },
      ];
    })(),
  },
];

/**
 * The packages whose `dist` carries the producer this render is evidence of.
 *
 * `packages/components` bundles from source, but everything it imports resolves
 * through a built `dist`, and esbuild bundles whatever is there without a word.
 * `render-chart-provenance.ts` learned this the expensive way: its first run
 * produced an entirely plausible picture of the PREVIOUS chart's rules, and it
 * was caught by someone knowing which run should be dashed rather than by
 * anything in the tooling. A render that predates the change it is offered as
 * evidence of is the failure a picture is least able to show you, and it is
 * cheap to detect, so it is detected.
 */
const GUARDED_PACKAGES = [
  ["@ksp-gonogo/sitrep-sdk", resolve(HERE, "../../../mod/sitrep-sdk")],
  ["@ksp-gonogo/sitrep-client", resolve(HERE, "../../sitrep-client")],
  ["@ksp-gonogo/data", resolve(HERE, "../../data")],
  ["@ksp-gonogo/ui", resolve(HERE, "../../ui")],
] as const;

async function assertDistsAreCurrent(): Promise<void> {
  for (const [name, root] of GUARDED_PACKAGES) {
    const distDir = join(root, "dist");
    const built = await newestMtime(distDir).catch(() => null);
    if (built === null) {
      throw new Error(`${name} is not built. Run \`pnpm build\` first.`);
    }
    const source = await newestMtime(join(root, "src"));
    if (source > built) {
      throw new Error(
        `${name}/dist is older than its src: this render would show the ` +
          "previous producer. Run `pnpm build` first.",
      );
    }
  }
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory()
        ? await newestMtime(path)
        : (await stat(path)).mtimeMs,
    );
  }
  return newest;
}

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

assertDistsAreCurrent()
  .then(() => renderWidgets(CONFIGS, { fullContent: true, outBase }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
