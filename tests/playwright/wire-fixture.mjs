#!/usr/bin/env node
/**
 * Reads and trims a wire recording: JSON Lines, one `{ t, f }` per line, where
 * `t` is the epoch millisecond the frame reached the recorder and `f` is the
 * frame exactly as the mod sent it (an object, or the raw JSON text of one).
 * Every frame type is kept, `hello` and `game-state` included, since a screen's
 * scene and its run identity come from those.
 *
 * Trimming a recording for a fixture:
 *
 *   node tests/playwright/wire-fixture.mjs trim <in.jsonl> <out.jsonl> --from <s> --to <s>
 *
 * `--from` and `--to` are seconds from the recording's first frame. The
 * excerpt opens with the latest `hello`, `game-state` and `subscribed` ack seen
 * before `--from`, and the latest frame of every topic, so a topic that
 * changes rarely (vessel identity, propulsion) is still known at the start of
 * the cut. Those frames are placed at the cut and delivered at it: their
 * `meta.deliveredAt` becomes the latest of theirs, as the mod stamps a frame it
 * sends on subscribe, and `validAt` is left alone. A screen's clock follows
 * `deliveredAt`, so a cut that kept the originals would run it backwards.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Parses a wire recording. Blank lines are skipped; a line that is not
 * `{ t: number, f: frame }` throws with its line number.
 */
export function readWireFixture(path) {
  const rows = [];
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: not JSON (${error.message})`);
    }
    const frame = typeof row?.f === "string" ? JSON.parse(row.f) : row?.f;
    if (typeof row?.t !== "number" || typeof frame?.type !== "string") {
      throw new Error(`${path}:${index + 1}: expected { t: number, f: frame }`);
    }
    rows.push({ t: row.t, frame });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

/** Identifies the frames that only matter as the latest of their kind, for the opening of an excerpt. */
function keyframeSlot(frame) {
  if (frame.type === "hello" || frame.type === "game-state") return frame.type;
  if (frame.type === "event" && frame.name === "subscribed") {
    return `subscribed:${frame.topic}`;
  }
  if (frame.type === "stream-data") return `data:${frame.topic}`;
  return null;
}

/** `frame` as delivered at UT `at`. */
export function deliveredAt(frame, at) {
  return { ...frame, meta: { ...frame.meta, deliveredAt: at } };
}

/**
 * Cuts `rows` to `[fromMs, toMs]` (milliseconds from the first row), opening
 * with what a screen would already know at `fromMs`: see the module comment.
 */
export function trimWireFixture(rows, { fromMs, toMs }) {
  if (rows.length === 0) return [];
  const t0 = rows[0].t;
  const start = t0 + fromMs;
  const end = t0 + toMs;
  const opening = new Map();
  const body = [];
  for (const row of rows) {
    if (row.t >= start) {
      if (row.t <= end) body.push(row);
      continue;
    }
    const slot = keyframeSlot(row.frame);
    if (slot) opening.set(slot, row.frame);
    // A timeline reset forgets every reading before it, so they cannot open the cut.
    if (row.frame.type === "event" && row.frame.name === "timeline-reset") {
      for (const key of [...opening.keys()]) {
        if (key.startsWith("data:")) opening.delete(key);
      }
    }
  }
  const order = (slot) =>
    slot === "hello" ? 0 : slot === "game-state" ? 1 : 2;
  const cutAt = Math.max(
    ...[...opening.values()].map((frame) => frame.meta?.deliveredAt ?? 0),
  );
  const head = [...opening.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([slot, frame]) => ({
      t: start,
      frame: slot.startsWith("data:") ? deliveredAt(frame, cutAt) : frame,
    }));
  return [...head, ...body];
}

/** Writes rows in the recording's own format. */
export function writeWireFixture(path, rows) {
  const text = rows
    .map((row) => JSON.stringify({ t: row.t, f: row.frame }))
    .join("\n");
  writeFileSync(path, `${text}\n`);
}

function flag(args, name) {
  const at = args.indexOf(name);
  const value = at >= 0 ? Number(args[at + 1]) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`missing ${name} <seconds>`);
  return value;
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [command, input, output, ...rest] = process.argv.slice(2);
  if (command !== "trim" || !input || !output) {
    process.stderr.write(
      "usage: wire-fixture.mjs trim <in.jsonl> <out.jsonl> --from <s> --to <s>\n",
    );
    process.exit(2);
  }
  const rows = trimWireFixture(readWireFixture(input), {
    fromMs: flag(rest, "--from") * 1000,
    toMs: flag(rest, "--to") * 1000,
  });
  writeWireFixture(output, rows);
  process.stdout.write(`${rows.length} frames written to ${output}\n`);
}
