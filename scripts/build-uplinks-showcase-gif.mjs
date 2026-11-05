#!/usr/bin/env node
/**
 * Rebuilds docs/assets/uplinks-showcase.gif: two 600x338 columns that crossfade
 * through four clips each, the right column running half a slot behind the left.
 *
 * Usage:
 *   node scripts/build-uplinks-showcase-gif.mjs --base <3+3 gif> --docking <mp4> \
 *     --principia <gif> --out <gif> [--docking-start 47] [--principia-crop-y 890]
 *
 * --base is the previous showcase gif (three clips per column, 80 frame slots, a
 * five frame crossfade). Its steady frames are reused as the first three clips of
 * each column, held at their edges while the new crossfades run. Needs ffmpeg.
 */
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    base: { type: "string" },
    docking: { type: "string" },
    principia: { type: "string" },
    out: { type: "string" },
    "docking-start": { type: "string", default: "47" },
    "principia-crop-y": { type: "string", default: "890" },
    "static-until": { type: "string", default: "40" },
    "static-hold": { type: "string", default: "4" },
    colors: { type: "string", default: "256" },
    dither: { type: "string", default: "none" },
  },
});
for (const k of ["base", "docking", "principia", "out"]) {
  if (!a[k]) throw new Error(`missing --${k}`);
}

const COL_W = 600;
const H = 338;
const W = COL_W * 2;
const SLOT = 80;
const FADE = 5;
const BASE_FRAMES = 240;
const PURE = [FADE - 2, SLOT - FADE + 2];
const FRAME_BYTES = (w, h) => w * h * 3;

function decode(input, vf, pre = []) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      ...pre,
      "-i",
      input,
      "-vf",
      vf,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 2 ** 31 },
  );
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
}

const base = decode(a.base, "format=rgb24");
const crop = (buf, n, x0) => {
  const out = Buffer.alloc(FRAME_BYTES(COL_W, H));
  const f = n * FRAME_BYTES(W, H);
  for (let r = 0; r < H; r++) {
    buf.copy(
      out,
      r * COL_W * 3,
      f + (r * W + x0) * 3,
      f + (r * W + x0 + COL_W) * 3,
    );
  }
  return out;
};
/** Steady frames of the base clip whose slot starts at `start` (mod 240), in the column at `x0`. */
const baseClip = (start, x0) => {
  const frames = [];
  for (let u = PURE[0]; u <= PURE[1]; u++) {
    frames.push(crop(base, (start + u) % BASE_FRAMES, x0));
  }
  return (u) => frames[Math.min(Math.max(u, PURE[0]), PURE[1]) - PURE[0]];
};

const fromFrames = (buf) => {
  return (i) =>
    buf.subarray(i * FRAME_BYTES(COL_W, H), (i + 1) * FRAME_BYTES(COL_W, H));
};

/** The docking camera at half speed, cropped to 16:9 around the target port. */
const dockingFrames = fromFrames(
  decode(
    a.docking,
    `fps=20,crop=1030:579:0:180,scale=${COL_W}:${H}:flags=lanczos`,
    ["-ss", a["docking-start"], "-t", "4"],
  ),
);
/* One frame per gif frame at half speed. The static before the lock is held for a few frames at a time, since it costs the most and has the least to show. */
const staticUntil = Number(a["static-until"]);
const staticHold = Number(a["static-hold"]);
const docking = (u) =>
  dockingFrames(u < staticUntil ? Math.floor(u / staticHold) * staticHold : u);

/** The burn editor's ignition jog wheel at half speed, held on its last frame. */
const principiaFrames = (() => {
  const buf = decode(
    a.principia,
    `crop=944:531:0:${a["principia-crop-y"]},scale=${COL_W}:${H}:flags=lanczos`,
  );
  return fromFrames(buf);
})();
const principiaCount =
  decode(a.principia, "scale=16:16").length / (16 * 16 * 3);
const principia = (u) =>
  principiaFrames(Math.min(principiaCount - 1, Math.floor(u / 2)));

// Slots by column. The base gif's left slots start at 0, 80, 160 and its right
// slots at 200, 40, 120 (kerbalism weather, camera feed, site construction).
const left = [
  baseClip(0, 0),
  baseClip(80, 0),
  baseClip(160, 0),
  (u) => docking(Math.min(u, 79)),
];
const right = [
  baseClip(200, COL_W),
  baseClip(40, COL_W),
  baseClip(120, COL_W),
  principia,
];

const SLOTS = left.length;
const TOTAL = SLOTS * SLOT;

function column(clips, offset, f) {
  const t = (((f - offset) % TOTAL) + TOTAL) % TOTAL;
  const slot = Math.floor(t / SLOT);
  const u = t % SLOT;
  const half = (FADE - 1) / 2;
  const clip = (s, uu) =>
    clips[(s + SLOTS) % SLOTS](Math.min(Math.max(uu, 0), SLOT - 1));
  if (u > half && u < SLOT - half) return clip(slot, u);
  const d = u <= half ? u : u - SLOT;
  const from = u <= half ? slot - 1 : slot;
  const pf = clip(from, SLOT + d);
  const nf = clip(from + 1, d);
  const mix = (d + half + 1) / (FADE + 1);
  const out = Buffer.alloc(pf.length);
  for (let i = 0; i < out.length; i++)
    out[i] = pf[i] * (1 - mix) + nf[i] * mix + 0.5;
  return out;
}

const enc = spawn(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${W}x${H}`,
    "-r",
    "10",
    "-i",
    "-",
    "-vf",
    `split[a][b];[a]palettegen=stats_mode=diff:max_colors=${a.colors}[p];[b][p]paletteuse=dither=${a.dither}:diff_mode=rectangle`,
    "-loop",
    "0",
    a.out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
for (let f = 0; f < TOTAL; f++) {
  const l = column(left, 0, f);
  const r = column(right, SLOT / 2, f);
  const row = Buffer.alloc(FRAME_BYTES(W, H));
  for (let y = 0; y < H; y++) {
    l.copy(row, y * W * 3, y * COL_W * 3, (y + 1) * COL_W * 3);
    r.copy(row, (y * W + COL_W) * 3, y * COL_W * 3, (y + 1) * COL_W * 3);
  }
  enc.stdin.write(row);
}
enc.stdin.end();
