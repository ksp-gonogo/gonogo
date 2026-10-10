/**
 * Renders a widget twice exactly as the visual gate does (same harness, same pinned clock and reduced motion) and fails unless every picture is byte-for-byte the same both times.
 *
 * The gate's baselines are only worth comparing against if the gate draws the same picture twice. A widget that animates (the Landing Status sea, drawn on a canvas off `performance.now`) holds that only while the pinned clock really reaches its drawing, so this is the check that it does.
 *
 *   visual-repeatability --engine chromium --widget landing-status
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listUplinkWidgets } from "./uplinkWidgets";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

const ENGINES = ["chromium", "firefox", "webkit"] as const;

async function pngs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await pngs(path)));
      continue;
    }
    if (entry.name.endsWith(".png")) out.push(path);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const named = args[args.indexOf("--engine") + 1];
  const engine = ENGINES.find((e) => e === named);
  const widgetId = args[args.indexOf("--widget") + 1];
  if (!engine || !widgetId || args.indexOf("--widget") < 0) {
    console.error(
      "usage: visual-repeatability --engine <chromium|firefox|webkit> --widget <id>",
    );
    process.exit(2);
  }
  const configs = [...listWidgets(), ...(await listUplinkWidgets())].filter(
    (c) => c.widgetId === widgetId || c.label === widgetId,
  );
  if (configs.length === 0) {
    console.error(`Unknown widget id: ${widgetId}`);
    process.exit(2);
  }

  const root = resolve(tmpdir(), `visual-repeatability-${process.pid}`);
  const runs = [join(root, "first"), join(root, "second")];
  try {
    for (const outBase of runs) {
      await renderWidgets(configs, { engine, outSuffix: "", outBase });
    }
    const first = (await pngs(runs[0])).map((p) => p.slice(runs[0].length));
    const second = new Set(
      (await pngs(runs[1])).map((p) => p.slice(runs[1].length)),
    );
    if (first.length === 0) {
      console.error("visual-repeatability: the first run drew nothing");
      process.exit(1);
    }
    const differing: string[] = [];
    for (const name of first) {
      if (!second.has(name)) {
        differing.push(`${name} (missing from the second run)`);
        continue;
      }
      const [a, b] = await Promise.all(
        runs.map((run) => readFile(join(run, name))),
      );
      if (!a.equals(b)) differing.push(name);
    }
    if (differing.length > 0) {
      console.error(
        `visual-repeatability: ${differing.length} of ${first.length} pictures differ between two runs:\n  ${differing.join("\n  ")}`,
      );
      process.exit(1);
    }
    console.log(
      `visual-repeatability: ${first.length} pictures of ${widgetId} are identical across two ${engine} runs.`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
