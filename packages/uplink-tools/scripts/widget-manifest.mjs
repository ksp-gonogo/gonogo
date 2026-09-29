/**
 * Writes `dist/widgets.json`: every widget `./widgets` registers, with the
 * scene its reference page draws it on.
 *
 * The registrations only run in a bundle. Under bare `node`,
 * `styled-components` resolves to its CJS half and the kit's module-scope
 * `styled.span` throws, so the entry is bundled with esbuild preferring each
 * package's ESM build, then imported.
 *
 *   node scripts/widget-manifest.mjs
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const COMPONENTS_SRC = resolve(PACKAGE, "../components/src");
const OUT = resolve(PACKAGE, "dist/widgets.json");

const ENTRY = `
import "@ksp-gonogo/components";
import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import { listWidgets } from "../components/scripts/widgets";
export const components = getComponents().map((d) => ({
  id: d.id,
  name: d.name,
  description: d.description,
  tags: d.tags ?? [],
  augmentSlots: d.augmentSlots ?? [],
  contributionSlots: d.contributionSlots ?? [],
  defaultSize: d.defaultSize ?? null,
  defaultConfig: d.defaultConfig ?? {},
}));
export const renderConfigs = listWidgets();
`;

/** The fixture a widget's page opens on, where the first by name shows it degraded. */
const PAGE_SCENES = {
  "astronaut-complex": "mid-career-pool",
  "comm-signal": "strong-direct-ksc",
  "contract-manager": "multiple-active-contracts",
  "crew-status": "valentina-solo-orbit",
  "current-orbit": "circular-lko",
  experiments: "instruments-holding-data",
  "fleet-roster": "mixed-fleet",
  "fuel-status": "asparagus-multi-stage",
  "map-view": "kerbin-lko-equator",
  navball: "gravity-turn-east",
  "resource-ops": "kerbalism-mixed",
  "ship-map": "01-builtin-drainable-meters",
  "space-center-status": "mid-career-mixed",
  strategies: "one-active-room-for-more",
  "target-picker": "lko-station-target",
  targeting: "approach-closing",
  "tech-tree": "small-career-detail",
  "transfer-window": "earth-mars-go",
  "warp-control": "rails-warp-1000x",
};

/**
 * The scene a widget's page opens on: its `__fixtures__` render config (or its
 * first), that config's fixture named in `PAGE_SCENES` or else its first by
 * name, at its `default-*` mode (or its first).
 */
function sceneOf(widgetId, renderConfigs) {
  const configs = renderConfigs.filter((c) => c.widgetId === widgetId);
  if (configs.length === 0) return null;
  const config =
    configs.find((c) => c.fixturesPath.endsWith("/__fixtures__")) ?? configs[0];
  const dir = resolve(COMPONENTS_SRC, config.fixturesPath);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const named = PAGE_SCENES[widgetId];
  if (named && !files.includes(`${named}.json`)) {
    throw new Error(
      `PAGE_SCENES names ${named} for ${widgetId}, which ${config.fixturesPath} does not hold`,
    );
  }
  const first = named ? `${named}.json` : files[0];
  if (!first) return null;
  const mode =
    config.modes.find((m) => m.name.startsWith("default")) ?? config.modes[0];
  return {
    name: first.replace(/\.json$/, ""),
    w: mode.w,
    h: mode.h,
    config: mode.config ?? {},
    fixture: JSON.parse(readFileSync(join(dir, first), "utf8")),
  };
}

export async function writeWidgetManifest() {
  const scratch = resolve(PACKAGE, ".widget-manifest");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const bundle = join(scratch, "entry.mjs");
  try {
    await build({
      stdin: { contents: ENTRY, resolveDir: PACKAGE, loader: "ts" },
      bundle: true,
      platform: "node",
      mainFields: ["module", "main"],
      format: "esm",
      outfile: bundle,
      loader: { ".png": "dataurl", ".svg": "dataurl", ".css": "empty" },
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      logLevel: "error",
    });
    const { components, renderConfigs } = await import(
      pathToFileURL(bundle).href
    );
    const widgets = components
      .map((c) => ({ ...c, scene: sceneOf(c.id, renderConfigs) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (widgets.length === 0) throw new Error("./widgets registered no widget");
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify({ widgets }, null, 2)}\n`);
    return widgets;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const widgets = await writeWidgetManifest();
  const unscened = widgets.filter((w) => w.scene === null).map((w) => w.id);
  console.log(
    `widgets.json: ${widgets.length} widgets${unscened.length ? `, no scene for ${unscened.join(", ")}` : ""}`,
  );
}
