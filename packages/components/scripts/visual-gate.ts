#!/usr/bin/env tsx
/**
 * Per-engine visual regression gate.
 *
 * Renders every widget (fixture × mode) for ONE browser engine via the shared
 * harness, then compares each render against its committed baseline under
 * `packages/components/visual-baselines/<engine>/`. The model is per-engine
 * (each engine vs its OWN baseline), never cross-engine — engines legitimately
 * rasterise differently, so only a same-engine threshold is defensible.
 *
 *   visual-gate --engine firefox            # gate: diff vs baselines, fail on drift
 *   visual-gate --engine firefox --update   # accept: (re)write baselines from renders
 *   visual-gate --engine firefox --widget thermal-status   # scope to one widget
 *
 * Baselines MUST be generated in the same OS the gate runs in (CI Linux) —
 * font rasterisation differs across OSes. Use the `update-baselines` GitHub
 * workflow to (re)generate them on the runner and commit them back.
 *
 * On drift the gate writes `baseline / actual / diff` PNGs for each failing
 * render into `local_docs/renders/_visual-gate-diffs/` (gitignored) so CI can
 * upload them as an artifact for review.
 *
 * Run via `pnpm --filter @ksp-gonogo/components visual-gate …`.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffRatio, writeDiff } from "./crossBrowserComposite";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";
import { getWidget, listWidgets } from "./widgets";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_ROOT = resolve(HERE, "../visual-baselines");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const ACTUAL_ROOT = resolve(LOCAL_DOCS, "renders/_visual-gate");
const DIFF_OUT = resolve(LOCAL_DOCS, "renders/_visual-gate-diffs");

// Same-engine, same-OS, fixed-clock renders are deterministic, so the
// steady-state diff is ~0. A small non-zero ceiling absorbs incidental
// antialiasing jitter without letting a real regression through. Ratio, not a
// fixed pixel count, so it scales with widget size.
const ALLOWED_RATIO = 0.002;

const ENGINES = ["chromium", "firefox", "webkit"] as const;
type Engine = (typeof ENGINES)[number];

function usage(): never {
  console.error(
    "Usage: visual-gate --engine <chromium|firefox|webkit> [--update] [--widget <id>]",
  );
  process.exit(1);
}

/** Baselines drop the `renders/` prefix the widget outPath carries so the tree
 *  reads `visual-baselines/<engine>/<widget>-widget/…`. */
