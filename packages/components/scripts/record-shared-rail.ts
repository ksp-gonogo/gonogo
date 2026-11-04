#!/usr/bin/env tsx
/**
 * Records a main screen and a station of one command centre side by side as
 * H.264 video, with the game clock running: a toggle pressed, answered by the
 * mod, carried to the craft and answered by it, a throttle input accepted with
 * a warning, and a toggle held at a relay. Each stage is captioned. Writes one
 * MP4 per widget to `--out` (default `.renders/sharedrail`), named by `--label`.
 * Needs an ffmpeg with libx264, named by the `FFMPEG` environment variable or
 * found on the path.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { tilePixels } from "./probe/payload";
import type { SharedScreen, SharedStep } from "./probe/shared-rail-entry";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
} from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/sharedrail"),
);
const LABEL = flag("--label") ?? "after";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const step = (page: Page, s: SharedStep, from: SharedScreen) =>
  page.evaluate(({ s, from }) => window.__sharedScene.step(s, from), {
    s,
    from,
  });
/** When the current clip's recording began, so each caption's moment can be printed for pulling stills. */
let recordingStart = 0;
const caption = (page: Page, text: string) => {
  console.log(
    `[at ${((Date.now() - recordingStart) / 1000).toFixed(2)} s] ${text}`,
  );
  return page.evaluate((t) => window.__sharedScene.caption(t), text);
};
/** Prints the moment `what` happened in the current clip's video. */
const mark = (what: string) =>
  console.log(
    `[at ${((Date.now() - recordingStart) / 1000).toFixed(2)} s] ${what}`,
  );

/** Runs game time from `from` to `to` seconds, `perSecondMs` of video for each game second, calling `at` on the way. */
async function run(
  page: Page,
  from: number,
  to: number,
  perSecondMs: number,
  at?: (seconds: number) => Promise<void>,
): Promise<void> {
  const stepS = 0.25;
  for (let s = from; s <= to + 1e-9; s += stepS) {
    await page.evaluate((x) => window.__sharedScene.at(x), s);
    await at?.(s);
    await pause(perSecondMs * stepS);
  }
}

interface Clip {
  name: string;
  /** Moments, in seconds of video, to pull a captioned still at, filled in as the clip plays. */
  stills?: { at: number; name: string }[];
  /** The file written, in place of `<label>--<name>.mp4`. */
  file?: string;
  delaySeconds?: number;
  widget: "navball" | "action-group";
  w: number;
  h: number;
  play: (page: Page) => Promise<void>;
}

/** The one-way delay of the failure-case clips. */
const D = 10;

/** Prints a mark and remembers it as a still to pull, just after it. */
let stills: { at: number; name: string }[] = [];
const still = (name: string) => {
  const at = (Date.now() - recordingStart) / 1000;
  stills.push({ at: at + 0.4, name });
  mark(name);
};

/** Opens both rails, as the operator pinning them, once there is a command to show. */
async function maybeGrow(page: Page, expanded: boolean, from: SharedScreen) {
  if (expanded) await step(page, "grow", from);
}

type Case = (page: Page, expanded: boolean) => Promise<void>;

/** A caption, with what the opened rail's square shows added when the rail is open. */
const say = (page: Page, expanded: boolean, text: string, square: string) =>
  caption(page, expanded ? `${text} Square: ${square}` : text);

