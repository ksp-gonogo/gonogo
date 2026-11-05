#!/usr/bin/env tsx
/**
 * Record a main screen and a station of one command centre side by side while
 * value commands cross a 27.4 s one-way delay to a modelled craft. The craft
 * takes each command a one-way delay after it was sent and reports home once
 * a second; each command is answered when the reading that shows it comes
 * home. The game clock moves every animation frame at real speed.
 *
 * Clips: the Navball throttle dragged to 50%; "FULL" from the station then
 * "ZERO" from the main screen; the 50% drag with the link lost from 30 s to 62 s, so
 * the readings go held; and the Rotor Tachometer's RPM cap stepped up on the
 * station and down on the main screen. Each is recorded with the delay rail
 * expanded and collapsed, as an H.264 MP4 with captioned stills. Files go to
 * `--out` (default `.renders/throttlecmd5`), named by `--label`.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { tilePixels } from "./probe/payload";
import type { SharedScreen, SharedWidget } from "./probe/shared-rail-entry";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
  viewportFor,
} from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/throttlecmd5"),
);
const LABEL = flag("--label") ?? "spike";
/** Wall milliseconds per scene second; 1000 is real speed. */
const MS_PER_SECOND = Number(flag("--ms-per-second") ?? 1000);
/** Only the clips whose names contain this. */
const ONLY = flag("--only");
/** The one-way delay the scene runs at, as `shared-rail-entry` defaults it. */
const ONE_WAY = 27.4;

type Still = (name: string, caption: string) => Promise<void>;

interface Clip {
  name: string;
  title: string;
  widget: SharedWidget;
  w: number;
  h: number;
  /** Stills by scene second. */
  shots: Readonly<Record<number, string>>;
  script: (ctx: ClipContext) => Promise<void>;
}

interface ClipContext {
  page: Page;
  still: Still;
  /** Opens the delay rail's detail, on the expanded run only. */
  grow: () => Promise<void>;
  /** A still of the main screen's throttle controls alone, at three times the scale. */
  closeUp: (caption: string) => Promise<void>;
  /** Runs the clock to `until`, captioned each second with `say(second)`, taking the clip's stills on the way. */
  play: (
    from: number,
    until: number,
    say: (s: number) => string,
  ) => Promise<void>;
}

const caption = (page: Page, text: string) =>
  page.evaluate((c) => window.__sharedScene.caption(c), text);

/** Drags `screen`'s throttle slider from its left end to `value`, queuing each input as the stream sends it. */
async function drag(
  page: Page,
  screen: SharedScreen,
  value: number,
  still: Still,
) {
  const box = await page
    .locator(`#screen-${screen} input[aria-label="Throttle"]`)
    .boundingBox();
  if (!box) throw new Error(`no throttle slider on ${screen}`);
  const y = box.y + box.height / 2;
  // A range thumb travels the track less its own width, about 16px.
  const x = (v: number) => box.x + 8 + v * (box.width - 16);
  const queue = () =>
    page.evaluate((s) => {
      try {
        window.__sharedScene.queueThrottle(s);
      } catch {
        // Nothing sent yet.
      }
    }, screen);
  await page.mouse.move(x(0), y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(x((value * i) / 20), y);
    await page.waitForTimeout(60);
    await queue();
  }
  await page.waitForTimeout(1200);
  await queue();
  await still("mid-drag", "mid-drag: the station's hand is on the slider");
  await page.mouse.up();
  // Off the widgets, so no tooltip opens under a resting pointer.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await queue();
  await page.waitForTimeout(900);
  await still("released", "just let go: 50% on its way");
}

async function press(page: Page, screen: SharedScreen, name: string) {
  await page.locator(`#screen-${screen} button[aria-label="${name}"]`).click();
  await page.mouse.move(1, 1);
}

async function pressText(page: Page, screen: SharedScreen, text: string) {
  await page
    .locator(`#screen-${screen} button`, { hasText: new RegExp(`^${text}$`) })
    .click();
  await page.mouse.move(1, 1);
}

