#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

/* Renders the built Flight Plan widget and mode pane for the round's review. */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "probe", "flight-plan-probe-entry.tsx");
const HTML = join(HERE, "probe", "flight-plan-probe.html");
const TOKENS = resolve(HERE, "../../theme/src/tokens.css");
/* RENDER_SET picks the scenes: the Flight Plan round's (default) or the Timeline round's, into RENDER_OUT under .renders. */
const SET = process.env.RENDER_SET ?? "flight-plan";
const OUT = resolve(
  HERE,
  "../../../.renders",
  process.env.RENDER_OUT ?? "dpbuild2",
);

async function page(): Promise<string> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
    },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
    // The widget under review is built from source, so a render never shows a stale dist.
    alias: {
      "@ksp-gonogo/components": resolve(HERE, "../../components/src/index.ts"),
      "@ksp-gonogo/core": resolve(HERE, "../../core/src/index.ts"),
      "@ksp-gonogo/ui": resolve(HERE, "../../ui/src/index.ts"),
    },
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const tokens = await readFile(TOKENS, "utf8");
  const html = (await readFile(HTML, "utf8"))
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${tokens}</style>`,
    )
    .replace(
      '<script type="module" src="./flight-plan-probe-entry.bundle.js"></script>',
      () => `<script type="module">${js}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `flight-plan-probe-${process.pid}.html`,
  );
  await writeFile(file, html, "utf8");
  return file;
}

const tablet = { w: 1024, h: 740 };
const phone = { w: 390, h: 780 };
const base = {
  t: 112,
  altitude: 41_600,
  ag2: false,
  padDv: 5_620,
  ap: 62_000,
  pe: -410_000,
};
const MK2_RESULT = {
  s2: { met: 9, of: 9 },
  s3: { met: 9, of: 9 },
  s4: { met: 0, of: 9 },
};

const RUN = [
  { t: 0, altitude: 70, dv: 5_620, ap: 0, pe: -600_000, ag2: false },
  { t: 30, altitude: 4_000, dv: 5_100, ap: 6_000, pe: -590_000, ag2: false },
  { t: 58, altitude: 10_000, dv: 4_700, ap: 18_000, pe: -560_000, ag2: false },
  { t: 112, altitude: 41_600, dv: 3_920, ap: 62_000, pe: -410_000, ag2: false },
  { t: 132, altitude: 55_000, dv: 3_700, ap: 70_000, pe: -300_000, ag2: true },
  { t: 232, altitude: 79_000, dv: 2_230, ap: 81_000, pe: 79_000, ag2: true },
  { t: 270, altitude: 80_000, dv: 2_220, ap: 81_000, pe: 79_000, ag2: true },
];

const designScene = (t: number) => ({
  ...base,
  t,
  game: "editor",
  dv: 5_620,
  pane: true,
  predicted: true,
  series: RUN,
  end: 400,
  widget: { w: 390, h: 560, rows: 12 },
  screen: tablet,
  title: "Mun Hopper rev 15",
});

const SCENES: Record<string, Record<string, unknown>> = {
  "enter-before-space-centre": {
    ...base,
    t: 0,
    game: "editor",
    dv: 5_620,
    pane: false,
    grid: true,
    screen: tablet,
  },
  "enter-after-design-mode": {
    ...designScene(112),
    widget: undefined,
    grid: true,
  },
  "phone-sheet-over-tiles": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    grid: true,
    screen: phone,
    detent: "half",
  },
  "design-cursor-t112": designScene(112),
  "design-cursor-t270": designScene(270),
  "widget-flight-on-plan": {
    ...base,
    game: "flight",
    dv: 3_920,
    pane: false,
    widget: { w: 390, h: 520, rows: 12 },
    screen: { w: 410, h: 540 },
  },
  "widget-flight-off-plan": {
    ...base,
    ap: 71_000,
    pe: -260_000,
    t: 151,
    altitude: 58_300,
    game: "flight",
    dv: 3_700,
    pane: false,
    widget: { w: 390, h: 520, rows: 12 },
    screen: { w: 410, h: 540 },
  },
  "widget-flight-short": {
    ...base,
    game: "flight",
    dv: 2_000,
    pane: false,
    widget: { w: 390, h: 520, rows: 12 },
    screen: { w: 410, h: 540 },
  },
  "widget-small": {
    ...base,
    game: "flight",
    dv: 3_920,
    pane: false,
    widget: { w: 200, h: 170, rows: 5 },
    screen: { w: 220, h: 190 },
  },
  "pane-vab-tablet": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    screen: tablet,
  },
  "pane-flight-tablet": {
    ...base,
    game: "flight",
    dv: 2_000,
    pane: true,
    widget: { w: 390, h: 520, rows: 12 },
    screen: tablet,
  },
  "sheet-phone-minimised": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    screen: phone,
    detent: "peek",
  },
  "sheet-phone-half": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    screen: phone,
    detent: "half",
  },
  "sheet-phone-full": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    screen: phone,
    detent: "full",
  },
};

