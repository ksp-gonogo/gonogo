/**
 * Render configs for the widgets of every Uplink client in this repository that carries a
 * `scripts/widgets.ts`, so the gate renders them like the built-in widgets.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { WidgetRenderConfig } from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(HERE, "../../../mod");
const COMPONENTS_SRC = resolve(HERE, "../src");

/** An Uplink client's configs list `fixturesPath` under its own `src/`; the harness resolves it under the components `src/`. */
export async function listUplinkWidgets(): Promise<WidgetRenderConfig[]> {
  const out: WidgetRenderConfig[] = [];
  for (const entry of readdirSync(MOD).sort()) {
    const client = join(MOD, entry, "client");
    const file = join(client, "scripts", "widgets.ts");
    if (!existsSync(file)) continue;
    const {
      listWidgets,
    }: { listWidgets: () => readonly WidgetRenderConfig[] } = await import(
      pathToFileURL(file).href
    );
    for (const config of listWidgets()) {
      out.push({
        ...config,
        fixturesPath: relative(
          COMPONENTS_SRC,
          resolve(client, "src", config.fixturesPath),
        ),
      });
    }
  }
  return out;
}
