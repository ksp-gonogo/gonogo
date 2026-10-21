#!/usr/bin/env node
/**
 * Reads and trims a wire recording: JSON Lines, one `{ t, f }` per line, where
 * `t` is the epoch millisecond the frame reached the recorder and `f` is the
 * frame exactly as the mod sent it (an object, or the raw JSON text of one).
 * Every frame type is kept, `hello` and `game-state` included, since a screen's
 * scene and its run identity come from those.
 *
 * Trimming a recording for a fixture (both commands also dedupe and scrub):
 *
 *   node tests/playwright/wire-fixture.mjs trim <in.jsonl> <out.jsonl> --from <s> --to <s>
 *   node tests/playwright/wire-fixture.mjs dedupe <in.jsonl> <out.jsonl>
 *
 * `--from` and `--to` are seconds from the recording's first frame. The
 * excerpt opens with the latest `hello`, `game-state` and `subscribed` ack seen
 * before `--from`, and the latest frame of every topic, so a topic that
 * changes rarely (vessel identity, propulsion) is still known at the start of
 * the cut. Those frames are placed at the cut and delivered at it: their
 * `meta.deliveredAt` becomes the latest of theirs, as the mod stamps a frame it
 * sends on subscribe, and `validAt` is left alone. A screen's clock follows
 * `deliveredAt`, so a cut that kept the originals would run it backwards.
 *
 * A fixture is also deduplicated and scrubbed of the recording machine's home
 * folder on its way out; see `dedupeWireFixture` and `scrubWireFixture`.
 * `writeWireFixture` refuses a path that still names a home folder.
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
      frame:
        slot.startsWith("data:") || slot.startsWith("subscribed:")
          ? deliveredAt(frame, cutAt)
          : frame,
    }));
  return [...head, ...body];
}

/**
 * How long, in seconds of game time, a topic may go without a frame before an
 * unchanged payload is kept anyway. A reading is as fresh as the last frame
 * that confirmed it, so a quiet topic dropped for good would go stale on a
 * screen that is still being sent it.
 */
const KEEPALIVE_SECONDS = 10;

/**
 * Drops every `stream-data` frame whose payload equals the previous frame of
 * the same topic, so a topic the mod repeats each second while nothing changes
 * costs one frame. The first frame of each topic is kept, and so is an
 * unchanged one that comes `keepaliveSeconds` after the last frame kept for its
 * topic. Every other frame type (`hello`, `game-state`, `event`, `error`)
 * passes through untouched.
 */
export function dedupeWireFixture(
  rows,
  { keepaliveSeconds = KEEPALIVE_SECONDS } = {},
) {
  const previous = new Map();
  return rows.filter(({ frame }) => {
    if (frame.type !== "stream-data") return true;
    const payload = JSON.stringify(frame.payload ?? null);
    const validAt = frame.meta?.validAt ?? 0;
    const last = previous.get(frame.topic);
    if (
      last &&
      last.payload === payload &&
      validAt - last.validAt < keepaliveSeconds
    ) {
      return false;
    }
    previous.set(frame.topic, { payload, validAt });
    return true;
  });
}

/** A path into the game folder under someone's home folder: `/home/<user>/` or `/Users/<user>/` up to `Kerbal Space Program`. */
const GAME_FOLDER_IN_HOME =
  /(?:\/home|\/Users)\/[^/"\\]+\/(?:[^"\\]*?\/)?(?=Kerbal Space Program\/)/g;

/** Any home folder of a person, which a committed recording must not carry. */
const HOME_FOLDER = /(?:\/home|\/Users)\/[^/"\\\s]+\//;

/** Rewrites the game's install path in every frame to the neutral `/games/ksp/` root. */
export function scrubWireFixture(rows) {
  return rows.map((row) => {
    const text = JSON.stringify(row.frame);
    const scrubbed = text.replace(GAME_FOLDER_IN_HOME, "/games/ksp/");
    return scrubbed === text ? row : { ...row, frame: JSON.parse(scrubbed) };
  });
}

/** Throws when a frame still names a person's home folder. */
export function assertNoHomePaths(rows) {
  for (const [index, { frame }] of rows.entries()) {
    const found = HOME_FOLDER.exec(JSON.stringify(frame));
    if (found) {
      throw new Error(
        `frame ${index + 1} (${frame.type}${frame.topic ? ` ${frame.topic}` : ""}) carries a home folder path (${found[0]}...)`,
      );
    }
  }
}

/** Writes rows in the recording's own format. */
export function writeWireFixture(path, rows) {
  assertNoHomePaths(rows);
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
  const usage =
    "usage: wire-fixture.mjs trim <in.jsonl> <out.jsonl> --from <s> --to <s>\n" +
    "       wire-fixture.mjs dedupe <in.jsonl> <out.jsonl>\n";
  if ((command !== "trim" && command !== "dedupe") || !input || !output) {
    process.stderr.write(usage);
    process.exit(2);
  }
  const read = readWireFixture(input);
  const cut =
    command === "trim"
      ? trimWireFixture(read, {
          fromMs: flag(rest, "--from") * 1000,
          toMs: flag(rest, "--to") * 1000,
        })
      : read;
  const rows = dedupeWireFixture(scrubWireFixture(cut));
  writeWireFixture(output, rows);
  process.stdout.write(`${rows.length} frames written to ${output}\n`);
}
