#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium, type Frame, type Page } from "playwright";
/**
 * Review-render driver for a part's game window opened as a form on the
 * dashboard: a press in flight, the form, an instant close, and a window shown
 * only to the screen whose press opened it. Writes phone-sized H.264 clips.
 *
 * Run via
 * `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-game-window-mirror.ts [--out <dir>]`.
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";
import { jetbrainsMonoFontFace } from "./jetbrainsMonoFontFace";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, "game-window-mirror-probe/entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

function outDir(): string {
  const flag = process.argv.indexOf("--out");
  if (flag !== -1 && process.argv[flag + 1] !== undefined) {
    return resolve(process.argv[flag + 1]);
  }
  return resolve(HERE, "../../../../../.renders/mirror-rail");
}

/* Same recursion hazard `widgetRenderHarness.ts` documents: resolve `.css`
   imports through Node's own resolver rather than esbuild's `resolve()`, which
   would re-enter this same onResolve filter. */
const cssSideEffectPlugin: Plugin = {
  name: "css-side-effect",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => {
      const resolvedPath = require.resolve(args.path, {
        paths: [args.resolveDir],
      });
      return { path: resolvedPath, sideEffects: true };
    });
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      return {
        loader: "js",
        contents: `const __style = document.createElement("style");
__style.textContent = ${JSON.stringify(css)};
document.head.appendChild(__style);`,
      };
    });
  },
};

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

interface Shot {
  file: string;
  seconds: number;
}

let OUT = "";

async function clip(name: string, shots: Shot[]): Promise<void> {
  const list = join(OUT, `${name}.txt`);
  const lines = shots.flatMap((s) => [
    `file '${s.file}'`,
    `duration ${s.seconds}`,
  ]);
  lines.push(`file '${shots[shots.length - 1].file}'`);
  await writeFile(list, lines.join("\n"), "utf8");
  const out = join(OUT, `${name}.mp4`);
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      "-r",
      "30",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "ignore" },
  );
  console.log(`  ${name} → ${out}`);
}

interface Screen {
  caption: string;
  /** The scene mounts this screen itself. */
  manual?: boolean;
  spec: {
    presses: string[];
    stationPresses: string[];
    isHost: boolean;
    unfiltered: boolean;
    delaySeconds: number;
  };
}

interface Api {
  frames: Frame[];
  page: Page;
  shot(caption: string, seconds?: number): Promise<void>;
  call(frame: number, fn: string, ...args: unknown[]): Promise<unknown>;
  window(frame: number, id: string, pressId: string): Promise<unknown>;
}

async function main(): Promise<void> {
  OUT = outDir();
  await mkdir(OUT, { recursive: true });
  const bundle = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [cssSideEffectPlugin],
  });
  const escaped = bundle.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();
  const screenHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<style>${fontFace}${theme}</style>
<style>html,body{margin:0;background:var(--color-surface-app);color:var(--color-text-primary);font-family:var(--font-family-mono);}</style>
</head><body><div id="root"></div><script type="module">${escaped}</script></body></html>`;
  const srcdoc = (html: string) =>
    html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const browser = await chromium.launch();
  try {
    const run = async (
      name: string,
      screens: Screen[],
      play: (api: Api) => Promise<void>,
      extraCss = "",
    ) => {
      const width = screens.length * 540 + 16;
      const context = await browser.newContext({
        viewport: { width, height: 560 },
        deviceScaleFactor: 1.5,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.on("pageerror", (err) =>
        console.error("  [page error]", err.message),
      );
      const frames = screens
        .map(
          (screen) =>
            `<figure style="margin:0"><figcaption style="font:700 13px monospace;color:#cde;margin:0 0 4px">${screen.caption}</figcaption>` +
            `<iframe style="width:520px;height:440px;border:1px solid #333;border-radius:6px" srcdoc="${srcdoc(screenHtml)}"></iframe></figure>`,
        )
        .join("");
      const parentPath = join(
        makeTempDir("gonogo-probe-"),
        `gonogo-gw-${name}-${process.pid}.html`,
      );
      await writeFile(
        parentPath,
        `<!doctype html><html><body style="margin:0;padding:8px;background:#050505;color:#eee;font-family:monospace">
