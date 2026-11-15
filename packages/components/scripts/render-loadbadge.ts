#!/usr/bin/env tsx
/**
 * Render a dashboard of Navball, Comm Signal, Vessel Schematic and Warp Control
 * through one craft switch: the scene load, the gap after the load before the
 * first measured path, and a real blackout. Each scene is the real widget over
 * a real store; only the transport is played by hand.
 *
 * `--label before|after` names the files, `--out <dir>` picks the folder.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { LAUNCH_UT } from "./heroFlightModel";
import { readHeroFrames } from "./heroFlightWire";
import type { HeroSpec } from "./probe/hero-entry";
import { HERO_ROW_PITCH } from "./readmeHero";
import { installFixedClock, prepareProbePage } from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/loadbadge"),
);
const LABEL = flag("--label") ?? "after";

const TILES = [
  { id: "nav", widget: "navball", at: [0, 0, 12, 12] },
  { id: "comm", widget: "comm-signal", at: [12, 0, 12, 12] },
  { id: "schem", widget: "vessel-schematic", at: [24, 0, 12, 12] },
  { id: "warp", widget: "warp-control", at: [0, 12, 12, 8] },
] as const;

function spec(): HeroSpec {
  const rows = 20;
  return {
    width: 1440,
    height: rows * HERO_ROW_PITCH + 32 + 34,
    items: TILES.map((t) => ({ i: t.id, componentId: t.widget })),
    layout: TILES.map((t) => ({
      i: t.id,
      x: t.at[0],
      y: t.at[1],
      w: t.at[2],
      h: t.at[3],
    })),
    chrome: "today",
    frames: readHeroFrames(),
    startUt: LAUNCH_UT,
  };
}

type Scene = "load" | "gap" | "blackout";

const CAPTION: Record<Scene, string> = {
  load: "scene load after a craft switch (game loading, mod stamps blackout)",
  gap: "after the load, before the first measured path (readings withdrawn)",
  blackout: "a craft truly out of contact (game ready, link down)",
};

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe/hero-entry.tsx"),
    htmlTemplate: join(HERE, "probe/hero.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./hero-entry.bundle.js"></script>',
    slug: "loadbadge",
    alias: { "@ksp-gonogo/components": join(HERE, "../src/index.ts") },
  });
  const browser = await chromium.launch();
  const lines: string[] = [];
  try {
    for (const scene of ["load", "gap", "blackout"] as Scene[]) {
      const s = spec();
      const page = await browser.newPage({
        viewport: { width: s.width, height: s.height },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
      await page.addInitScript("window.__name = (f) => f;");
      await installFixedClock(page);
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__hero));
      await page.evaluate((x) => window.__hero.mount(x), s);
      const lines0 = s.frames[0].lines.map((l) => ({
        topic: l.topic,
        payload: l.payload,
        validAt: l.meta.validAt,
      }));
      await page.evaluate(
        async ({ which, lines, ut }) => {
          const stream = window.__hero.stream();
          if (!stream) throw new Error("no stream");
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const LAST_BEFORE_BLACKOUT = 2;
          stream.scrubTo(ut + 1);
          const send = (
            topic: string,
            payload: unknown,
            validAt: number,
            extra: Record<string, unknown>,
          ) =>
            stream.emit(topic, payload, {
              validAt,
              deliveredAt: validAt,
              ...extra,
            } as never);
          if (which === "gap") {
            stream.store.setGameState("ready", "FLIGHT");
            for (const l of lines) send(l.topic, null, ut + 0.5, {});
          } else {
            for (const l of lines) {
              const connected =
                l.topic === "comms.link" && which === "blackout";
              send(
                l.topic,
                connected ? { connected: false } : l.payload,
                connected ? ut + 0.5 : l.validAt,
                { staleness: LAST_BEFORE_BLACKOUT },
              );
            }
            if (which === "load")
              stream.store.setGameState("loading", "FLIGHT");
          }
          await wait(1000);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        },
        { which: scene, lines: lines0, ut: s.frames[0].ut },
      );
      const file = `${LABEL}--${scene}.png`;
      await page.locator("#root").screenshot({ path: join(OUT_DIR, file) });
      lines.push(
        `### ${scene}: ${CAPTION[scene]}`,
        "",
        `![${scene}](${file})`,
        "",
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(OUT_DIR, `INDEX-${LABEL}.md`), lines.join("\n"), "utf8");
  console.log(CAPTION.load);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
