#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
/**
 * Does the ribbon follow the audio? Plays two known clips through a real
 * Chromium's fake microphone, runs the app's own capture and decode code over
 * them, and plots, on one time axis: the clip's own loudness envelope (computed
 * offline from the wav), what the capture reported (outgoing), what the decode
 * reported (incoming), and the turning points the rail draws from the
 * outgoing readings.
 *
 * Run: pnpm --filter @ksp-gonogo/app exec tsx scripts/radio-loudness-check.ts <outDir>
 */
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WAVE_HALF_H, WAVE_MID_Y, waveformPath } from "@ksp-gonogo/ui-kit";
import { build } from "esbuild";
import { chromium } from "playwright";
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? ".renders/loudness");
const RATE = 48_000;
const CHUNK = 960;
const SECONDS = 5;
const FULL_SCALE_RMS = 0.25;

let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Speech-like: syllable bursts of voiced harmonics, uneven loudness, pauses. */
function speech(): Float32Array {
  const out = new Float32Array(RATE * SECONDS);
  let pos = Math.round(0.3 * RATE);
  while (pos < out.length - RATE * 0.3) {
    const syl = Math.round(RATE * (0.1 + rand() * 0.14));
    const f0 = 110 + rand() * 90;
    const peak = 0.25 + rand() * 0.6;
    for (let i = 0; i < syl; i++) {
      const env = Math.sin((Math.PI * i) / syl) ** 1.5;
      let x = 0;
      for (let h = 1; h <= 10; h++)
        x += Math.sin((2 * Math.PI * f0 * h * (pos + i)) / RATE) / h;
      if (pos + i < out.length) out[pos + i] = env * x * peak * 0.5;
    }
    pos += syl + Math.round(RATE * (0.02 + rand() * 0.05));
    if (rand() < 0.35) pos += Math.round(RATE * (0.2 + rand() * 0.35));
  }
  return out;
}

/** A 300 Hz tone: loud, quiet, silent, loud, silent, a second each. */
function steps(): Float32Array {
  const level = [0.45, 0.1, 0, 0.45, 0];
  const out = new Float32Array(RATE * SECONDS);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      level[Math.floor(i / RATE)] * Math.sin((2 * Math.PI * 300 * i) / RATE);
  }
  return out;
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries()) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The clip's own loudness per 20 ms, by the app's own formula (RMS over 0.25, clamped). */
function envelope(samples: Float32Array): number[] {
  const out: number[] = [];
  for (let c = 0; c + CHUNK <= samples.length; c += CHUNK) {
    let sum = 0;
    for (let i = 0; i < CHUNK; i++) sum += samples[c + i] ** 2;
    out.push(Math.min(1, Math.sqrt(sum / CHUNK) / FULL_SCALE_RMS));
  }
  return out;
}

/** The lag, in chunks, at which `b` best lines up with `a`, and the correlation there. */
function align(a: number[], b: number[]): { lag: number; corr: number } {
  let best = { lag: 0, corr: -2 };
  for (let lag = -5; lag <= 60; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < b.length) {
        xs.push(a[i]);
        ys.push(b[j]);
      }
    }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [i, x] of xs.entries()) {
      sxy += (x - mx) * (ys[i] - my);
      sxx += (x - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    if (corr > best.corr) best = { lag, corr };
  }
  return best;
}

/** The clip's own lowest and highest sample in each 20 ms, scaled as the capture scales them. */
function truthWave(samples: Float32Array): { lo: number; hi: number }[] {
  const out: { lo: number; hi: number }[] = [];
  for (let c = 0; c + CHUNK <= samples.length; c += CHUNK) {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < CHUNK; i++) {
      lo = Math.min(lo, samples[c + i]);
      hi = Math.max(hi, samples[c + i]);
    }
    out.push({
      lo: Math.max(-1, lo / 0.5),
      hi: Math.min(1, hi / 0.5),
    });
  }
  return out;
}

