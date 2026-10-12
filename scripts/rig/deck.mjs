/**
 * The Deck's two physical channels, reached over SSH: input into the game and
 * a frame out of it.
 *
 * Input goes through `~/xin.py` on the Deck, which fakes XTest events on
 * `DISPLAY=:1`, the X server KSP lives on inside gamescope. It is the only path
 * that reaches the game: uinput events never get past gamescope. The script
 * takes one string of `;`-separated steps (`click X Y`, `key NAME`, `drag`,
 * `scroll N`, `type TEXT`, `sleep S`) in the game's own 1280x800 pixels.
 *
 * A frame comes from `gamescopectl screenshot`, which is what the operator
 * would see, overlays and dialogs included.
 *
 * Input can silently stop reaching the game. `xin.py`'s X11 calls still
 * succeed (no exception, and `xdotool getmouselocation` reports the moved
 * position), but KSP never acts on them. Two causes are confirmed, and they
 * give the same symptom:
 *
 * - Another X client selects XI2 key or button events on the KSP window. The
 *   X server tries XI2 delivery before core delivery, and Unity reads core
 *   events, so the game gets nothing. Measured: with such a client 1 of 12
 *   keys toggled the game against 5 of 6 without, and 0 of 2 clicks against
 *   4 of 5. Selecting on the root window (raw events) does not block, so an
 *   observer must select on root only. The Deck has no `xinput` or `xev`;
 *   a Python XI2 listener is the way to see who holds a selection.
 * - Steam Big Picture holds `STEAM_INPUT_FOCUS=1` on its window on `:0`, so
 *   gamescope keeps keyboard and mouse focus on Steam's display instead of the
 *   game's. Reset it with
 *   `DISPLAY=:0 xprop -id <Steam Big Picture Mode window> -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0`.
 *
 * Three rules for any driver: observers select on the root window only, close
 * KSP's inventory panel (toolbar icon near 1259,252) before sending keys
 * because it swallows every key, and resend the first input after idle
 * because it is sometimes dropped.
 *
 * `verifyInputReaches` is the fails-loudly guard: run it before trusting any
 * `input()` step in a scenario. It sends a key, so it cannot tell a lost click
 * from a lost key, and it cannot read XI2 selections on the game window from
 * here.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SSH_HOST = process.env.RIG_SSH ?? "deck";
const REMOTE_FRAME = "/tmp/gonogo-rig-frame.png";

function run(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 16 << 20 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`${file} ${args.join(" ")}: ${error.message}\n${stderr}`),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Quote one argument for the Deck's POSIX shell. */
function quote(text) {
  return `'${String(text).replaceAll("'", `'\\''`)}'`;
}

/** Run a shell command on the Deck and resolve with its stdout. */
export function ssh(command, timeoutMs = 60_000) {
  return run("ssh", [SSH_HOST, command], timeoutMs);
}

/** Send input steps to the game through xin.py, in the game's 1280x800 pixels. */
export function input(steps) {
  return ssh(`python3 ~/xin.py ${quote(steps)}`, 120_000);
}

/** Save what the game is showing right now as a PNG at `dest` on this machine. */
export async function gameFrame(dest) {
  await ssh(
    [
      "export XDG_RUNTIME_DIR=/run/user/1000",
      `rm -f ${REMOTE_FRAME}`,
      `gamescopectl screenshot ${REMOTE_FRAME} >/dev/null 2>&1`,
      // The command returns before the file is written.
      `for i in $(seq 1 50); do [ -s ${REMOTE_FRAME} ] && break; sleep 0.2; done`,
      "sleep 0.3",
      `test -s ${REMOTE_FRAME}`,
    ].join("; "),
  );
  await run("scp", ["-q", `${SSH_HOST}:${REMOTE_FRAME}`, dest], 60_000);
}

/**
 * Decode an 8-bit RGBA, non-interlaced PNG (what `gamescopectl screenshot`
 * produces) into a flat pixel buffer, with no dependency beyond Node's own
 * `zlib`. Deliberately narrow: throws on any other PNG shape rather than
 * guessing.
 */
function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IEND") break;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
    }
    if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(
      `${path}: unsupported PNG (bitDepth=${bitDepth} colorType=${colorType}), expected 8-bit RGBA`,
    );
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const channels = 4;
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOffset + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[rowStart - stride + x] : 0;
      const c =
        y > 0 && x >= channels ? pixels[rowStart - stride + x - channels] : 0;
      let value;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`${path}: bad PNG filter type ${filterType}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, pixels };
}