const desktop = { w: 1440, h: 900 };
/* The approved editor state: Mun Hopper Mk2 rev 3 with 5,030 m/s against the plan's 5,150, so the margin is -120 m/s and Land is short. */
const timelineDesign = (
  screen: { w: number; h: number },
  detent: "peek" | "half" | "full" = "half",
) => ({
  ...designScene(112),
  widget: undefined,
  grid: true,
  planResult: MK2_RESULT,
  dv: 5_030,
  padDv: 5_030,
  title: "Mun Hopper Mk2 rev 3",
  screen,
  ...(screen === phone ? { detent } : {}),
});
const timelineReplay = (screen: { w: number; h: number }) => ({
  ...base,
  game: "flight",
  dv: 3_920,
  pane: true,
  grid: true,
  replay: 0.4,
  screen,
  title: "Muna 1",
  ...(screen === phone ? { detent: "peek" } : {}),
});
/* The default mode in flight, with one section an Uplink adds: the pane comes with it. */
const defaultSection = (screen: { w: number; h: number }) => ({
  ...base,
  game: "flight",
  dv: 3_920,
  pane: true,
  grid: true,
  defaultSection: true,
  screen,
  title: "Muna 1",
  ...(screen === phone ? { detent: "half" } : {}),
});
const TIMELINE: Record<string, Record<string, unknown>> = {
  "default-section-desktop": defaultSection(desktop),
  "default-section-phone": defaultSection(phone),
  "design-desktop": timelineDesign(desktop),
  "design-tablet": timelineDesign(tablet),
  "design-phone": timelineDesign(phone),
  "design-phone-minimised": timelineDesign(phone, "peek"),
  "design-phone-full": timelineDesign(phone, "full"),
  "recorded-desktop": timelineReplay(desktop),
  "recorded-tablet": timelineReplay(tablet),
  "recorded-phone": timelineReplay(phone),
  "add-step-contributed": {
    planResult: MK2_RESULT,
    ...base,
    t: 0,
    altitude: 70,
    game: "editor",
    dv: 5_030,
    pane: true,
    contributed: true,
    screen: tablet,
  },
};

/* The menu open and two banners while the Timeline is on screen. */
const CHROME: Record<string, Record<string, unknown>> = {
  "design-desktop": { ...timelineDesign(desktop), chrome: true },
  "design-tablet": { ...timelineDesign(tablet), chrome: true },
  "design-phone": { ...timelineDesign(phone, "peek"), chrome: true },
  "recorded-desktop": { ...timelineReplay(desktop), chrome: true },
  "recorded-tablet": { ...timelineReplay(tablet), chrome: true },
  "recorded-phone": { ...timelineReplay(phone), chrome: true },
};

async function main(): Promise<void> {
  const scenes =
    SET === "timeline" ? TIMELINE : SET === "chrome" ? CHROME : SCENES;
  mkdirSync(OUT, { recursive: true });
  const file = await page();
  const browser = await chromium.launch();
  const strings: Record<string, string> = {};
  for (const [name, scene] of Object.entries(scenes)) {
    const screen = scene.screen as { w: number; h: number };
    const p = await browser.newPage({
      viewport: { width: screen.w + 32, height: screen.h + 32 },
      deviceScaleFactor: 2,
    });
    if (scene.detent) {
      await p.addInitScript(
        (d) => localStorage.setItem("gonogo.modePane.detent", d as string),
        scene.detent,
      );
    }
    p.on("pageerror", (e) => console.error("page error:", e.message));
    await p.goto(pathToFileURL(file).href);
    await p.waitForFunction(() => "__renderFlightPlan" in window);
    await p.evaluate(async (s) => {
      await (
        window as unknown as {
          __renderFlightPlan: (x: unknown) => Promise<void>;
        }
      ).__renderFlightPlan(s);
    }, scene);
    if (scene.detent) {
      await p.evaluate(
        (d) => localStorage.setItem("gonogo.modePane.detent", d as string),
        scene.detent,
      );
    }
    if (scene.chrome) {
      await p.getByRole("button", { name: "Menu", exact: true }).click();
      await p.mouse.move(0, 0);
      await p.waitForTimeout(400);
    }
    await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    strings[name] = (await p.evaluate(() => document.body.innerText))
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(" · ");
    await p.close();
  }
  writeFileSync(join(OUT, "strings.json"), JSON.stringify(strings, null, 2));
  await browser.close();
  console.log(`wrote ${Object.keys(scenes).length} renders to ${OUT}`);
}

await main();