const CASES: Record<string, Case> = {
  /** An RCS press through an on-time reply. */
  async ontime(page, expanded) {
    await caption(
      page,
      `RCS pressed on the main screen, ${D} s each way. It reaches the craft a third along the rail, and its reply is due at the two-thirds line.`,
    );
    await step(page, "press", "main");
    still("1-press");
    await pause(300);
    await step(page, "accept", "main");
    await step(page, "travel", "main");
    await maybeGrow(page, expanded, "main");
    await pause(600);
    still("2-sent");
    let done = false;
    await run(page, 0, 3 * D + 2, 1000, async (s) => {
      if (s === D) {
        await say(
          page,
          expanded,
          `${D} s: RCS reaches the craft, a third along. Both buttons show RCS ON as predicted, marked modelled, while the reply is on its way.`,
          "bar half full.",
        );
        still("3-at-craft");
      }
      if (s === 2 * D - 1) still("4-reply-nearly-home");
      if (s >= 2 * D && !done) {
        done = true;
        await page.evaluate(() => window.__sharedScene.answer("done"));
        await say(
          page,
          expanded,
          `${2 * D} s: the reply lands at the two-thirds line. RCS ON is confirmed on both screens, and the mark carries on through the last third.`,
          "bar full, and it stays full until the square fades with the mark at the end.",
        );
        still("5-answered");
      }
      if (s === 2 * D + D / 2) still("6-confirmed-stage");
      if (s === 3 * D - 1) {
        await caption(
          page,
          `${3 * D - 1} s: the mark nears the end, where it fades at ${3 * D} s.`,
        );
        still("7-end");
      }
    });
  },
  /** A reply that comes back late. */
  async late(page, expanded) {
    await caption(
      page,
      `RCS pressed on the main screen, ${D} s each way. Its reply is due at ${2 * D} s, but it will be late.`,
    );
    await step(page, "press", "main");
    await pause(300);
    await step(page, "accept", "main");
    await step(page, "travel", "main");
    await maybeGrow(page, expanded, "main");
    let done = false;
    await run(page, 0, 3 * D + 12, 1000, async (s) => {
      if (s === D) still("1-at-craft");
      if (s === 2 * D) {
        await say(
          page,
          expanded,
          `${2 * D} s: the reply is due and nothing has come back. The mark waits at the two-thirds line; the buttons still show the prediction.`,
          "bar full, waiting.",
        );
        still("2-due");
      }
      if (s === 2 * D + 4) {
        await step(page, "overdue", "main");
        await say(
          page,
          expanded,
          `${2 * D + 4} s: the command centre finds the reply overdue. Both marks turn amber, still waiting at two thirds, and the buttons go back to the reading.`,
          "amber, bar full, a clear button.",
        );
        still("3-overdue");
      }
      if (s >= 2 * D + 10 && !done) {
        done = true;
        await page.evaluate(() => window.__sharedScene.answer("done"));
        await caption(
          page,
          `${2 * D + 10} s: the reply arrives late. Both rails say the unconfirmed command was answered, both buttons read RCS ON, and both marks carry on from two thirds through the last third.`,
        );
        still("4-late-reply");
      }
      if (s === 2 * D + 16) still("5-confirmed-stage");
    });
  },
  /** An error reply from the craft: the command is refused. */
  async refused(page, expanded) {
    await caption(
      page,
      `RCS pressed on the main screen, ${D} s each way. The craft will refuse it.`,
    );
    await step(page, "press", "main");
    await pause(300);
    await step(page, "accept", "main");
    await step(page, "travel", "main");
    await maybeGrow(page, expanded, "main");
    let done = false;
    await run(page, 0, 2 * D + 6, 1000, async (s) => {
      if (s === D) {
        await caption(
          page,
          `${D} s: RCS reaches the craft, a third along. Both buttons show RCS ON as predicted, marked modelled.`,
        );
        still("1-at-craft");
      }
      if (s >= 2 * D && !done) {
        done = true;
        await page.evaluate(() => window.__sharedScene.answer("refused"));
        await say(
          page,
          expanded,
          `${2 * D} s: the reply lands at the two-thirds line: the craft refused it. The mark turns amber and fades there, both rails say why, and RCS is back to OFF.`,
          "bar full, turning amber as it fades.",
        );
        still("2-refused");
      }
      if (s === 2 * D + 4) still("3-after");
    });
  },
  /** A command held at a relay while the link is down, which the centre learns of only from the relay's reports. */
  async held(page, expanded) {
    await page.evaluate(() => window.__sharedScene.link(false));
    await caption(
      page,
      "The link to the craft is down. RCS pressed on the station. The plan says a relay 4 s out will hold it until contact returns, but nobody knows until the relay reports, so the mark sets out from 0 as if nothing holds it.",
    );
    await step(page, "press", "station");
    await pause(300);
    await step(page, "hold", "station");
    await maybeGrow(page, expanded, "station");
    await pause(600);
    still("1-sent");
    const arrive = 12 + (D - 4);
    const report = (kind: "held" | "departed") =>
      page.evaluate((k) => window.__sharedScene.report(k), kind);
    let done = false;
    await run(page, 0, arrive + 2 * D + 2, 1000, async (s) => {
      if (s === 4) {
        await caption(
          page,
          "4 s: RCS reaches the relay and waits there. The centre cannot know yet: the mark is at the relay's place, about 0.13 of the rail, and carries on past it.",
        );
        still("2-at-relay-unheard");
      }
      if (s === 7) {
        await caption(
          page,
          "7 s: the relay's report is on its way home. The mark is still going out, past the relay's place, short of the 1/3 line.",
        );
        still("3-report-on-its-way");
      }
      if (s === 8) {
        await report("held");
        await say(
          page,
          expanded,
          "8 s: the relay's report that it holds RCS reaches the centre, 4 s of light home. The mark goes back to the relay's place, about 0.13 of the rail, in amber.",
          "amber, bar a fifth full, where the relay is.",
        );
        still("4-hold-heard");
      }
      if (s === 12) {
        await page.evaluate(() => window.__sharedScene.link(true));
        await caption(
          page,
          "12 s: contact returns and the relay sends RCS on. The centre does not know yet: the mark waits at the relay.",
        );
        still("5-sent-on-unheard");
      }
      if (s === 16) {
        await report("departed");
        await caption(
          page,
          "16 s: the relay's report that it sent RCS on at 12 s reaches the centre. The mark moves to where RCS is by now, two thirds of the way from the relay to the craft.",
        );
        still("6-departure-heard");
      }
      if (s === arrive) {
        await caption(
          page,
          `${arrive} s: RCS reaches the craft, at the 1/3 line. Both buttons read RCS ON, modelled.`,
        );
        still("7-at-craft");
      }
      if (s >= arrive + D && !done) {
        done = true;
        await page.evaluate(() => window.__sharedScene.answer("done"));
        await caption(
          page,
          `${arrive + D} s: the reply lands at the 2/3 line. RCS ON on both screens, and the mark carries on through the last third.`,
        );
        still("8-answered");
      }
    });
  },
};