/** Fraction of pixels whose summed RGB channel delta exceeds a small noise floor. */
function pixelDiffFraction(pathA, pathB) {
  const a = decodePng(pathA);
  const b = decodePng(pathB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `frame size mismatch: ${pathA} is ${a.width}x${a.height}, ${pathB} is ${b.width}x${b.height}`,
    );
  }
  let changed = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const delta =
      Math.abs(a.pixels[i] - b.pixels[i]) +
      Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) +
      Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
    if (delta > 24) changed++;
  }
  return changed / total;
}

/**
 * Self-check for #759: prove a keypress actually reaches the game before
 * trusting any `input()` step that follows. Sends Escape (KSP's pause/escape
 * menu opens in every scene, Space Center included, and is a large overlay)
 * twice, net no-op if it works, and diffs the frame in between against frames
 * taken before and after.
 *
 * Measured 2026-10-01 across several genuinely-unchanged frame pairs (ambient
 * animation only: ocean/cloud shaders, ticking MET clocks): 0.2%-3.5% of
 * pixels differ with ZERO input effect, scene depending. A real escape-menu
 * toggle dims the whole screen and draws a large panel, far above that noise
 * floor. `MIN_REAL_EFFECT_FRACTION` sits well above the measured noise range.
 * Measured on the rig's Deck: healthy toggles change 9.6% to 9.8% of the
 * screen and failed ones 1.35% to 1.95%, so 5% sits clearly between them.
 *
 * Throws loudly (never returns false) when the before/during diff stays in
 * the noise floor, naming the measured fraction and pointing at the known
 * cause (see the module doc comment) so a scenario run fails clearly instead
 * of silently reporting steps that never did anything.
 */
const MIN_REAL_EFFECT_FRACTION = 0.05;

export async function verifyInputReaches(frameDir) {
  const before = `${frameDir}/input-check-before.png`;
  const during = `${frameDir}/input-check-during.png`;
  const after = `${frameDir}/input-check-after.png`;
  await gameFrame(before);
  await input("key Escape");
  await new Promise((done) => setTimeout(done, 600));
  await gameFrame(during);
  /*
   * Toggle back regardless: a no-op if Escape never opened anything, a close
   * if it did, so the scenario that follows starts from the state it began in.
   */
  await input("key Escape");
  await new Promise((done) => setTimeout(done, 300));
  await gameFrame(after);

  const openedFraction = pixelDiffFraction(before, during);
  if (openedFraction < MIN_REAL_EFFECT_FRACTION) {
    throw new Error(
      describeInputFailure({
        openedFraction,
        steamFocus: await readSteamInputFocus(),
        frames: [before, during, after],
      }),
    );
  }
  return { openedFraction, before, during, after };
}

const STEAM_WINDOW_NAME = "Steam Big Picture Mode";

/*
 * `xdotool search --name` returns nothing for this window on the Deck (with
 * or without --onlyvisible, --maxdepth or --all), while `--class steam` lists
 * it and `getwindowname` names it. So candidates come from the class search,
 * filtered by exact name, with the `xwininfo -root -tree` listing as the
 * fallback when the class search finds no such window.
 */
