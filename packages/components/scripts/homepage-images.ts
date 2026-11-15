#!/usr/bin/env tsx
/**
 * Regenerates every picture the home page shows (docs/homepage/img) from the
 * current widgets and committed fixtures: no running game and no hand steps.
 *
 *   pnpm --filter @ksp-gonogo/components homepage-images
 *
 * Each widget is drawn whole, in one Chromium session, then cut to webp. A
 * picture drawn at a widget's default size reads that size from the registry
 * at run time, so a widget whose default changes is drawn at its new size with
 * no edit here. The dashboard still comes from the
 * README hero's own composition. Pictures must be committed from Linux: the
 * font rasteriser differs by platform.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { makeTempDir } from "../../../scripts/temp-dir.mjs";
import {
  PROBE_PAGES,
  prepareProbePage,
  renderWidgets,
  type WidgetRenderConfig,
} from "./widgetRenderHarness";
import { getWidget } from "./widgets";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const OUT = resolve(REPO_ROOT, "docs/homepage/img");
const PAGE = resolve(REPO_ROOT, "docs/homepage/index.html");

type Size = { w: number; h: number };

interface Picture {
  /** File name under docs/homepage/img, without the extension. */
  file: string;
  /** Key `getWidget` takes. */
  widget: string;
  fixture: string;
  /** Folder under src holding a scene drawn only for the home page, in place of the widget's own fixtures. */
  scenes?: string;
  /** The widget's registered default size, a named mode of its render config, or a tile in grid units; the last two where the default is too large to read at lane width. */
  size: "default" | { mode: string } | Size;
  /** Cut the empty ground below the widget's last content. */
  trim?: boolean;
}

/** The widget wall, and the phone's one still. */
const PICTURES: readonly Picture[] = [
  {
    file: "navball",
    widget: "navball",
    fixture: "maneuver-burn",
    size: { mode: "full-7x20" },
  },
  {
    file: "graph",
    widget: "graph",
    fixture: "ascent-altitude-velocity",
    size: { mode: "mobile-9x8" },
  },
  {
    file: "power",
    widget: "power-systems",
    fixture: "battery-draining-high-load",
    size: "default",
    trim: true,
  },
  {
    file: "commnet",
    widget: "comm-signal",
    fixture: "deep-space-delay",
    size: { mode: "large-8x8" },
    trim: true,
  },
  {
    file: "tracking-station",
    widget: "tracking-station",
    fixture: "kerbin-mun-encounter",
    size: { mode: "square-8x8" },
  },
  {
    file: "landing",
    widget: "landing-status/scenarios",
    fixture: "final-approach-mun",
    size: "default",
  },
  {
    file: "warp",
    widget: "warp-control",
    fixture: "delayed-next-alarm",
    size: { mode: "large-8x7" },
    trim: true,
  },
  {
    file: "thermal",
    widget: "thermal-status",
    fixture: "reentry-critical",
    size: "default",
    trim: true,
  },
  {
    file: "ground-track-col",
    widget: "ground-track",
    fixture: "kerbin-mun-encounter",
    size: { mode: "mobile-9x8" },
  },
  {
    file: "fuel",
    widget: "fuel-status",
    fixture: "asparagus-multi-stage",
    size: "default",
    trim: true,
  },
  {
    file: "kepler",
    widget: "kepler-period",
    fixture: "kerbin-high-eccentric",
    size: { mode: "mobile-9x8" },
  },
  {
    file: "orbit",
    widget: "orbit-view",
    scenes: "OrbitView/__homepage__",
    fixture: "kerbin-level-ellipse",
    size: { w: 9, h: 12 },
  },
  {
    file: "ship-map",
    widget: "ship-map",
    scenes: "ShipMap/__homepage__",
    fixture: "kerbal-x-liftoff",
    size: { w: 9, h: 14 },
  },
  {
    file: "docking",
    widget: "rendezvous",
    fixture: "docking-aligned",
    size: "default",
    trim: true,
  },
  {
    file: "ground-track",
    widget: "ground-track",
    fixture: "kerbin-mun-encounter",
    size: { mode: "wide-18x10" },
  },
];

/** Widest a wall picture is kept: a lane is under 300 CSS px, drawn at 2x. */
const LANE_WIDTH = 600;
const WIDE_WIDTH = 1000;
const DASHBOARD_WIDTH = 1800;
const QUALITY = 0.82;

/** Each widget's registered default size, read from the probe page the widgets are drawn in. */
async function defaultSizes(
  widgetIds: readonly string[],
): Promise<Map<string, Size>> {
  const html = await prepareProbePage({
    ...PROBE_PAGES.widget,
    slug: "homepage-sizes",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).toString());
    await page.waitForFunction(
      () => typeof window.__probeDefaultSize === "function",
    );
    const sizes = new Map<string, Size>();
    for (const id of widgetIds) {
      const size = await page.evaluate(
        (id) => window.__probeDefaultSize(id),
        id,
      );
      if (!size)
        throw new Error(`${id} is not registered, or declares no defaultSize`);
      sizes.set(id, size);
    }
    return sizes;
  } finally {
    await browser.close();
  }
}

/** The mode each picture is drawn in. */
function modeName(p: Picture, defaults: Map<string, Size>): string {
  if (p.size === "default") {
    const config = getWidget(p.widget) as WidgetRenderConfig;
    const size = defaults.get(config.widgetId) as Size;
    return `homepage-default-${size.w}x${size.h}`;
  }
  if ("mode" in p.size) return p.size.mode;
  return `homepage-${p.size.w}x${p.size.h}`;
}

