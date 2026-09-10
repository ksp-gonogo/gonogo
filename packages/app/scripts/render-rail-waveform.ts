#!/usr/bin/env tsx
/**
 * Render the delay rail's voice ribbon through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-rail-waveform`
 * Output: local_docs/renders/rail-waveform/ (RAIL_WAVEFORM_RENDER_OUT overrides,
 * which is what a worktree wants).
 *
 * The ribbon draws only while an operator holds the Talk key in a radio session
 * with a peer, so it has never appeared in a render, a baseline or a doc. This
 * is the instrument for it. Each scene is shot collapsed (`variant="rail"`, the
 * 16 px band) and pinned open (`variant="expanded"`), because they are the same
 * geometry at two heights.
 *
 * **The scenes come in two families, and the split is the subject.** The trace
 * draws each sample at its own AGE, so how far it reaches measures how much of
 * the gap the transmitter can still account for, and that depends on two
 * things: how long the operator has been keyed, and how long a ring the
 * transmitter kept. So `01`-`09` hold the key down for 160 chunks (3.2 s) at
 * separations from a millisecond to a minute, where a short trace is simply the
 * truth; and `10`-`14` hold it down long enough to fill the gap, where a short
 * trace means audio was discarded.
 *
 * The second family is what the fix is for. The ring was a flat 128 chunks
 * (2.56 s), so a full minute of talking across a light-minute drew 4% of the
 * rail and read as barely having started; `amplitudeHistoryFor` now sizes it to
 * the separation, and the trace reaches the boundary without the drawing
 * touching where any sample sits. Stretching the kept samples across the rail
 * was proposed and rejected: it would place recent audio where older audio
 * actually is.
 *
 * Every shot prints the reading the page measured off `waveformPath` beside it.
 * A picture of a waveform is easy to misread at 380 px; the extent, the
 * turning-point count and the height of the drawn peaks are not.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import type {
  RailWaveformProbePayload,
  RailWaveformProbeReading,
} from "./probe/rail-waveform-probe-entry";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "rail-waveform-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "rail-waveform-probe.html");

/** The theme package's SOURCE tokens.css; `global.css` only `@import`s it. */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.RAIL_WAVEFORM_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/rail-waveform");

/** A panel about as wide as one sits on a real dashboard. */
const VIEWPORT_W = 380;
const VIEWPORT_H = 240;

/**
 * Long enough to fill the transmitter's 128-sample ring, i.e. the operator has
 * been talking for at least 2.56 s. Anything shorter shortens the trace for a
 * second reason and would confound the one under test.
 */
const FULL_RING_CHUNKS = 160;

/**
 * Chunks to hold the key down for so that a gap of `seconds` is full end to
 * end: one chunk per 20 ms of light-time. This is where the second family of
 * scenes gets its length, and it is the operator's own case, "I have been
 * talking across this gap for a while", which no scene could photograph
 * usefully while the ring stopped at 2.56 s.
 */
function chunksToFill(seconds: number): number {
  return Math.ceil(seconds / 0.02);
}

interface Scene {
  name: string;
  voice: RailWaveformProbePayload["voice"];
  separationSeconds: number;
  /** Chunks the key is held down for. Defaults to `FULL_RING_CHUNKS`. */
  chunkCount?: number;
  /** What the scene is for, printed with its reading. */
  note: string;
}