const CLIPS: readonly Clip[] = [
  {
    name: "throttle-50",
    title: "Navball: the station drags the throttle to 50%",
    widget: "navball",
    w: 10,
    h: 21,
    shots: {
      12: "12 s: 50% on its way. The thumb is the command; nothing has reached the craft",
      40: "40 s: the craft should be at 50% now, but its reading is still on the way home",
      57: "57 s: the craft's 50% has reached the centre",
    },
    script: async ({ page, still, grow, play }) => {
      await page.evaluate(() => window.__sharedScene.openThrottle());
      await caption(page, `${LABEL}, 0 s: the station drags the throttle`);
      await page.waitForTimeout(800);
      await drag(page, "station", 0.5, still);
      await grow();
      await play(0, 64, (s) =>
        s < ONE_WAY
          ? "50% on its way to the craft"
          : s < 2 * ONE_WAY
            ? "the craft should be at 50%, its reading on the way home"
            : "the craft's 50% has reached the centre",
      );
    },
  },
  {
    name: "throttle-full-zero",
    title: "Navball: the station presses FULL, the main screen ZERO 5 s later",
    widget: "navball",
    w: 10,
    h: 21,
    shots: {
      3: "3 s: FULL on its way",
      12: "12 s: ZERO is the newest command; FULL is still on its way",
      29: "29 s: FULL has reached the craft, ZERO has not: the craft should be at full now",
      40: "40 s: ZERO has reached the craft too",
      57: "57 s: the craft's full throttle reaches the centre",
      66: "66 s: the craft's 0% reaches the centre",
    },
    script: async ({ page, grow, play }) => {
      await page.evaluate(() => window.__sharedScene.openThrottle());
      await caption(page, `${LABEL}, 0 s: the station presses FULL`);
      await page.waitForTimeout(800);
      await pressText(page, "station", "FULL");
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__sharedScene.queueThrottle("station"));
      await grow();
      await play(0, 5, () => "FULL on its way to the craft");
      await caption(page, `${LABEL}, 5 s: the main screen presses ZERO`);
      await pressText(page, "main", "ZERO");
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__sharedScene.queueThrottle("main"));
      await play(5, 68, (s) =>
        s < ONE_WAY
          ? "FULL and ZERO on their way"
          : s < ONE_WAY + 5
            ? "FULL has reached the craft; ZERO has not"
            : s < 2 * ONE_WAY
              ? "ZERO has reached the craft; the readings are on their way home"
              : s < 2 * ONE_WAY + 5
                ? "the craft's full throttle has reached the centre"
                : "the craft's 0% has reached the centre",
      );
    },
  },
  {
    name: "throttle-held",
    title:
      "Navball: the station drags to 50%, and the link is lost from 30 s to 62 s",
    widget: "navball",
    w: 10,
    h: 21,
    shots: {
      40: "40 s: no live readings; the craft was last seen at 0%",
      66: "66 s: the link is back and the craft's 50% has come home",
    },
    script: async ({ page, still, grow, play }) => {
      await page.evaluate(() => window.__sharedScene.openThrottle());
      await caption(page, `${LABEL}, 0 s: the station drags the throttle`);
      await page.waitForTimeout(800);
      await drag(page, "station", 0.5, still);
      await grow();
      await play(0, 30, () => "50% on its way to the craft");
      await page.evaluate(() => window.__sharedScene.link(false));
      await play(30, 62, () => "link lost: no readings come home");
      await page.evaluate(() => window.__sharedScene.link(true));
      await play(62, 68, () => "link back");
    },
  },
  {
    name: "three-marks",
    title:
      "Navball: the station drags to 50%, the main screen presses FULL 5 s later, and the link is lost at 28 s",
    widget: "navball",
    w: 10,
    h: 21,
    shots: {},
    script: async ({ page, grow, play, closeUp }) => {
      await page.evaluate(() => window.__sharedScene.openThrottle());
      await caption(page, `${LABEL}, 0 s: the station drags the throttle`);
      await page.waitForTimeout(800);
      await drag(page, "station", 0.5, async () => {});
      await grow();
      await play(0, 5, () => "50% on its way to the craft");
      await caption(page, `${LABEL}, 5 s: the main screen presses FULL`);
      await pressText(page, "main", "FULL");
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__sharedScene.queueThrottle("main"));
      await play(5, 28, () => "50% and FULL on their way");
      await page.evaluate(() => window.__sharedScene.link(false));
      await play(
        28,
        30,
        () => "link lost; 50% has reached the craft, FULL has not",
      );
      await closeUp(
        "close-up: the handle at the command (FULL), the triangle where the craft should be now (50%), the square where it was last seen (0%)",
      );
    },
  },
  {
    name: "rotor-rpm",
    title:
      "Rotor Tachometer: the station raises the RPM cap to 350, the main screen lowers it 5 s later",
    widget: "rotor-tachometer",
    w: 6,
    h: 10,
    shots: {
      3: "3 s: 350 rpm on its way",
      12: "12 s: the main screen's 340 is the newest command",
      29: "29 s: 350 has reached the craft, 340 has not",
      57: "57 s: the craft's 350 reaches the centre",
      66: "66 s: the craft's 340 reaches the centre",
    },
    script: async ({ page, grow, play }) => {
      await caption(page, `${LABEL}, 0 s: the station raises the RPM cap`);
      await page.waitForTimeout(800);
      for (let i = 0; i < 5; i += 1) {
        await press(page, "station", "Raise RPM cap");
        await page.waitForTimeout(150);
        await page.evaluate(() => window.__sharedScene.queueRotor("station"));
      }
      await grow();
      await play(0, 5, () => "350 rpm on its way to the craft");
      await caption(page, `${LABEL}, 5 s: the main screen lowers the cap`);
      await press(page, "main", "Lower RPM cap");
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__sharedScene.queueRotor("main"));
      await play(5, 68, (s) =>
        s < ONE_WAY
          ? "350 and 340 on their way"
          : s < ONE_WAY + 5
            ? "350 has reached the craft; 340 has not"
            : s < 2 * ONE_WAY
              ? "340 has reached the craft; the readings are on their way home"
              : s < 2 * ONE_WAY + 5
                ? "the craft's 350 has reached the centre"
                : "the craft's 340 has reached the centre",
      );
    },
  },
];

