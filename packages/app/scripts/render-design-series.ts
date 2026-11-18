#!/usr/bin/env tsx
import { mkdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

/* Spike driver: renders core widgets over a design's predicted flight. Throwaway. */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "design-series-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "design-series-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const W4 = resolve(HERE, "../../../.renders/w4");
const OUT_DIR = process.env.DESIGN_SERIES_OUT ?? join(W4, "shots");
const DATA = join(W4, "data");

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling design-series probe with esbuild...");
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
    },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  });
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./design-series-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `design-series-probe-${process.pid}.html`,
  );
  await writeFile(file, out, "utf8");
  return file;
}

const load = (name: string) =>
  JSON.parse(readFileSync(join(DATA, name), "utf8"));
const bodies = load("bodies.json");
const v1 = load("predicted-v1-0.json");
const tank50 = load("predicted-tank50-0.json");
const endOf = (p: { samples: { t: number }[] }) =>
  Math.ceil(p.samples[p.samples.length - 1].t);
const V1_END = endOf(v1);
const TANK50_END = endOf(tank50);

/** The real flight v1 from the Deck, as samples from lift-off. */
function realFlight(): { variant: string; samples: Record<string, unknown>[] } {
  const lines = readFileSync(
    resolve(W4, "../designprog/prior-renders/rig415/flight-v1.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).msg)
    .filter((m) => m.type === "stream-data");
  const strip = (p: Record<string, unknown>) => {
    const { meta: _m, ...rest } = p;
    return rest;
  };
  const lift = lines.find(
    (m) => m.topic === "vessel.flight" && m.payload.surfaceSpeed > 1,
  ).meta.validAt as number;
  const byT = new Map<number, Record<string, unknown>>();
  for (const m of lines) {
    if (m.topic !== "vessel.flight" && m.topic !== "vessel.structure") continue;
    const t = Math.round((m.meta.validAt - lift) * 10) / 10;
    const row = byT.get(t) ?? { t };
    row[m.topic] = strip(m.payload);
    byT.set(t, row);
  }
  return { variant: "real-v1", samples: [...byT.values()] };
}

const ALT_GRAPH = {
  id: "graph",
  config: {
    series: [
      { id: "alt", key: "vessel.flight.altitudeAsl", label: "Altitude" },
      {
        id: "vs",
        key: "vessel.flight.verticalSpeed",
        label: "Vertical speed",
        axis: "secondary",
      },
    ],
    windowSec: 1200,
  },
  w: 520,
  h: 300,
};

const DESIGN_TILES = [
  { id: "twr", w: 300, h: 300 },
  { id: "orbital-ascent", w: 440, h: 300 },
  { id: "atmosphere-profile", w: 440, h: 300 },
  ALT_GRAPH,
  { id: "navball", w: 300, h: 300 },
  { id: "comm-signal", w: 420, h: 300 },
];

interface Shot {
  name: string;
  /** Wheel-zoom the page at this point before the shot. */
  zoom?: { x: number; y: number; steps: number };
  scene: Record<string, unknown>;
}

const POIS = [
  {
    id: "launchSite:LaunchPad",
    kind: "ksc",
    bodyIndex: 1,
    latitude: -0.0972,
    longitude: -74.5577,
    label: "KSC",
  },
  {
    id: "contract:w1",
    kind: "contractTarget",
    bodyIndex: 1,
    latitude: -9.9,
    longitude: -103.4,
    label: "Splashdown survey near the Crater Bay",
    status: "active",
    contractAgent: "Kerbin World-Firsts Record-Keeping Society",
  },
  {
    id: "contract:w2",
    kind: "contractTarget",
    bodyIndex: 1,
    latitude: 8.3,
    longitude: -140.2,
    label: "Survey the western sea",
    status: "available",
  },
];

const SHOTS: Shot[] = [
  {
    name: "ground-track-design",
    scene: {
      screen: "main",
      scene: "Editor",
      prediction: v1,
      cursor: V1_END,
      bodies,
      pois: POIS,
      tiles: [{ id: "ground-track", w: 900, h: 480, forceOverlay: true }],
      heading:
        "Ground Track over the predicted flight at splashdown, with two contract waypoints from spaceCenter.pois",
    },
    zoom: { x: 250, y: 322, steps: 6 },
  },
  {
    name: "mc-design-t40",
    scene: {
      screen: "main",
      scene: "Editor",
      prediction: v1,
      cursor: 40,
      tiles: DESIGN_TILES,
      bodies,
      heading:
        "Mission control, VAB. Cursor T+40 s of the predicted flight (script v1, FAR-fit run). Twr, Orbital Ascent and Atmosphere Profile opt in; Navball and Comm Signal do not",
    },
  },
  {
    name: "mc-design-end",
    scene: {
      screen: "main",
      scene: "Editor",
      prediction: v1,
      cursor: V1_END,
      tiles: DESIGN_TILES,
      bodies,
      heading: `Mission control, VAB. Cursor at splashdown (T+${V1_END} s): the series widgets draw the whole predicted flight`,
    },
  },
  {
    name: "mc-design-tank50-end",
    scene: {
      screen: "main",
      scene: "Editor",
      prediction: tank50,
      cursor: TANK50_END,
      tiles: DESIGN_TILES,
      bodies,
      heading:
        "Mission control, VAB. The same widgets after the FL-T400 is set to 50%: apoapsis 72.6 km",
    },
  },
  {
    name: "pilot-editor",
    scene: {
      screen: "pilot",
      scene: "Editor",
      prediction: v1,
      cursor: 60,
      tiles: DESIGN_TILES,
      bodies,
      heading:
        "Pilot seat, VAB. The same tiles: the design is never mounted, and the mode answer is 'none'",
    },
  },
  {
    name: "forced-swap",
    scene: {
      screen: "main",
      scene: "Editor",
      prediction: v1,
      cursor: 60,
      bodies,
      tiles: [
        { id: "navball", w: 300, h: 300, forceOverlay: true },
        { id: "fuel-status", w: 420, h: 300, forceOverlay: true },
        { id: "comm-signal", w: 420, h: 300, forceOverlay: true },
        { id: "kepler-period", w: 300, h: 300, forceOverlay: true },
      ],
      heading:
        "What a blanket hot-swap would draw: widgets that did not opt in, handed the design anyway, at T+60 s",
    },
  },
  {
    name: "flight-compare",
    scene: {
      screen: "main",
      scene: "Flight",
      prediction: v1,
      live: realFlight(),
      cursor: 900,
      bodies,
      overlayTopics: ["prediction.flight"],
      overlayMode: "default",
      alsoAsPredicted: true,
      tiles: [
        {
          id: "graph",
          w: 1000,
          h: 340,
          config: {
            series: [
              {
                id: "actual",
                key: "vessel.flight.altitudeAsl",
                label: "Altitude, actual",
                axis: "primary",
              },
              {
                id: "pred",
                key: "prediction.flight.altitudeAsl",
                label: "Altitude, predicted",
                axis: "primary",
              },
            ],
            windowSec: 1200,
          },
        },
      ],
      heading:
        "In flight, carrying the prediction: the real flight v1 from the Deck against what the VAB predicted for it",
    },
  },
];

const scrubFrames = Number(process.env.SCRUB_FRAMES ?? 0);

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const page_ = await prepareProbePage();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1320, height: 760 },
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().startsWith("DBG"))
      console.log("console:", m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(pathToFileURL(page_).href);
  await page.waitForFunction(() => "__renderDesignSeries" in window);
  const only = process.env.ONLY;
  for (const shot of SHOTS) {
    if (only && !shot.name.includes(only)) continue;
    await page.evaluate(
      (s) =>
        (
          window as never as {
            __renderDesignSeries: (x: unknown) => Promise<void>;
          }
        ).__renderDesignSeries(s),
      shot.scene,
    );
    if (shot.zoom) {
      await page.mouse.move(shot.zoom.x, shot.zoom.y);
      for (let i = 0; i < shot.zoom.steps; i++) {
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(400);
    }
    await page.screenshot({
      path: join(OUT_DIR, `${shot.name}.png`),
      fullPage: true,
    });
    console.log("wrote", shot.name);
  }
  if (scrubFrames > 0) {
    for (const base of ["mc-design-t40", "ground-track-design"]) {
      const shot = SHOTS.find((x) => x.name === base);
      if (!shot) continue;
      const dir = join(OUT_DIR, `scrub-${base}`);
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < scrubFrames; i++) {
        const cursor = Math.round((i / (scrubFrames - 1)) * V1_END);
        const scene = {
          ...shot.scene,
          cursor,
          heading: `Mission control, VAB. Scrubbing the predicted flight: T+${cursor} s`,
        };
        await page.evaluate(
          (s) =>
            (
              window as never as {
                __renderDesignSeries: (x: unknown) => Promise<void>;
              }
            ).__renderDesignSeries(s),
          scene,
        );
        if (shot.zoom) {
          await page.mouse.move(shot.zoom.x, shot.zoom.y);
          for (let z = 0; z < shot.zoom.steps; z++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(60);
          }
          await page.waitForTimeout(200);
        }
        await page.screenshot({
          path: join(dir, `f${String(i).padStart(3, "0")}.png`),
          fullPage: true,
        });
      }
    }
    console.log("wrote", scrubFrames, "scrub frames per clip");
  }
  await browser.close();
}

void main();