/** Several commands in flight at once, from both screens, half a second apart, on the opened rail. */
const NAMES = ["RCS", "SAS", "PRECISION"] as const;
function many(count: number) {
  return async (page: Page) => {
    const press = (from: SharedScreen, name: (typeof NAMES)[number]) =>
      page.evaluate(
        ({ from, name }) => window.__sharedScene.pressAndSend(from, name),
        { from, name },
      );
    await caption(
      page,
      `${count} commands at once, ${D} s each way, a quarter of a second apart, alternately from the main screen and the station.`,
    );
    const spacing = 0.25;
    for (let i = 0; i < count; i += 1) {
      await page.evaluate((t) => window.__sharedScene.at(t), i * spacing);
      await press(i % 2 === 0 ? "main" : "station", NAMES[i % NAMES.length]);
      if (i === 0) await step(page, "grow", "main");
      await pause(spacing * 1000);
    }
    still("1-sent");
    const last = (count - 1) * spacing;
    let done = false;
    await run(page, last, 3 * D + 3, 1000, async (s) => {
      if (s === D / 2) {
        await caption(
          page,
          `${D / 2} s: one mark per command in lanes from the middle of the graph, each about 0.15 along. One queue box holds every square, bars about a quarter full${count > 6 ? "; it scrolls sideways, the glow at its right edge saying there are more" : ""}.`,
        );
        still("2-lanes");
      }
      if (s === D + 1 + last) {
        await caption(
          page,
          `${D + 1 + last} s: every command has reached the craft, past the 1/3 line; bars over half full.`,
        );
        still("3-at-craft");
      }
      if (s >= 2 * D + last && !done) {
        done = true;
        await page.evaluate(() => window.__sharedScene.answer("done"));
        await caption(
          page,
          `${2 * D + last} s: the replies land at the 2/3 line. Every bar is full, and the marks carry on through the last third in their lanes.`,
        );
        still("4-answered");
      }
      if (s === 3 * D - 2) still("5-confirmed-stage");
    });
  };
}