const SCENES: readonly Scene[] = [
  /*
   * The one separation where the ribbon can occupy the whole rail: 2.56 s is
   * exactly the ring's own length, so every sample held is still in flight.
   * The control for every other scene, and the picture of the drawing working.
   */
  {
    name: "01-2560ms-speech",
    voice: "speech",
    separationSeconds: 2.56,
    note: "separation equals the ring's length: the full-extent control",
  },
  /* The operator's stated common case, near end. */
  {
    name: "02-10s-speech",
    voice: "speech",
    separationSeconds: 10,
    note: "10 s separation, speech",
  },
  /* The operator's stated common case, far end. */
  {
    name: "03-60s-speech",
    voice: "speech",
    separationSeconds: 60,
    note: "60 s separation, speech",
  },
  /*
   * Low Kerbin orbit: a few hundred kilometres is well under a millisecond, so
   * the gap holds a fraction of one 20 ms chunk. `crossingSpanSamples` used to
   * floor that at 1 and the rail drew a confident full-width sawtooth off two
   * samples, identical for every transmission at low orbit.
   */
  {
    name: "04-lko-subsecond-speech",
    voice: "speech",
    separationSeconds: 0.0007,
    note: "sub-chunk light-time: the gap holds a fraction of one sample",
  },
  /* Silence has to be tellable from speech at every one of those extents. */
  {
    name: "05-2560ms-silence",
    voice: "silence",
    separationSeconds: 2.56,
    note: "open key, nobody talking, at the full-extent separation",
  },
  {
    name: "06-10s-silence",
    voice: "silence",
    separationSeconds: 10,
    note: "open key, nobody talking, at 10 s",
  },
  /*
   * The pair that decides the whole question, against 03: at the far end of the
   * operator's stated range, is a ribbon of speech tellable from a ribbon of
   * nothing? Both are drawn at the same extent, so only the shape separates
   * them.
   */
  {
    name: "07-60s-silence",
    voice: "silence",
    separationSeconds: 60,
    note: "open key, nobody talking, at 60 s: the shape test against 03",
  },
  {
    name: "08-lko-subsecond-silence",
    voice: "silence",
    separationSeconds: 0.0007,
    note: "open key, nobody talking, at a sub-chunk light-time",
  },
  /*
   * The library clip as `clips.ts` builds it, so the flat-ribbon hazard that
   * file warns about is a picture rather than a claim.
   */
  {
    name: "09-2560ms-stock-clip",
    voice: "stock",
    separationSeconds: 2.56,
    note: "makeClip's single raised cosine, measured: most chunks clamp at full scale",
  },
  /*
   * The second family: the operator has been keyed long enough to fill the gap,
   * which is the case they described and the case no scene above can reach. The
   * ring is sized to the separation now, so these are the pictures of a trace
   * that spans the gap at TRUE age scale, and 11 against 12 is the shape test
   * at the far end of the stated range: 3001 samples read at the drawing's
   * fixed ~49 turning points still has to look like a sentence and not a hum.
   */
  {
    name: "10-10s-speech-gap-full",
    voice: "speech",
    separationSeconds: 10,
    chunkCount: chunksToFill(10),
    note: "10 s separation, keyed for the full 10 s: the gap is full of voice",
  },
  {
    name: "11-60s-speech-gap-full",
    voice: "speech",
    separationSeconds: 60,
    chunkCount: chunksToFill(60),
    note: "60 s separation, keyed for the full minute: the ceiling of the ring, spanning the rail",
  },
  {
    name: "12-60s-silence-gap-full",
    voice: "silence",
    separationSeconds: 60,
    chunkCount: chunksToFill(60),
    note: "a full minute of open dead key: the shape test against 11",
  },
  /*
   * Part-filled, because the extent is a MEASUREMENT and not a flag: a third of
   * the way through filling a minute-wide gap is a third of the rail, and the
   * old cap could say nothing between 4.2% and 4.2%.
   */
  {
    name: "13-60s-speech-third-full",
    voice: "speech",
    separationSeconds: 60,
    chunkCount: chunksToFill(20),
    note: "60 s separation, keyed for 20 s: a third of the gap has voice, so a third of the rail",
  },
  /*
   * The second defect, with the key held long enough that only the light-time
   * limits it: a gap that holds a fraction of one 20 ms sample has a fraction
   * of one turning point's worth of evidence behind it, whatever else is true.
   */
  {
    name: "14-lko-subsecond-speech-gap-full",
    voice: "speech",
    separationSeconds: 0.0007,
    chunkCount: FULL_RING_CHUNKS,
    note: "sub-chunk light-time: full extent, and no more turning points than samples in flight",
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  console.log("Bundling rail-waveform-probe-entry with esbuild...");
  const bundleResult = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text" },
  });
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(PROBE_HTML, "utf8");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const html = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./rail-waveform-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-rail-waveform-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, html, "utf8");

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  const readings: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      deviceScaleFactor: 2,
      // The rail's grow honours prefers-reduced-motion (transition: none), so
      // the pinned shot is the settled state rather than a mid-transition frame.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error")
        console.error("  [console error]", msg.text());
    });
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => typeof window.__renderRailWaveform === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const scene of SCENES) {
      const payload: RailWaveformProbePayload = {
        voice: scene.voice,
        chunkCount: scene.chunkCount ?? FULL_RING_CHUNKS,
        separationSeconds: scene.separationSeconds,
        panelTitle: "COMMCAST",
        pxW: VIEWPORT_W,
        pxH: VIEWPORT_H,
      };
      const reading: RailWaveformProbeReading = await page.evaluate(
        (p) => window.__renderRailWaveform(p),
        payload,
      );
      // Park the cursor clear of the rail so a stationary pointer left from the
      // previous scene's click cannot hover-open the float in the COLLAPSED shot.
      await page.mouse.move(VIEWPORT_W / 2, VIEWPORT_H - 10);
      await page.waitForTimeout(80);

      await page.screenshot({
        path: join(OUT_DIR, `${scene.name}-rail.png`),
        fullPage: false,
      });

      const railBtn = await page.$("[data-panel-rail]");
      if (!railBtn) {
        throw new Error(
          `${scene.name}: no rail rendered. A crossing that registers but draws ` +
            "nothing leaves the band empty, which is exactly the failure this " +
            "harness exists to photograph rather than pass over.",
        );
      }
      await railBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: join(OUT_DIR, `${scene.name}-expanded.png`),
        fullPage: false,
      });

      readings.push(describe(scene, reading));
      console.log(`  ${scene.name}`);
    }
  } finally {
    await browser.close();
  }

  const report = [
    "# Delay-rail voice ribbon: measured readings",
    "",
    `Panel width ${VIEWPORT_W}px, ${SCENES.length} scenes, each shot collapsed`,
    "(`-rail.png`, the 16px band) and pinned open (`-expanded.png`).",
    "",
    "`extent` is the fraction of the rail's journey the drawn trace covers,",
    "read off `waveformPath` in the page: how much of the gap this",
    "transmission occupies. `turning points` is how many up/down peaks the",
    "reader has to see a wave in, and `drawn peaks` is how high they reached,",
    "which is what separates a sentence from an open dead key after the stretch",
    "has decimated the ring. A dead key draws every peak at 0%.",
    "",
    ...readings,
    "",
  ].join("\n");
  await writeFile(join(OUT_DIR, "readings.md"), report, "utf8");
  console.log(`\nRendered ${SCENES.length * 2} shots -> ${OUT_DIR}`);
  console.log(`\n${report}`);
}

function describe(scene: Scene, r: RailWaveformProbeReading): string {
  const px = (r.extentFraction * VIEWPORT_W).toFixed(0);
  return [
    `## ${scene.name}`,
    `- ${scene.note}`,
    `- separation ${scene.separationSeconds}s -> spanSamples ${r.spanSamples.toFixed(3)}, keyed ${r.emittedSamples} chunks, ring held ${r.sampleCount}`,
    `- extent ${(r.extentFraction * 100).toFixed(1)}% of the rail (~${px}px at ${VIEWPORT_W}px wide), ${r.turningPoints} turning points`,
    `- drawn peaks reach ${(r.drawnPeakMin * 100).toFixed(1)}%..${(r.drawnPeakMax * 100).toFixed(1)}% of full scale, ${r.drawnDistinctHeights} distinct heights`,
    `- fixture amplitudes ${r.minAmplitude.toFixed(3)}..${r.maxAmplitude.toFixed(3)}, ${r.distinctAmplitudes} distinct values`,
  ].join("\n");
}

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function cleanArtifacts(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile() || !/\.(png|md)$/.test(e.name)) continue;
    await rm(join(dir, e.name));
    removed++;
  }
  if (removed > 0)
    console.log(`Cleaned ${removed} stale artifact(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
