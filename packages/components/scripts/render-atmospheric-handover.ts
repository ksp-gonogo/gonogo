#!/usr/bin/env tsx
/**
 * Review renders for the atmosphere-interface handover (`cb5c1329a`).
 *
 * Seven readings of one Kerbin descent, each drawn six seconds after its last
 * packet, altitudes running 95 km down to 6 km through a published 70 km
 * interface. Above it a conic advances `vessel.flight.altitudeAsl`; below it
 * `atmospheric-reckoning.ts` integrates the observed vertical acceleration.
 *
 * ## What a picture of this can and cannot say
 *
 * It cannot name the model, and no render of this widget can: `LandingStatus`
 * never tells an operator which of the two carried the number, and the only
 * `ReckoningBasis` prose in the tree (`packages/ui/src/LineChart.tsx`) reaches
 * a chart's accessible name and nothing else. Nor can a chart draw the carried
 * altitude as a dashed tail: `TimelineStore.computeReckonedTail` breaks on
 * anything that is not a bare `number`, and every `vessel.flight` field is a
 * `Value`, so the tail is empty on every frame here, conic frames included.
 *
 * So the attribution is pinned by `handover-basis.test.tsx`, which asks the
 * real store which basis carried each fixture, and what these PNGs are for is
 * the OPERATOR'S view of the same seven frames: whether the board keeps
 * describing a descent across a boundary that used to be a hole, and what it
 * does at the two frames where the model withdraws.
 *
 * Run the BEFORE half by checking out `cb5c1329a^`'s sdk sources, rebuilding
 * `@ksp-gonogo/sitrep-sdk`, and passing `--out` so the two sets do not
 * overwrite each other. That is the only comparison that makes the handover
 * visible, since the widget draws the same board either way and only the
 * numbers differ.
 *
 * Deliberately NOT registered in `widgets.ts`, the reason
 * `render-reckoned-tail.ts` gives: that file is the visual gate's input and a
 * scene with no committed baseline fails it as MISSING.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-atmospheric-handover`.
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "landing-status",
    label: "landing-status/handover",
    slug: "landing-status-handover",
    fixturesPath: "LandingStatus/__render_handover__",
    outPath: "renders/atmospheric-handover",
    fullContent: true,
    modes: [{ name: "full-w12", w: 12, h: 16 }],
  },
];

/**
 * The packages whose `dist` carries the model these renders are evidence of.
 *
 * `packages/components` bundles from source; everything it imports resolves
 * through a built `dist`, and esbuild bundles whatever is there without a word.
 * The model here lives in `mod/sitrep-sdk/src/spine/atmospheric-reckoning.ts`,
 * so a stale sdk `dist` would produce seven entirely plausible pictures of the
 * PREVIOUS reckoner. Copied from `render-reckoned-tail.ts`, which learned it the
 * expensive way.
 */
const GUARDED_PACKAGES = [
  ["@ksp-gonogo/sitrep-sdk", resolve(HERE, "../../../mod/sitrep-sdk")],
  ["@ksp-gonogo/sitrep-client", resolve(HERE, "../../sitrep-client")],
  ["@ksp-gonogo/ui", resolve(HERE, "../../ui")],
] as const;

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

async function assertDistsAreCurrent(): Promise<void> {
  for (const [name, root] of GUARDED_PACKAGES) {
    const built = await newestMtime(join(root, "dist")).catch(() => null);
    if (built === null) {
      throw new Error(`${name} is not built. Run \`pnpm build\` first.`);
    }
    const source = await newestMtime(join(root, "src"));
    if (source > built) {
      throw new Error(
        `${name}/dist is older than its src: this render would show the ` +
          "previous model. Run `pnpm build` first.",
      );
    }
  }
}

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

assertDistsAreCurrent()
  .then(() => renderWidgets(CONFIGS, { outBase }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