/** Close-ups of a mark's tooltip: hovered and focused on the opened rail, and the closed rail's button focused. */
async function tooltips(page: Page) {
  const shot = async (name: string, selector: string) => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no ${selector}`);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT_DIR, `${LABEL}--tooltip-${name}.png`),
      clip: {
        x: Math.max(0, box.x - 20),
        y: Math.max(0, box.y - 20),
        width: Math.min(360, box.width + 40),
        height: 170,
      },
    });
    console.log(`wrote tooltip-${name}`);
  };
  await caption(page, "Tooltips on the marks.");
  await page.evaluate(() => window.__sharedScene.pressAndSend("main", "RCS"));
  await page.evaluate(() =>
    window.__sharedScene.pressAndSend("station", "SAS"),
  );
  await run(page, 0, 3, 200);
  await step(page, "grow", "main");
  await pause(600);
  // Hovered on the opened rail.
  await page.hover('#screen-main [role="img"][data-role="glow"]');
  await shot("hover-opened", "#screen-main [data-panel-rail]");
  // Focused by keyboard on the opened rail.
  await page.mouse.move(0, 0);
  await page.focus('#screen-main [role="img"][data-role="glow"]');
  await shot("focus-opened", "#screen-main [data-panel-rail]");
  // The closed rail's button, focused by keyboard on the station, once its rail is closed again.
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>(
        '#screen-station button[aria-label="Signal-delay detail"]',
      )
      ?.click(),
  );
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await pause(600);
  await page.focus('#screen-station button[aria-label="Signal-delay detail"]');
  await shot("focus-closed", "#screen-station [data-panel-rail]");
}

const CASE_CLIPS: Clip[] = [
  {
    name: "tooltips",
    widget: "navball" as const,
    w: 8,
    h: 15,
    delaySeconds: D,
    play: tooltips,
  },
  ...Object.entries(CASES).flatMap(([name, play]) =>
    (["collapsed", "expanded"] as const).map((rail) => ({
      name: `${name}-${rail}`,
      widget: "navball" as const,
      w: 8,
      h: 15,
      delaySeconds: D,
      play: (page: Page) => play(page, rail === "expanded"),
    })),
  ),
  ...[3, 5, 8].map((count) => ({
    name: `many${count}-expanded`,
    widget: "navball" as const,
    w: 8,
    h: 15,
    delaySeconds: D,
    play: many(count),
  })),
];

const CLIPS: Clip[] = [
  ...CASE_CLIPS,
  {
    name: "collapsed",
    widget: "navball",
    w: 8,
    h: 15,
    // The rail as it sits on a dashboard, collapsed, at real speed: one second of video for each second of game time.
    async play(page) {
      await caption(
        page,
        "RCS pressed on the main screen, 27.4 s each way to the craft. Both rails collapsed, as on a dashboard.",
      );
      mark("press");
      await step(page, "press", "main");
      await pause(300);
      mark("accepted");
      await step(page, "accept", "main");
      await step(page, "travel", "main");
      let reached = false;
      let answered = false;
      await run(page, 0, 58, 1000, async (s) => {
        if (s >= 27.4 && !reached) {
          reached = true;
          await caption(
            page,
            "RCS reaches the craft at 27.4 s. Its reply is due back at 54.8 s.",
          );
        }
        if (s >= 54.8 && !answered) {
          answered = true;
          mark("answered");
          await page.evaluate(() => window.__sharedScene.answer());
          await caption(page, "The reply is back: both buttons read RCS ON.");
        }
      });
      await pause(2000);
    },
  },
  {
    name: "rail",
    file: "rail.mp4",
    widget: "navball",
    w: 8,
    h: 15,
    delaySeconds: 10,
    // Real speed: one second of video for each second of game time.
    async play(page) {
      await caption(
        page,
        "1. A main screen and a station of one command centre, 10 s each way to the craft. RCS pressed on the main screen: its button reads SENT until the mod answers the press.",
      );
      await step(page, "press", "main");
      await pause(3000);
      await caption(
        page,
        "2. The mod has answered: SENT clears. Both rails show RCS on its way to the craft.",
      );
      await step(page, "accept", "main");
      await step(page, "travel", "main");
      await run(page, 0, 2, 1000);
      await step(page, "grow", "main");
      await caption(
        page,
        "3. RCS reaches the craft at 10 s, and its reply is due back at 20 s. The bar under the RCS square fills as it travels.",
      );
      let answered = false;
      await run(page, 2, 20.5, 1000, async (s) => {
        if (s >= 20 && !answered) {
          answered = true;
          await page.evaluate(() => window.__sharedScene.answer());
        }
      });
      await caption(
        page,
        "4. The reply is back: both rails clear, and both buttons read RCS ON.",
      );
      await pause(3000);
      await caption(
        page,
        "5. RCS pressed on the station, and the route will hold it at a relay: both buttons get the small amber held square, and both rails carry it.",
      );
      await step(page, "press", "station");
      await step(page, "accept", "station");
      await step(page, "hold", "station");
      await run(page, 20.5, 27, 1000);
      await caption(
        page,
        "6. Throttle to FULL on the main screen. The mod accepts it with a warning, and both rails show it.",
      );
      await step(page, "throttle", "main");
      await step(page, "warn", "main");
      await pause(3000);
      await caption(page, "7. The warning sentence, the same on both screens.");
      await pause(5000);
    },
  },
  {
    name: "navball",
    widget: "navball",
    w: 8,
    h: 15,
    async play(page) {
      await caption(
        page,
        "1. RCS pressed on the main screen (27 s each way to the craft). Its button reads SENT until the mod answers the press.",
      );
      await step(page, "press", "main");
      await pause(2500);
      await caption(
        page,
        "2. The mod has answered: SENT clears, and both screens' rails show RCS on its way. Opened, a rail shows each command as a square: its short name, and a bar for how far through the trip it is.",
      );
      await step(page, "accept", "main");
      await step(page, "travel", "main");
      await run(page, 0, 3, 160);
      await step(page, "grow", "main");
      await pause(2500);
      await caption(
        page,
        "3. Game time runs: RCS reaches the craft at 27 s, and its reply is due back at 55 s.",
      );
      let answered = false;
      await run(page, 3, 56, 160, async (s) => {
        if (s >= 55 && !answered) {
          answered = true;
          await page.evaluate(() => window.__sharedScene.answer());
        }
      });
      await caption(
        page,
        "4. The reply is back: both rails clear and both buttons read RCS ON.",
      );
      await pause(2500);
      await caption(
        page,
        "5. Throttle to FULL on the main screen. The mod accepts it with a warning, and both rails count it: 1 warning.",
      );
      await step(page, "throttle", "main");
      await step(page, "warn", "main");
      await pause(2500);
      await caption(
        page,
        "6. Opened, both rails show the same warning sentence.",
      );
      await pause(4000);
    },
  },
  {
    name: "action-group",
    widget: "action-group",
    w: 6,
    h: 6,
    async play(page) {
      await caption(
        page,
        "1. Light pressed on the station. Its button reads SENT until the mod answers the press.",
      );
      await step(page, "press", "station");
      await pause(2500);
      await caption(
        page,
        "2. The mod has answered, and the route will hold the command at a relay. Both screens show it: the small amber square on the button marks it held, and the rail carries it (LIGH).",
      );
      await step(page, "accept", "station");
      await step(page, "hold", "station");
      await step(page, "grow", "station");
      await pause(3500);
      await caption(
        page,
        "3. Game time runs while the command waits for the relay's window.",
      );
      await run(page, 0, 30, 160);
      await pause(2000);
    },
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "shared-rail-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "shared-rail-video",
  });
  const browser = await chromium.launch();
  try {
    const only = flag("--clip");
    const match = (name: string) =>
      !only ||
      only.split(",").some((o) => name === o || name.startsWith(`${o}-`));
    for (const clip of CLIPS.filter((c) => match(c.name))) {
      stills = [];
      const px = tilePixels(clip.w, clip.h);
      // Even sizes, which H.264 needs.
      const size = {
        width: Math.ceil((2 * px.pxW + 16 + 24) / 2) * 2,
        height: Math.ceil((px.pxH + 100) / 2) * 2,
      };
      const videoDir = join(OUT_DIR, `.video-${clip.name}`);
      await rm(videoDir, { recursive: true, force: true });
      const context = await browser.newContext({
        viewport: size,
        recordVideo: { dir: videoDir, size },
      });
      const page = await context.newPage();
      recordingStart = Date.now();
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__sharedScene));
      await page.evaluate((o) => window.__sharedScene.mount(o), {
        widget: clip.widget,
        w: clip.w,
        h: clip.h,
        pxW: px.pxW,
        delaySeconds: clip.delaySeconds,
      });
      await pause(800);
      await clip.play(page);
      await context.close();
      const [webm] = (await readdir(videoDir)).filter((f) =>
        f.endsWith(".webm"),
      );
      const mp4 = join(OUT_DIR, clip.file ?? `${LABEL}--${clip.name}.mp4`);
      await execFileAsync(FFMPEG, [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(videoDir, webm),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ]);
      await rm(videoDir, { recursive: true, force: true });
      console.log(`wrote ${mp4}`);
      for (const s of stills) {
        const png = mp4.replace(/\.mp4$/, `--${s.name}.png`);
        await execFileAsync(FFMPEG, [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          s.at.toFixed(2),
          "-i",
          mp4,
          "-frames:v",
          "1",
          png,
        ]);
        console.log(`wrote ${png}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
