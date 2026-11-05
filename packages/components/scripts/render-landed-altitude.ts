#!/usr/bin/env tsx
/**
 * Review render for the altitude graph of a craft sitting on the Mun.
 *
 * The real `Graph` on the real stream, plotting `vessel.flight`'s altitude
 * above sea level for a craft that publishes a fresh free-fall orbit every
 * second. Run before and after a change to `TimelineStore.gapModel` to see
 * whether the chart draws a model path the craft never took.
 *
 * Deliberately not registered in `widgets.ts`: that file is the visual gate's
 * input, and a scene added to it with no committed baseline fails the gate.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-landed-altitude`. Pass
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
    label: "graph-landed-altitude",
    slug: "graph-landed-altitude",
    fixturesPath: "Graph/__render_landed__",
    outPath: "renders/landed-altitude",
    modes: [
      {
        name: "default-12x9",
        w: 12,
        h: 9,
        config: {
          windowSec: 120,
          variant: "chart",
          yUnit: "m",
          series: [
            {
              id: "asl",
              key: "vessel.flight.altitudeAsl",
              label: "Altitude (sea level)",
              type: "line",
              axis: "primary",
            },
          ],
        },
      },
    ],
  },
];

/**
 * The packages whose `dist` carries the producer this render is evidence of.
 *
 * `packages/components` bundles from source, but everything it imports resolves
 * through a built `dist`, and esbuild bundles whatever is there without a word.
 * `render-chart-provenance.ts` learned this the expensive way: its first run
 * produced an entirely plausible picture of the previous chart's rules, and it
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