function baselineDirFor(engine: Engine, config: WidgetRenderConfig): string {
  return resolve(
    BASELINE_ROOT,
    engine,
    config.outPath.replace(/^renders\//, ""),
  );
}

interface Failure {
  widget: string;
  name: string;
  kind: "drift" | "missing-baseline";
  ratio?: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const engineIdx = args.indexOf("--engine");
  const engine = engineIdx !== -1 ? args[engineIdx + 1] : undefined;
  if (!engine || !ENGINES.includes(engine as Engine)) usage();
  const update = args.includes("--update");
  const widgetIdx = args.indexOf("--widget");
  const widgetId = widgetIdx !== -1 ? args[widgetIdx + 1] : undefined;

  const configs = widgetId
    ? [getWidget(widgetId)].filter((c): c is WidgetRenderConfig => Boolean(c))
    : [...listWidgets()];
  if (configs.length === 0) {
    console.error(widgetId ? `Unknown widget id: ${widgetId}` : "No widgets");
    process.exit(1);
  }

  const actualBase = resolve(ACTUAL_ROOT, engine);
  // Render every widget for this engine into an isolated, gitignored dir.
  // outSuffix stays empty — the engine is encoded in the directory, not the
  // filename, so baseline filenames match across engines.
  await renderWidgets(configs, {
    engine: engine as Engine,
    outSuffix: "",
    outBase: actualBase,
  });

  if (update) {
    let written = 0;
    for (const config of configs) {
      const actualDir = resolve(actualBase, config.outPath);
      const baselineDir = baselineDirFor(engine as Engine, config);
      const renders = await pngFiles(actualDir);
      // Guard against wiping a widget's baselines when a render unexpectedly
      // produces nothing (e.g. renderOneWidget returns without throwing on a
      // missing fixtures dir). Skip the wholesale replace rather than delete
      // good baselines and repopulate with nothing.
      if (renders.length === 0) {
        console.warn(
          `  ! ${config.widgetId}: 0 renders produced — leaving baselines untouched.`,
        );
        continue;
      }
      // Replace the widget's baseline dir wholesale so renders that are no
      // longer produced (renamed fixtures/modes) don't leave orphans behind.
      await rm(baselineDir, { recursive: true, force: true });
      await mkdir(baselineDir, { recursive: true });
      for (const file of renders) {
        await cp(join(actualDir, file), join(baselineDir, file));
        written++;
      }
    }
    console.log(`✓ Updated ${written} ${engine} baseline(s).`);
    return;
  }

  // Gate mode.
  // Bootstrap escape hatch: if this engine has no committed baselines at all,
  // the gate hasn't been established yet — pass with a loud warning rather
  // than fail every render as "missing baseline". This keeps `main` green on
  // first land (so the deploy pipeline runs) until `update-baselines` commits
  // the first set. Once ANY baseline exists, a missing one for a new widget is
  // a real failure again.
  if (!(await hasAnyBaseline(engine as Engine))) {
    console.warn(
      `⚠ No ${engine} baselines committed yet — skipping the visual gate.\n` +
        `  Establish them with: gh workflow run update-baselines.yml --ref ` +
        `${process.env.GITHUB_REF_NAME ?? "<branch>"}`,
    );
    return;
  }
  await rm(DIFF_OUT, { recursive: true, force: true });
  const failures: Failure[] = [];
  let compared = 0;
  for (const config of configs) {
    const actualDir = resolve(actualBase, config.outPath);
    const baselineDir = baselineDirFor(engine as Engine, config);
    const baselineNames = new Set(await pngFiles(baselineDir));
    for (const file of await pngFiles(actualDir)) {
      const actualPath = join(actualDir, file);
      const baselinePath = join(baselineDir, file);
      if (!baselineNames.has(file)) {
        failures.push({
          widget: config.widgetId,
          name: file,
          kind: "missing-baseline",
        });
        continue;
      }
      compared++;
      const ratio = await diffRatio(actualPath, baselinePath);
      if (ratio > ALLOWED_RATIO) {
        const outDir = resolve(DIFF_OUT, engine, config.widgetId);
        await mkdir(outDir, { recursive: true });
        const stem = file.replace(/\.png$/, "");
        await cp(baselinePath, join(outDir, `${stem}.baseline.png`));
        await cp(actualPath, join(outDir, `${stem}.actual.png`));
        await writeDiff(
          baselinePath,
          actualPath,
          join(outDir, `${stem}.diff.png`),
        );
        failures.push({
          widget: config.widgetId,
          name: file,
          kind: "drift",
          ratio,
        });
      }
    }
  }

  console.log(
    `\n${engine}: compared ${compared} render(s) against baselines ` +
      `(threshold ${(ALLOWED_RATIO * 100).toFixed(2)}%).`,
  );
  if (failures.length === 0) {
    console.log(`✓ No visual drift.`);
    return;
  }

  console.error(`\n✗ ${failures.length} visual difference(s):`);
  for (const f of failures) {
    console.error(
      f.kind === "missing-baseline"
        ? `  MISSING baseline: ${f.widget}/${f.name}`
        : `  DRIFT ${((f.ratio ?? 0) * 100).toFixed(2)}%: ${f.widget}/${f.name}`,
    );
  }
  const ref = process.env.GITHUB_REF_NAME ?? "<branch>";
  console.error(
    `\nIf these changes are intended, regenerate the baselines on CI:\n` +
      `    gh workflow run update-baselines.yml --ref ${ref}` +
      (widgetId ? ` -f widget=${widgetId}` : "") +
      `\n(diff images written to local_docs/renders/_visual-gate-diffs/ — ` +
      `uploaded as a CI artifact on failure).`,
  );
  process.exit(1);
}

/** PNG filenames in a directory; empty if the directory doesn't exist. */
async function pngFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".png"));
  } catch {
    return [];
  }
}

/** True if any `.png` baseline exists anywhere under this engine's baseline
 *  tree — used to detect the not-yet-bootstrapped state. */
async function hasAnyBaseline(engine: Engine): Promise<boolean> {
  try {
    const all = await readdir(resolve(BASELINE_ROOT, engine), {
      recursive: true,
    });
    return all.some((f) => f.endsWith(".png"));
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