<div id="cap" style="font-size:15px;font-weight:700;margin:0 0 10px;padding:8px 10px;background:#1c2a1f;border-left:4px solid #00ff88"></div>
<div style="display:flex;gap:20px">${frames}</div></body></html>`,
        "utf8",
      );
      await page.goto(pathToFileURL(parentPath).toString());
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll("iframe")).every(
            (f) =>
              typeof (f.contentWindow as unknown as { __mount?: unknown })
                .__mount === "function",
          ),
        undefined,
        { timeout: 15_000 },
      );
      const subframes = page.frames().slice(1);
      for (const [index, screen] of screens.entries()) {
        if (screen.manual) continue;
        await subframes[index].evaluate(
          (spec) =>
            (window as never as { __mount: (s: unknown) => void }).__mount(
              spec,
            ),
          screen.spec,
        );
        if (extraCss) await subframes[index].addStyleTag({ content: extraCss });
      }
      await new Promise((r) => setTimeout(r, 500));
      const shots: Shot[] = [];
      let n = 0;
      const api: Api = {
        frames: subframes,
        page,
        async shot(caption, seconds = 3) {
          await page.evaluate((c) => {
            (document.getElementById("cap") as HTMLElement).textContent = c;
          }, caption);
          const file = join(OUT, `${name}-${String(n++).padStart(2, "0")}.png`);
          await page.screenshot({ path: file, animations: "disabled" });
          shots.push({ file, seconds });
        },
        call: (frame, fn, ...args) =>
          subframes[frame].evaluate(
            ([f, a]) =>
              (window as never as Record<string, (...x: unknown[]) => unknown>)[
                f as string
              ](...(a as unknown[])),
            [fn, args] as const,
          ),
        window: (frame, id, pressId) =>
          subframes[frame].evaluate(
            ([i, p]) =>
              (
                window as never as {
                  __windowOf: (a: string, b: string) => unknown;
                }
              ).__windowOf(i as string, p as string),
            [id, pressId] as const,
          ),
      };
      await play(api);
      await context.close();
      await clip(name, shots);
    };

    const LABEL = "Rename Vessel on Mk1 Command Pod";
    const mainScreen = (unfiltered = false): Screen => ({
      caption: "Main screen",
      spec: {
        presses: ["m1"],
        stationPresses: [],
        isHost: true,
        unfiltered,
        delaySeconds: 30,
      },
    });

    const flow = async (a: Api, railNote: string) => {
      await a.shot(
        "1  The operator presses Rename Vessel: the dialog opens and waits",
        2,
      );
      await a.call(0, "__modPending", LABEL);
      await new Promise((r) => setTimeout(r, 300));
      await a.shot(
        "2  The press is in flight: the row counts the whole wait for the form, out and back",
        3.5,
      );
      await a.call(0, "__modPendingClear", true);
      await new Promise((r) => setTimeout(r, 9000));
      await a.call(0, "__modSends", [await a.window(0, "ugui:1", "m1")]);
      await a.shot(
        "3  The game's window arrives as a form (the opening press has been answered)",
        2.5,
      );
      await a.frames[0].getByRole("button", { name: "Accept" }).click();
      await a.call(0, "__modAcceptsLastPress", "Accept");
      await new Promise((r) => setTimeout(r, 400));
      await a.shot(railNote, 2.5);
      await a.frames[0]
        .locator("[data-panel-rail-frame] button")
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      await a.shot(
        `${railNote} (the rail opened: its tile fills as the press travels)`,
        4,
      );
    };

    await run("rail-after", [mainScreen()], (a) =>
      flow(
        a,
        "4  AFTER  Accept is on the dialog's delay rail, in flight to the game",
      ),
    );
    await run(
      "rail-before",
      [mainScreen()],
      (a) =>
        flow(
          a,
          "4  BEFORE  Accept was sent, and the dialog drew no rail for it",
        ),
      "[data-panel-rail-frame]{display:none !important}",
    );

    const screens = (unfiltered: boolean): Screen[] => [
      {
        caption: "Main screen",
        spec: {
          presses: ["m1"],
          stationPresses: ["a1"],
          isHost: true,
          unfiltered,
          delaySeconds: 30,
        },
      },
      {
        caption: "Station A (pressed)",
        spec: {
          presses: ["a1"],
          stationPresses: [],
          isHost: false,
          unfiltered,
          delaySeconds: 30,
        },
      },
      {
        caption: "Station B",
        spec: {
          presses: ["b1"],
          stationPresses: [],
          isHost: false,
          unfiltered,
          delaySeconds: 30,
        },
      },
    ];
    const station = async (a: Api, caption: string) => {
      await a.shot(
        "1  All three screens have Rename Vessel open and waiting",
        2,
      );
      const own = await a.window(1, "ugui:1", "a1");
      for (const frame of [0, 1, 2]) await a.call(frame, "__modSends", [own]);
      await a.shot(caption, 4);
    };
    await run("station-after", screens(false), (a) =>
      station(
        a,
        "2  AFTER  Station A pressed: only Station A is shown the form",
      ),
    );
    await run("station-before", screens(true), (a) =>
      station(
        a,
        "2  BEFORE  The same window with no filter: every screen is shown Station A's form",
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
