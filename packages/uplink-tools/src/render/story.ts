import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import type { Page } from "playwright";
import { type Engine, engine } from "./driver";
import { encodeGif } from "./gif";

/** The tag that marks a story as one that plays over time, so it renders as a GIF. */
export const PLAYBACK_TAG = "playback";

const ENGINES = new Set(["chromium", "firefox", "webkit"]);

export const STORY_USAGE = `uplink-tools story <story-id> [options]

  Render one Storybook story to an image: a PNG for a still story, a GIF for
  one that plays over time (tagged "${PLAYBACK_TAG}" in its meta).

    uplink-tools story widgets-landing-status-descent-playback--crash-landing

  --storybook <dir|url>  a built Storybook directory, or the address of a
                         running one (default: ./storybook-static)
  --out <path>           a .png or .gif file, or a directory (default: renders/)
  --list [text]          print the story ids in the Storybook, only those
                         containing the text when given, and render nothing
  --gif                  render as a GIF even when the story is not tagged
  --png                  render the first settled frame, even when the story
                         is tagged
  --seconds <n>          GIF length (default: the story's own, from the element it
                         marks [data-story-seconds], else 6)
  --fps <n>              GIF frame rate, 1 to 30 (default: 10)
  --chrome               draw the whole story frame, with its Replay button and
                         captions. Without it the picture is the widget alone,
                         cropped to the element a story marks as
                         [data-story-widget]
  --size <WxH>           browser viewport (default: 1280x900)
  --scale <n>            device pixel ratio, 1 to 4 (default: 1)
  --start <name>         the button that starts a playback story, clicked once
                         the story has rendered (default: the element marked
                         [data-story-start], else Replay or Play). It is pressed
                         even when it is outside the picture.
                         A story that starts on its own needs none
  --engine <e>           chromium | firefox | webkit (default: chromium)

  A GIF carries no sound. Chromium is launched muted, so a story whose control
  is Play can be started without anything coming out of the speakers.
`;

export interface StoryArgs {
  id?: string;
  list: boolean;
  /** The text a \`--list\` run filters on. */
  listFilter?: string;
  storybook: string;
  out?: string;
  format: "auto" | "gif" | "png";
  seconds: number;
  /** Whether `--seconds` was given, which wins over the length a story states for itself. */
  secondsGiven: boolean;
  fps: number;
  width: number;
  height: number;
  scale: number;
  start?: string;
  /** Draw the whole story frame, controls and captions included, rather than the widget. */
  chrome: boolean;
  engine: Engine;
}

function numberFlag(
  flag: string,
  raw: string,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(
      `${flag} takes a number from ${min} to ${max}, got "${raw}"`,
    );
  }
  return n;
}