/** Where a picture's render lands under the output folder. */
function outPath(p: Picture): string {
  const config = getWidget(p.widget) as WidgetRenderConfig;
  return p.scenes ? `${config.outPath}-homepage` : config.outPath;
}

/** One config per widget and scene folder, cut to the modes and fixtures the pictures name. */
function configs(defaults: Map<string, Size>): WidgetRenderConfig[] {
  const byOut = new Map<string, WidgetRenderConfig>();
  for (const p of PICTURES) {
    const config = getWidget(p.widget);
    if (!config) throw new Error(`no render config "${p.widget}"`);
    const name = modeName(p, defaults);
    const mode =
      p.size === "default"
        ? { name, ...(defaults.get(config.widgetId) as Size) }
        : "mode" in p.size
          ? config.modes.find((m) => m.name === name)
          : { name, w: p.size.w, h: p.size.h };
    if (!mode) throw new Error(`${p.widget} has no mode "${name}"`);
    const out = outPath(p);
    const entry = byOut.get(out) ?? {
      ...config,
      outPath: out,
      fixturesPath: p.scenes ?? config.fixturesPath,
      modes: [],
    };
    entry.modes.push({ ...mode, forFixtures: [p.fixture] });
    byOut.set(out, entry);
  }
  return [...byOut.values()];
}

interface Cut {
  src: string;
  out: string;
  maxWidth: number;
  trim: boolean;
}

/** Scales and encodes each PNG to webp in the browser, cutting the empty ground under a trimmed one; returns each file's pixel size. */
async function toWebp(
  cuts: readonly Cut[],
): Promise<Map<string, { width: number; height: number }>> {
  const sizes = new Map<string, { width: number; height: number }>();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const cut of cuts) {
      const png = readFileSync(cut.src).toString("base64");
      const { url, width, height } = await page.evaluate(
        async ({ png, maxWidth, trim, quality }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const w = img.naturalWidth;
          let h = img.naturalHeight;
          if (trim) {
            const probe = document.createElement("canvas");
            probe.width = w;
            probe.height = h;
            const g = probe.getContext("2d") as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            const px = g.getImageData(0, 0, w, h).data;
            const ground = (40 * w + 40) * 4;
            let last = 0;
            for (let y = 0; y < h - 8; y++) {
              for (let x = 24; x < w - 24; x++) {
                const i = (y * w + x) * 4;
                const d =
                  Math.abs(px[i] - px[ground]) +
                  Math.abs(px[i + 1] - px[ground + 1]) +
                  Math.abs(px[i + 2] - px[ground + 2]);
                if (d > 40) {
                  last = y;
                  break;
                }
              }
            }
            h = Math.min(h, last + 40);
          }
          const scale = Math.min(1, maxWidth / w);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const g = canvas.getContext("2d") as CanvasRenderingContext2D;
          g.imageSmoothingQuality = "high";
          g.drawImage(img, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
          return {
            url: canvas.toDataURL("image/webp", quality),
            width: canvas.width,
            height: canvas.height,
          };
        },
        { png, maxWidth: cut.maxWidth, trim: cut.trim, quality: QUALITY },
      );
      writeFileSync(cut.out, Buffer.from(url.split(",")[1], "base64"));
      sizes.set(basename(cut.out), { width, height });
      console.log(
        `wrote ${cut.out} (${Math.round(statSync(cut.out).size / 1024)} KB)`,
      );
    }
  } finally {
    await browser.close();
  }
  return sizes;
}

/** Writes each picture's new size into the page's width and height attributes, so the page reserves the right box before it loads. */
function updatePage(
  sizes: Map<string, { width: number; height: number }>,
): void {
  let html = readFileSync(PAGE, "utf8");
  for (const [file, { width, height }] of sizes) {
    const tag = new RegExp(
      `(src="img/${file.replace(".", "\\.")}" )width="\\d+" height="\\d+"`,
      "g",
    );
    if (!tag.test(html))
      throw new Error(`index.html has no sized <img> for img/${file}`);
    html = html.replace(tag, `$1width="${width}" height="${height}"`);
  }
  writeFileSync(PAGE, html);
  console.log(`sized ${sizes.size} pictures in ${PAGE}`);
}

async function main(): Promise<void> {
  if (platform() !== "linux") {
    console.warn(
      "WARNING: not running on Linux. Fonts rasterise differently here, so these pictures are for review only. Do not commit them.",
    );
  }
  const tmp = makeTempDir("homepage-images-");

  const widgetIds = PICTURES.filter((p) => p.size === "default").map(
    (p) => (getWidget(p.widget) as WidgetRenderConfig).widgetId,
  );
  const defaults = await defaultSizes([...new Set(widgetIds)]);
  await renderWidgets(configs(defaults), { outBase: tmp, fullContent: true });

  const hero = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/readme-images.ts",
      "--only",
      "hero",
      "--hero",
      "compact",
      "--review",
      tmp,
      "--stills",
    ],
    {
      cwd: resolve(HERE, ".."),
      stdio: "inherit",
      env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" },
    },
  );
  if (hero.status !== 0) throw new Error("the dashboard still did not render");

  const cuts: Cut[] = PICTURES.map((p) => {
    return {
      src: join(tmp, outPath(p), `${p.fixture}--${modeName(p, defaults)}.png`),
      out: join(OUT, `${p.file}.webp`),
      maxWidth: p.file === "ground-track" ? WIDE_WIDTH : LANE_WIDTH,
      trim: p.trim ?? false,
    };
  });
  cuts.push({
    src: join(tmp, "hero-compact-clean.png"),
    out: join(OUT, "dashboard.webp"),
    maxWidth: DASHBOARD_WIDTH,
    trim: false,
  });
  updatePage(await toWebp(cuts));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
