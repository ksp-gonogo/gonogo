#!/usr/bin/env tsx
/**
 * Render every absence scene as a PAIR: the same widget, the same fixture, the
 * same tile, with and without one input.
 *
 * The pair is the deliverable rather than the degraded shot alone. A render of
 * a widget missing an input, on its own, is a picture somebody has to take on
 * trust: there is no way to see from it which figure went, or whether anything
 * did. Side by side the withholding is the only difference, so it is the only
 * thing there is to look at.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-absence [--out <dir>]`.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withoutChannel } from "../src/test/absenceScene";
import { ABSENCE_SCENES } from "../src/test/absenceScenes";
import { renderWidgets } from "./widgetRenderHarness";

const SRC = resolve(import.meta.dirname, "../src");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outBase =
    outFlag !== -1 && args[outFlag + 1]
      ? resolve(args[outFlag + 1])
      : resolve(import.meta.dirname, "../../../local_docs/renders/absence");
  const only = args.includes("--scene")
    ? args[args.indexOf("--scene") + 1]
    : undefined;

  mkdirSync(outBase, { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), "absence-scenes-"));
  try {
    // Every scene staged first and rendered in ONE call, so the run launches
    // one browser rather than one per scene.
    const configs = [];
    for (const scene of ABSENCE_SCENES) {
      if (only && scene.id !== only) continue;
      const fixture = JSON.parse(
        readFileSync(resolve(SRC, scene.fixture), "utf8"),
      );
      const dir = join(staging, scene.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${scene.id}--present.json`),
        JSON.stringify(fixture, null, 1),
      );
      writeFileSync(
        join(dir, `${scene.id}--missing.json`),
        JSON.stringify(withoutChannel(fixture, scene.channel), null, 1),
      );
      console.log(
        `${scene.id}: ${scene.widget} @ ${scene.mode.name}, without ${scene.channel}`,
      );
      configs.push({
        widgetId: scene.widget,
        label: scene.id,
        slug: scene.id,
        fixturesPath: dir,
        /* Its own directory per scene: the harness sweeps stale files out of
           each output directory, so one shared directory would leave only the
           last scene rendered. */
        outPath: scene.id,
        modes: [scene.mode],
        fullContent: true,
      });
    }
    await renderWidgets(configs, { outBase, fullContent: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`\nRenders under ${outBase}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
