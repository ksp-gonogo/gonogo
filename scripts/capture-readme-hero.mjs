/**
 * Capture the README hero screenshot + takeoff GIF from a replayed flight.
 *
 * Prereqs (run from the repo root):
 *   1. Replay server playing a recorded flight, freshly started so the
 *      launch is still ahead of the wall clock:
 *        pnpm replay "$PWD/local_docs/flight_recordings/<fixture>.json"
 *   2. App dev server: pnpm --filter @ksp-gonogo/app dev
 *   3. ImageMagick (`convert`) on PATH — same dependency as render-navball-gif.
 *
 * Then: node scripts/capture-readme-hero.mjs
 *
 * Output: docs/assets/hero-dashboard.png (2x DPR) and
 *         docs/assets/takeoff-ascent.gif (800px wide, ~8fps).
 *
 * The script keys everything off the replay server's clock (`/replay/info`),
 * so playback rate or a late start shift the captures, not break them. GIF
 * frames start as soon as the page is live (~T+10s, early ascent through the
 * gravity turn); the hero waits for T+105s — mid-burn, with the graphs
 * carrying a near-full window of curves.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

const APP_URL = "http://localhost:5173/";
const REPLAY_INFO = "http://localhost:8085/replay/info";
const OUT_DIR = "docs/assets";
const FRAMES_DIR = "docs/assets/_takeoff-frames";
const VIEWPORT = { width: 1600, height: 1260 };
const GIF_FRAME_COUNT = 25;
const GIF_FRAME_STEP_S = 2;
const HERO_TIME_S = 105; // mid-burn: TWR green, throttle up, curves climbing
const GIF_WIDTH = 800;
const GIF_DELAY_CS = 12; // ~8fps

/** Dashboard layout written into localStorage before the app boots. */
const DASHBOARD = {
  items: [
    { i: "navball", componentId: "navball", config: {} },
    {
      i: "graph-ascent",
      componentId: "graph",
      config: {
        series: [
          { id: "alt", key: "v.altitude" },
          { id: "spd", key: "v.speed" },
        ],
        windowSec: 120,
        variant: "chart",
      },
    },
    { i: "orbit-view", componentId: "orbit-view", config: {} },
    { i: "fuel", componentId: "fuel-status", config: {} },
    { i: "twr", componentId: "twr", config: {} },
    { i: "thermal", componentId: "thermal-status", config: {} },
    { i: "current-orbit", componentId: "current-orbit", config: {} },
    { i: "atmo", componentId: "atmosphere-profile", config: {} },
    {
      i: "graph-q",
      componentId: "graph",
      config: {
        series: [
          { id: "g", key: "v.geeForce" },
          { id: "q", key: "v.dynamicPressurekPa" },
        ],
        windowSec: 120,
        variant: "chart",
      },
    },
    {
      i: "ag-sas",
      componentId: "action-group",
      config: { actionGroupId: "SAS" },
    },
    {
      i: "ag-rcs",
      componentId: "action-group",
      config: { actionGroupId: "RCS" },
    },
    {
      i: "ag-gear",
      componentId: "action-group",
      config: { actionGroupId: "Gear" },
    },
    {
      i: "ag-brake",
      componentId: "action-group",
      config: { actionGroupId: "Brake" },
    },
    { i: "comm", componentId: "comm-signal", config: {} },
    { i: "landing", componentId: "landing-status", config: {} },
    { i: "crew", componentId: "crew-manifest", config: {} },
  ],
  layouts: {
    lg: [
      { i: "navball", x: 0, y: 0, w: 11, h: 16 },
      { i: "graph-ascent", x: 11, y: 0, w: 15, h: 16 },
      { i: "orbit-view", x: 26, y: 0, w: 10, h: 16 },
      { i: "fuel", x: 0, y: 16, w: 9, h: 12 },
      { i: "twr", x: 9, y: 16, w: 5, h: 6 },
      { i: "thermal", x: 9, y: 22, w: 5, h: 6 },
      { i: "current-orbit", x: 14, y: 16, w: 7, h: 12 },
      { i: "atmo", x: 21, y: 16, w: 7, h: 12 },
      { i: "graph-q", x: 28, y: 16, w: 8, h: 12 },
      { i: "ag-sas", x: 0, y: 28, w: 4, h: 6 },
      { i: "ag-rcs", x: 4, y: 28, w: 4, h: 6 },
      { i: "ag-gear", x: 8, y: 28, w: 4, h: 6 },
      { i: "ag-brake", x: 12, y: 28, w: 4, h: 6 },
      { i: "comm", x: 16, y: 28, w: 6, h: 6 },
      { i: "landing", x: 22, y: 28, w: 7, h: 6 },
      { i: "crew", x: 29, y: 28, w: 7, h: 6 },
    ],
  },
};