const STEAM_FOCUS_PROBE = [
  "export DISPLAY=:0",
  "ids=''",
  `for w in $(xdotool search --class steam 2>/dev/null); do [ "$(xdotool getwindowname $w 2>/dev/null)" = '${STEAM_WINDOW_NAME}' ] && ids="$ids $w"; done`,
  `[ -z "$ids" ] && ids=$(xwininfo -root -tree 2>/dev/null | grep '"${STEAM_WINDOW_NAME}"' | awk '{print $1}')`,
  'for w in $ids; do echo "$w $(xprop -id $w STEAM_INPUT_FOCUS 2>/dev/null)"; done',
  "true",
].join("; ");

/**
 * Read `STEAM_INPUT_FOCUS` off Steam's Big Picture window on the Deck's `:0`
 * display. Resolves with one `{ window, value }` per matching window, or
 * `null` when the Deck could not be asked (no ssh, no xdotool or xprop).
 * `run` is the command runner, `ssh` by default.
 */
export async function readSteamInputFocus(run = ssh) {
  try {
    return parseSteamInputFocus(await run(STEAM_FOCUS_PROBE, 15_000));
  } catch {
    return null;
  }
}

/** Parse the probe's `<window> STEAM_INPUT_FOCUS(CARDINAL) = <n>` lines, ids decimal or 0x hex. */
export function parseSteamInputFocus(output) {
  const windows = [];
  for (const line of String(output).split("\n")) {
    const match =
      /^(0x[0-9a-fA-F]+|\d+)\s+STEAM_INPUT_FOCUS\(\w+\) = (\d+)/.exec(
        line.trim(),
      );
    if (match)
      windows.push({ window: Number(match[1]), value: Number(match[2]) });
  }
  return windows;
}

/** One line saying what the `STEAM_INPUT_FOCUS` reading means for the failure. */
function describeSteamFocus(steamFocus) {
  if (steamFocus === null) {
    return "STEAM_INPUT_FOCUS: could not be read (the Deck did not answer over ssh, or xdotool or xprop is missing).";
  }
  if (steamFocus.length === 0) {
    return (
      `STEAM_INPUT_FOCUS: no '${STEAM_WINDOW_NAME}' window found on DISPLAY=:0, so the cause is unknown (Steam may still hold focus). ` +
      "Try: for w in $(DISPLAY=:0 xdotool search --class steam); do DISPLAY=:0 xprop -id $w -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0; done"
    );
  }
  const holders = steamFocus.filter((w) => w.value === 1);
  if (holders.length === 0) {
    return "STEAM_INPUT_FOCUS: 0 on every Steam window, so Steam is not the cause.";
  }
  const ids = holders.map((w) => `0x${w.window.toString(16)}`);
  return (
    `STEAM_INPUT_FOCUS: 1 on ${ids.join(", ")}. Steam holds input focus, which keeps gamescope's keyboard and mouse focus off the game. ` +
    `Fix: DISPLAY=:0 xprop -id ${ids[0]} -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0`
  );
}

/**
 * The self-check failure message: what was measured, what could not be, and
 * the cause each observation points at. `steamFocus` is the result of
 * `readSteamInputFocus`.
 */
export function describeInputFailure({ openedFraction, steamFocus, frames }) {
  const lines = [
    `Input self-check FAILED: the key press (Escape) changed only ${(openedFraction * 100).toFixed(2)}% ` +
      `of the screen (need >=${(MIN_REAL_EFFECT_FRACTION * 100).toFixed(0)}% for a real pause-menu toggle).`,
    "Click: not tested, the check sends a key only, so a lost click is not distinguished from a lost key.",
  ];
  lines.push(describeSteamFocus(steamFocus));
  lines.push(
    "XI2 selectors on the game window: not observable from here (the Deck has no xinput or xev). " +
      "If STEAM_INPUT_FOCUS is not 1, suspect another X client selecting XI2 key or button events on the KSP window " +
      "(it pre-empts core events); find it with a Python XI2 listener on DISPLAY=:1 and have observers select on the root window only.",
    "Also check that KSP's inventory panel (toolbar icon near 1259,252) is closed, and resend once after idle.",
    `No input()-driven step in this run can be trusted. Frames: ${frames.join(", ")}`,
  );
  return lines.join("\n");
}