/** The clip's samples as a filled band on the rail zone's own axis: age 0 at the left, a third of the width for five seconds. */
function clipPlot(truth: { lo: number; hi: number }[]): string {
  const W = 1000;
  const zone = W / 3;
  const H = 120;
  const mid = H / 2;
  const half = 50;
  const x = (age: number) => (age / SECONDS) * zone;
  const top: string[] = [];
  const bottom: string[] = [];
  truth.forEach((b, i) => {
    const age = SECONDS - (i + 1) * 0.02;
    const x0 = x(age);
    const x1 = x(age + 0.02);
    top.push(
      `${x0.toFixed(2)},${(mid - b.hi * half).toFixed(2)}`,
      `${x1.toFixed(2)},${(mid - b.hi * half).toFixed(2)}`,
    );
    bottom.unshift(
      `${x0.toFixed(2)},${(mid - b.lo * half).toFixed(2)}`,
      `${x1.toFixed(2)},${(mid - b.lo * half).toFixed(2)}`,
    );
  });
  const ticks = [0, 1, 2, 3, 4, 5]
    .map(
      (s) =>
        `<line x1="${x(s)}" x2="${x(s)}" y1="0" y2="${H}" stroke="#333"/><text x="${x(s) + 3}" y="${H - 4}" fill="#888" font-size="11">${s} s ago</text>`,
    )
    .join("");
  return `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#111"/>${ticks}<line x1="0" x2="${zone}" y1="${mid}" y2="${mid}" stroke="#777"/><polygon points="${top.join(" ")} ${bottom.join(" ")}" fill="#ffffff"/></svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const bundle = await build({
    entryPoints: [join(HERE, "probe/radio-loudness-entry.tsx")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  });
  const theme = await readFile(
    resolve(HERE, "../../theme/src/tokens.css"),
    "utf8",
  );
  const shell = `<div style="width:1000px;padding:8px;font:12px monospace;color:#bbb"><div id="mode" style="color:#e8b84a;margin-bottom:6px"></div><div>before: the loudness zig-zag the rail drew until now</div><div id="rail-before" style="--panel-rail-band:64px"></div><div style="margin-top:8px">after: the wave</div><div id="rail-after" style="--panel-rail-band:64px"></div><div style="margin-top:8px">the clip's own samples, lowest to highest in each 20 ms, on the same axis (left is now; the zone is the first third)</div><div id="plot"></div></div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>${theme}</style><body style="margin:0;background:#0d0d0d">${shell}<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`;
  makeTempDir("gonogo-loudness-");
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;

  const report: Record<string, unknown> = {};
  for (const [name, samples, raw] of [
    ["speech", speech(), false],
    ["steps", steps(), true],
  ] as const) {
    const file = join(OUT, `${name}.wav`);
    await writeFile(file, wav(samples));
    const browser = await chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${file}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1016, height: 440 },
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("[page error]", e.message));
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.waitForFunction(
      () =>
        typeof (window as unknown as { __run?: unknown }).__run === "function",
    );
    const got = (await p.evaluate(
      ([s, raw]) =>
        (
          window as unknown as {
            __run: (s: number, raw: boolean) => Promise<unknown>;
          }
        ).__run(s, raw),
      [SECONDS + 1, raw] as [number, boolean],
    )) as {
      outgoing: number[];
      incoming: number[];
      outgoingWave: { lo: number; hi: number }[];
      incomingWave: { lo: number; hi: number }[];
    };

    const truth = envelope(samples);
    const truthW = truthWave(samples);
    const outA = align(truth, got.outgoing);
    const inA = align(truth, got.incoming);
    const take = <T>(series: T[], lag: number) =>
      truth.map((_, i) => series[i + lag] as T);
    const outAmp = take(got.outgoing, outA.lag);
    const outWave = take(got.outgoingWave, outA.lag).map(
      (b) => b ?? { lo: 0, hi: 0 },
    );
    const inWave = take(got.incomingWave, inA.lag).map(
      (b) => b ?? { lo: 0, hi: 0 },
    );
    const rmsOf = (a: number[], b: number[]) =>
      Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0) / a.length);
    const perSecond = (b: { hi: number }[]) =>
      [0, 1, 2, 3, 4].map((sec) =>
        Number(
          (
            b.slice(sec * 50, sec * 50 + 50).reduce((a, v) => a + v.hi, 0) / 50
          ).toFixed(3),
        ),
      );
    const hiCorr = align(
      truthW.map((b) => b.hi),
      outWave.map((b) => b.hi),
    );
    report[name] = {
      chunks: {
        clip: truth.length,
        captured: got.outgoing.length,
        decoded: got.incoming.length,
      },
      loudness: {
        outgoing: {
          lagChunks: outA.lag,
          correlation: Number(outA.corr.toFixed(3)),
        },
        incoming: {
          lagChunks: inA.lag,
          correlation: Number(inA.corr.toFixed(3)),
        },
      },
      meanHighestPerSecondOfTheClip: {
        clip: perSecond(truthW),
        captured: perSecond(outWave),
        decoded: perSecond(inWave),
      },
      wave: {
        outgoingHighest: {
          correlationWithClip: Number(hiCorr.corr.toFixed(3)),
          rmsError: Number(
            rmsOf(
              truthW.map((b) => b.hi),
              outWave.map((b) => b.hi),
            ).toFixed(3),
          ),
        },
        incomingHighest: {
          rmsErrorAgainstOutgoing: Number(
            rmsOf(
              outWave.map((b) => b.hi),
              inWave.map((b) => b.hi),
            ).toFixed(3),
          ),
        },
      },
    };
    {
      const drawnBand = (await p.evaluate(
        (blocks) =>
          (
            window as unknown as {
              __ribbon: (
                b: unknown[],
                s: number,
                x: number,
              ) => { d: string; half: number; mid: number };
            }
          ).__ribbon(blocks, 250, 100 / 3),
        outWave,
      )) as { d: string; half: number; mid: number };
      const pts = [...drawnBand.d.matchAll(/(-?\d+\.\d\d),(-?\d+\.\d\d)/g)].map(
        (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
      );
      const perAge = [0, 1, 2, 3, 4].map((sec) => {
        const inside = pts.filter(
          (q) =>
            q.x >= (sec / SECONDS) * (100 / 3) &&
            q.x < ((sec + 1) / SECONDS) * (100 / 3) &&
            q.y <= drawnBand.mid,
        );
        return Number(
          Math.max(
            0,
            ...inside.map((q) => (drawnBand.mid - q.y) / drawnBand.half),
          ).toFixed(3),
        );
      });
      (report[name] as Record<string, unknown>).drawnBandHighestPerSecondAgo =
        perAge;
      (report[name] as Record<string, unknown>).capturedHighestPerSecondAgo = [
        4, 3, 2, 1, 0,
      ].map((sec) =>
        Number(
          Math.max(
            ...outWave.slice(sec * 50, sec * 50 + 50).map((b) => b.hi),
          ).toFixed(3),
        ),
      );
    }
    (report[name] as Record<string, unknown>).capturedHighestEvery100ms =
      Array.from({ length: 50 }, (_, i) =>
        Number(
          Math.max(...outWave.slice(i * 5, i * 5 + 5).map((b) => b.hi)).toFixed(
            2,
          ),
        ),
      );
    (report[name] as Record<string, unknown>).clipHighestEvery100ms =
      Array.from({ length: 50 }, (_, i) =>
        Number(
          Math.max(...truthW.slice(i * 5, i * 5 + 5).map((b) => b.hi)).toFixed(
            2,
          ),
        ),
      );
    for (const [label, seconds] of [
      ["pad", 1.5e-8],
      ["mun", 1.3],
      ["far", 30],
    ] as const) {
      await p.evaluate(
        ({ amplitudes, waves, oneWaySeconds, plotSvg, modeText }) => {
          (document.getElementById("plot") as HTMLElement).innerHTML = plotSvg;
          (document.getElementById("mode") as HTMLElement).textContent =
            modeText;
          (
            window as unknown as {
              __drawRails: (s: {
                amplitudes: number[];
                waves: unknown[];
                oneWaySeconds: number;
              }) => void;
            }
          ).__drawRails({ amplitudes, waves, oneWaySeconds });
        },
        {
          amplitudes: outAmp,
          waves: outWave,
          oneWaySeconds: seconds,
          plotSvg: clipPlot(truthW),
          modeText: raw
            ? `${name} clip. FOR THIS PROOF ONLY: the browser's automatic gain control, noise suppression and echo cancellation are switched off, so the tone's steps are not reshaped. The app switches them on.`
            : `${name} clip, captured as the app captures it (automatic gain control, noise suppression and echo cancellation on).`,
        },
      );
      await p.waitForTimeout(300);
      await p.screenshot({ path: join(OUT, `${name}-${label}.png`) });
    }
    await browser.close();
  }
  server.close();
  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
