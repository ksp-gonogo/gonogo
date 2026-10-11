import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WidgetRenderConfig } from "./widgetRenderHarness";

/**
 * Directories under an engine's baseline root that hold PNGs no render config
 * writes to, relative to that root. A renamed or removed widget leaves its old
 * directory behind: nothing renders into it, so nothing compares against it,
 * and it reads as coverage it no longer provides.
 */
export async function orphanBaselineDirs(
  engineRoot: string,
  configs: readonly Pick<WidgetRenderConfig, "outPath">[],
): Promise<string[]> {
  const owned = new Set(
    configs.map((c) => c.outPath.replace(/^renders\//, "")),
  );
  let entries: string[];
  try {
    entries = await readdir(engineRoot, { recursive: true });
  } catch {
    return [];
  }
  const dirs = new Set(
    entries.filter((f) => f.endsWith(".png")).map((f) => dirname(f)),
  );
  return [...dirs].filter((d) => !owned.has(d)).sort();
}