/** Everything the command line says, and the first thing it says wrong. */
export function parseStoryArgs(argv: readonly string[]): StoryArgs {
  const args: StoryArgs = {
    list: false,
    storybook: "storybook-static",
    format: "auto",
    seconds: 6,
    secondsGiven: false,
    fps: 10,
    width: 1280,
    height: 900,
    scale: 1,
    chrome: false,
    engine: "chromium",
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} needs a value\n\n${STORY_USAGE}`);
      }
      return next;
    };
    switch (flag) {
      case "--storybook":
        args.storybook = value();
        break;
      case "--out":
        args.out = value();
        break;
      case "--list":
        args.list = true;
        break;
      case "--gif":
      case "--png":
        if (args.format !== "auto") {
          throw new Error("--gif and --png do not combine");
        }
        args.format = flag === "--gif" ? "gif" : "png";
        break;
      case "--seconds":
        args.seconds = numberFlag(flag, value(), 0.5, 60);
        args.secondsGiven = true;
        break;
      case "--fps":
        args.fps = numberFlag(flag, value(), 1, 30);
        break;
      case "--scale":
        args.scale = numberFlag(flag, value(), 1, 4);
        break;
      case "--size": {
        const match = /^(\d+)x(\d+)$/.exec(value());
        if (!match)
          throw new Error("--size takes WIDTHxHEIGHT, such as 800x600");
        args.width = numberFlag("--size width", match[1], 100, 4000);
        args.height = numberFlag("--size height", match[2], 100, 4000);
        break;
      }
      case "--chrome":
        args.chrome = true;
        break;
      case "--start":
        args.start = value();
        break;
      case "--engine": {
        const engine = value();
        if (!ENGINES.has(engine)) {
          throw new Error(
            `--engine must be one of ${[...ENGINES].join(", ")}, got "${engine}"`,
          );
        }
        args.engine = engine as Engine;
        break;
      }
      default:
        if (flag.startsWith("-")) {
          throw new Error(
            `${flag} is not an option of story\n\n${STORY_USAGE}`,
          );
        }
        positionals.push(flag);
    }
  }
  if (args.list) {
    if (positionals.length > 1) {
      throw new Error(`--list takes at most one filter\n\n${STORY_USAGE}`);
    }
    args.listFilter = positionals[0];
    return args;
  }
  if (positionals.length === 0) {
    throw new Error(`story needs a story id\n\n${STORY_USAGE}`);
  }
  if (positionals.length > 1) {
    throw new Error(
      `story renders one story, got ${positionals.length}\n\n${STORY_USAGE}`,
    );
  }
  args.id = positionals[0];
  if (args.format === "png" && args.start !== undefined) {
    throw new Error("--start only applies to a GIF");
  }
  return args;
}

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  tags: string[];
}

/** The stories of an `index.json`, refusing one of any other shape. */
export function storiesOfIndex(index: unknown, source: string): StoryEntry[] {
  const entries =
    typeof index === "object" && index !== null
      ? Reflect.get(index, "entries")
      : undefined;
  if (typeof entries !== "object" || entries === null) {
    throw new Error(`${source} holds no story entries.`);
  }
  const out: StoryEntry[] = [];
  for (const entry of Object.values(entries)) {
    if (typeof entry !== "object" || entry === null) continue;
    if (Reflect.get(entry, "type") !== "story") continue;
    const id = Reflect.get(entry, "id");
    if (typeof id !== "string") continue;
    const text = (key: string) => {
      const v = Reflect.get(entry, key);
      return typeof v === "string" ? v : "";
    };
    const tags = Reflect.get(entry, "tags");
    out.push({
      id,
      title: text("title"),
      name: text("name"),
      tags: Array.isArray(tags)
        ? tags.filter((t): t is string => typeof t === "string")
        : [],
    });
  }
  return out;
}

/** The story an id names, or an error naming the ids it was nearest to. */
export function findStory(
  entries: readonly StoryEntry[],
  id: string,
): StoryEntry {
  const exact = entries.find((entry) => entry.id === id);
  if (exact) return exact;
  const needle = id.toLowerCase();
  const near = entries
    .filter(
      (entry) =>
        entry.id.includes(needle) ||
        needle.includes(entry.id) ||
        needle
          .split(/[-]+/)
          .filter(Boolean)
          .every((part) => entry.id.includes(part)),
    )
    .slice(0, 8);
  throw new Error(
    `no story has the id "${id}"` +
      (near.length > 0
        ? `. Nearest:\n  ${near.map((entry) => entry.id).join("\n  ")}`
        : ". `uplink-tools story --list <text>` prints the ids that contain some text."),
  );
}

/** Whether this run draws a GIF. */
export function isAnimated(entry: StoryEntry, args: StoryArgs): boolean {
  if (args.format !== "auto") return args.format === "gif";
  return entry.tags.includes(PLAYBACK_TAG);
}

/** Where the picture goes: a file as named, or `<dir>/<id>.<ext>` for a directory. */
export function outputPath(
  cwd: string,
  out: string | undefined,
  id: string,
  animated: boolean,
): string {
  const ext = animated ? ".gif" : ".png";
  const target = resolve(cwd, out ?? "renders");
  const given = extname(target).toLowerCase();
  if (given === ".png" || given === ".gif") {
    if (given !== ext) {
      throw new Error(
        `${out} is a ${given} file, but this story renders as a ${ext}` +
          (animated
            ? ". Pass --png for its first frame."
            : ". Pass --gif to animate it."),
      );
    }
    return target;
  }
  return join(target, `${id}${ext}`);
}

/**
 * The frames a uniform `fps` grid over `seconds` picks from frames captured at
 * irregular instants: each tick takes the latest frame taken at or before it.
 *
 * Capturing as fast as the browser can and resampling, rather than waiting for
 * each tick, keeps the animation's pace true when a screenshot is slow.
 */
export function resample<Frame>(
  captured: readonly { at: number; frame: Frame }[],
  fps: number,
  seconds: number,
): Frame[] {
  if (captured.length === 0) throw new Error("resample: no frames captured");
  const count = Math.max(1, Math.round(fps * seconds));
  const out: Frame[] = [];
  let at = 0;
  for (let tick = 0; tick < count; tick++) {
    const when = (tick * 1000) / fps;
    while (at + 1 < captured.length && captured[at + 1].at <= when) at++;
    out.push(captured[at].frame);
  }
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveDirectory(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(dir, path);
    if (!file.startsWith(dir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/** A Storybook to draw from: the address of a running one, or a built directory served here. */
async function openStorybook(
  location: string,
  cwd: string,
): Promise<{ base: string; close: () => void }> {
  if (/^https?:\/\//.test(location)) {
    return { base: location.replace(/\/$/, ""), close: () => {} };
  }
  const dir = resolve(cwd, location);
  if (!existsSync(join(dir, "index.json"))) {
    throw new Error(
      `${dir} holds no built Storybook (no index.json). Build one with ` +
        "`storybook build`, or point --storybook at the directory or the " +
        "address of a running one.",
    );
  }
  const { server, url } = await serveDirectory(dir);
  return { base: url, close: () => server.close() };
}

/**
 * A page-side recorder of the preview's own verdict on the story, set before
 * Storybook runs. `sb-show-main` is set before the story's tree is in the DOM,
 * so only `storyRendered` says the picture is there to take.
 */
const LISTEN_FOR_RENDER = `
  (() => {
    const state = { rendered: false, failed: null };
    window.__storyRender = state;
    const attach = () => {
      const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel || typeof channel.on !== "function") {
        setTimeout(attach, 10);
        return;
      }
      channel.on("storyRendered", () => { state.rendered = true; });
      for (const event of ["storyErrored", "storyThrewException", "playFunctionThrewException", "storyMissing"]) {
        channel.on(event, (error) => { state.failed = event + ": " + JSON.stringify(error); });
      }
    };
    attach();
  })();