async function record(
  browser: Browser,
  html: string,
  clip: Clip,
  rail: "expanded" | "collapsed",
  lines: string[],
) {
  const px = tilePixels(clip.w, clip.h);
  const viewport = viewportFor(px.pxW);
  const size = { ...viewport, width: 2 * px.pxW + 48 };
  const raw = join(OUT_DIR, `raw-${clip.name}-${rail}`);
  await rm(raw, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: raw, size },
  });
  const page = await context.newPage();
  await installFixedClock(page);
  page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
  await page.goto(pathToFileURL(html).toString());
  await page.waitForFunction(() => Boolean(window.__sharedScene));
  await page.evaluate((o) => window.__sharedScene.mount(o), {
    widget: clip.widget,
    w: clip.w,
    h: clip.h,
    pxW: px.pxW,
  });
  const name = `${LABEL}--${clip.name}--rail-${rail}`;
  const stills: string[] = [];
  const still: Still = async (moment, text) => {
    const file = `${name}--${moment}.png`;
    await page.locator("#root").screenshot({ path: join(OUT_DIR, file) });
    stills.push(
      `![${clip.title}, rail ${rail}, ${text}](${file})`,
      "",
      `Rail ${rail}, ${text}.`,
      "",
    );
  };
  const ctx: ClipContext = {
    page,
    still,
    closeUp: async (text) => {
      const file = `${name}--close-up.png`;
      const group = page
        .locator('#screen-main input[aria-label="Throttle"]')
        .locator("xpath=ancestor::div[2]");
      const box = await group.boundingBox();
      if (!box) throw new Error("no throttle row on the main screen");
      await page.screenshot({
        path: join(OUT_DIR, file),
        clip: {
          x: box.x - 8,
          y: box.y - 8,
          width: box.width + 16,
          height: box.height + 16,
        },
      });
      // Scaled up after the shot, so the marks read at the size of a phone screen.
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(OUT_DIR, file),
        "-vf",
        "scale=iw*3:ih*3:flags=lanczos",
        join(OUT_DIR, file.replace(".png", "-3x.png")),
      ]);
      stills.push(
        `![${clip.title}, rail ${rail}, ${text}](${file.replace(".png", "-3x.png")})`,
        "",
        `Rail ${rail}, ${text}.`,
        "",
      );
    },
    grow: async () => {
      if (rail === "expanded") {
        await page.evaluate(() => window.__sharedScene.step("grow", "main"));
      }
    },
    play: async (from, until, say) => {
      for (let s = from + 1; s <= until; s += 1) {
        await caption(page, `${LABEL}, rail ${rail}, ${s} s: ${say(s)}`);
        await page.evaluate(([t, ms]) => window.__sharedScene.glide(t, ms), [
          s,
          MS_PER_SECOND,
        ] as const);
        const shot = clip.shots[s];
        if (shot) await still(`${s}s`, shot);
      }
    },
  };
  await clip.script(ctx);
  await page.waitForTimeout(1500);
  await context.close();
  const [webm] = (await readdir(raw)).filter((f) => f.endsWith(".webm"));
  const file = `${name}.mp4`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    join(raw, webm),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(OUT_DIR, file),
  ]);
  await rm(raw, { recursive: true, force: true });
  lines.push(
    `## ${clip.title}, rail ${rail}`,
    "",
    `[${file}](${file})`,
    "",
    ...stills,
  );
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "shared-rail-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "throttle-command",
  });
  const browser = await chromium.launch();
  const lines: string[] = [`# Command controls, ${LABEL}`, ""];
  try {
    for (const clip of CLIPS) {
      if (ONLY && !clip.name.includes(ONLY)) continue;
      // Each clip records twice at once: they share nothing but the browser.
      const halves: string[][] = [[], []];
      await Promise.all([
        record(browser, html, clip, "expanded", halves[0]),
        record(browser, html, clip, "collapsed", halves[1]),
      ]);
      lines.push(...halves[0], ...halves[1]);
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    join(OUT_DIR, `INDEX-${LABEL}${ONLY ? `-${ONLY}` : ""}.md`),
    lines.join("\n"),
    "utf8",
  );
  console.log(`command controls ${LABEL} → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