async function replayInfo() {
  const res = await fetch(REPLAY_INFO);
  if (!res.ok) throw new Error(`replay/info HTTP ${res.status}`);
  return res.json();
}

/** Mission-time seconds on the replay clock (negative = pre-launch). */
async function missionTime() {
  const info = await replayInfo();
  return (info.now - info.flight.launchedAt) / 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMissionTime(target) {
  for (;;) {
    const t = await missionTime();
    if (t >= target) return t;
    await sleep(Math.min(Math.max((target - t) * 1000, 250), 2000));
  }
}

async function newDashboardPage(browser, deviceScaleFactor) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor,
  });
  await context.addInitScript((dashboard) => {
    localStorage.setItem("gonogo:dashboard:main", JSON.stringify(dashboard));
    localStorage.setItem("gonogo.analytics.consent", "disabled");
  }, DASHBOARD);
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  // Capture-presentation only: the kerbcast sidecar isn't running during a
  // replay capture, so its sustained-failure "SOURCE OFFLINE" banner would
  // pop into later frames. Hide that one banner; everything else is real.
  await page.evaluate(() => {
    setInterval(() => {
      for (const el of document.querySelectorAll('[role="status"]')) {
        if (el.textContent?.includes("SOURCE OFFLINE")) {
          el.style.display = "none";
        }
      }
    }, 250);
  });
  // Telemetry needs a beat to connect + first samples to land.
  await page.waitForTimeout(3000);
  return page;
}

async function main() {
  const t0 = await missionTime();
  if (t0 > 60) {
    throw new Error(
      `Replay is already at T+${t0.toFixed(0)}s — restart the replay server so the early ascent is still ahead.`,
    );
  }
  await mkdir(OUT_DIR, { recursive: true });
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    // GIF frames at 1x — the gif gets downscaled to 800px anyway. The frame
    // schedule starts wherever the replay clock is once the page is live
    // (server boot + page setup eat the first ~10s of the recording).
    const gifPage = await newDashboardPage(browser, 1);
    const firstFrameAt = Math.max(await missionTime(), 2);
    for (let i = 0; i < GIF_FRAME_COUNT; i++) {
      const t = await waitForMissionTime(firstFrameAt + i * GIF_FRAME_STEP_S);
      await gifPage.screenshot({
        path: join(FRAMES_DIR, `frame-${String(i).padStart(3, "0")}.png`),
      });
      process.stdout.write(
        `frame ${i + 1}/${GIF_FRAME_COUNT} @ T+${t.toFixed(1)}s\n`,
      );
    }
    await gifPage.context().close();

    // Hero at 2x DPR in a fresh context so the graphs' sample history and
    // the screenshot DPI are both clean.
    const heroPage = await newDashboardPage(browser, 2);
    await waitForMissionTime(HERO_TIME_S);
    const heroPath = join(OUT_DIR, "hero-dashboard.png");
    await heroPage.screenshot({ path: heroPath });
    console.log(`Wrote ${heroPath}`);
    await heroPage.context().close();
  } finally {
    await browser.close();
  }

  const frames = (await readdir(FRAMES_DIR))
    .filter((f) => f.endsWith(".png"))
    .sort();
  const gifPath = join(OUT_DIR, "takeoff-ascent.gif");
  await execFileAsync("convert", [
    "-loop",
    "0",
    "-delay",
    String(GIF_DELAY_CS),
    ...frames.map((f) => join(FRAMES_DIR, f)),
    "-resize",
    `${GIF_WIDTH}x`,
    "-layers",
    "optimize",
    gifPath,
  ]);
  console.log(`Wrote ${gifPath} (${frames.length} frames)`);
  await rm(FRAMES_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