`;

/** What a story marks its widget with, so the picture can be just the widget. */
const WIDGET_SELECTOR = "[data-story-widget]";
/**
 * Refuses a picture that is not exactly one loop of its story: first frame to last, with no wrap.
 * A frame equal to the first, coming back after the picture has moved on, means the story started over inside it; a length other than the one the story states means it holds more or less than a run.
 */
export function assertOneLoop(
  frames: readonly Buffer[],
  run: { stated?: number; seconds?: number; fps?: number },
): void {
  const moved = frames.findIndex((f) => !f.equals(frames[0]));
  if (moved > 0) {
    const back = frames.findIndex((f, i) => i > moved && f.equals(frames[0]));
    if (back > 0) {
      throw new Error(
        `the picture holds more than one loop of its story: frame ${back + 1} of ${frames.length} is the first frame again`,
      );
    }
  }
  if (
    run.stated !== undefined &&
    run.seconds !== undefined &&
    Math.abs(run.seconds - run.stated) > 0.5
  ) {
    throw new Error(
      `the story runs for ${run.stated} seconds but the picture is ${run.seconds} seconds long, so it does not hold exactly one loop; leave --seconds out`,
    );
  }
}

/** What a playback story marks its running time with, in seconds. */
const SECONDS_SELECTOR = "[data-story-seconds]";

/** The part of a page `statedSeconds` reads: a locator that can hand back an attribute. */
export interface SecondsPage {
  locator(selector: string): {
    first(): {
      getAttribute(
        name: string,
        options?: { timeout?: number },
      ): Promise<string | null>;
    };
  };
}

/** The running time a story states for itself, within what a GIF may be, or `fallback` when it states none. */
export async function statedSeconds(
  page: SecondsPage,
  fallback: number,
): Promise<number> {
  const raw = await page
    .locator(SECONDS_SELECTOR)
    .first()
    .getAttribute("data-story-seconds", { timeout: 500 })
    .catch(() => null);
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) && n >= 0.5 && n <= 60
    ? n
    : fallback;
}

/** What a playback story marks its start control with. */
const START_SELECTOR = "[data-story-start]";
const STORY_ROOT = "#storybook-root";

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest whole-pixel rectangle holding every box, or nothing when there are none or all are empty. */
export function unionClip(boxes: readonly Clip[]): Clip | undefined {
  const drawn = boxes.filter((box) => box.width > 0 && box.height > 0);
  if (drawn.length === 0) return undefined;
  const left = Math.floor(Math.min(...drawn.map((box) => box.x)));
  const top = Math.floor(Math.min(...drawn.map((box) => box.y)));
  const right = Math.ceil(Math.max(...drawn.map((box) => box.x + box.width)));
  const bottom = Math.ceil(Math.max(...drawn.map((box) => box.y + box.height)));
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: right - Math.max(0, left),
    height: bottom - Math.max(0, top),
  };
}

/** Every element a selector matches, as a rectangle in page coordinates. */
async function measure(page: Page, selector: string): Promise<Clip[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        width: r.width,
        height: r.height,
      };
    }),
  );
}

const START_PATTERN = /^(replay|play)\b/i;

/** Renders the story an argument list names, and returns the path it wrote. */
export async function renderStory(
  args: StoryArgs,
  cwd: string = process.cwd(),
): Promise<string> {
  if (args.id === undefined) throw new Error("story needs a story id");
  const storybook = await openStorybook(args.storybook, cwd);
  try {
    const res = await fetch(`${storybook.base}/index.json`);
    const entry = findStory(
      storiesOfIndex(await res.json(), `${storybook.base}/index.json`),
      args.id,
    );
    const animated = isAnimated(entry, args);
    const file = outputPath(cwd, args.out, entry.id, animated);

    const browser = await (await engine(args.engine)).launch(
      args.engine === "chromium" ? { args: ["--mute-audio"] } : {},
    );
    try {
      const context = await browser.newContext({
        viewport: { width: args.width, height: args.height },
        deviceScaleFactor: args.scale,
        reducedMotion: animated ? "no-preference" : "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.addInitScript(LISTEN_FOR_RENDER);
      await page.goto(
        `${storybook.base}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
      );
      await page.waitForFunction(
        "window.__storyRender.rendered || window.__storyRender.failed !== null",
        undefined,
        { timeout: 30_000 },
      );
      const failure: unknown = await page.evaluate(
        "window.__storyRender.failed",
      );
      if (typeof failure === "string" || errors.length > 0) {
        throw new Error(
          `story ${entry.id} did not render: ${typeof failure === "string" ? failure : errors.join("; ")}`,
        );
      }
      const picture = async (): Promise<Clip> => {
        const wanted = args.chrome ? STORY_ROOT : WIDGET_SELECTOR;
        let boxes = await measure(page, wanted);
        if (boxes.length === 0 && wanted !== STORY_ROOT) {
          console.warn(
            `  ${entry.id} marks no ${WIDGET_SELECTOR}, so the whole story is drawn`,
          );
          boxes = await measure(page, STORY_ROOT);
        }
        const clip = unionClip(boxes);
        if (clip === undefined)
          throw new Error(`story ${entry.id} drew no box`);
        return clip;
      };

      if (!animated) {
        // Past the first paint of anything that mounts after the story reports rendered.
        await page.waitForTimeout(600);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
          file,
          await page.screenshot({ clip: await picture(), fullPage: true }),
        );
        return file;
      }

      const starter = args.start
        ? page.getByRole("button", { name: args.start, exact: true })
        : page
            .locator(START_SELECTOR)
            .or(page.getByRole("button", { name: START_PATTERN }));
      const clicked = (await starter.count()) > 0;
      if (args.start !== undefined && !clicked) {
        throw new Error(
          `story ${entry.id} has no button named "${args.start}" to start it`,
        );
      }
      // A playback story that knows how long it runs says so, so its picture is not cut off partway.
      const stated = await statedSeconds(page, Number.NaN);
      const seconds = args.secondsGiven
        ? args.seconds
        : Number.isNaN(stated)
          ? args.seconds
          : stated;
      const began = Date.now();
      if (clicked) await starter.first().click();

      const clip = await picture();
      const captured: { at: number; frame: Buffer }[] = [];
      while (Date.now() - began < seconds * 1000) {
        const at = Date.now() - began;
        captured.push({
          at,
          frame: await page.screenshot({ clip, fullPage: true }),
        });
      }
      const frames = resample(captured, args.fps, seconds);
      assertOneLoop(frames, {
        stated: Number.isNaN(stated) ? undefined : stated,
        seconds,
        fps: args.fps,
      });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        encodeGif(frames, { fps: args.fps, pingPong: false }),
      );
      return file;
    } finally {
      await browser.close();
    }
  } finally {
    storybook.close();
  }
}

/** `uplink-tools story`: `--list` prints ids, anything else renders one story. */
export async function storyCommand(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(STORY_USAGE);
    return;
  }
  const args = parseStoryArgs(argv);
  if (args.list) {
    const storybook = await openStorybook(args.storybook, process.cwd());
    try {
      const res = await fetch(`${storybook.base}/index.json`);
      const needle = args.listFilter?.toLowerCase() ?? "";
      for (const entry of storiesOfIndex(await res.json(), storybook.base)) {
        if (!entry.id.includes(needle)) continue;
        console.log(
          `${entry.id}${entry.tags.includes(PLAYBACK_TAG) ? "  (gif)" : ""}`,
        );
      }
    } finally {
      storybook.close();
    }
    return;
  }
  console.log(`wrote ${await renderStory(args)}`);
}
