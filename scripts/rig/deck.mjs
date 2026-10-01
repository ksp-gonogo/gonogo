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
 * HARD, found 2026-10-01 (#759): the XTest path above can silently stop
 * reaching the game. `xin.py`'s X11 calls still succeed (no exception, and
 * `xdotool getmouselocation` even reports the moved position), but the
 * compositor never sees them. The confirmed cause on that date: Xwayland
 * forwards XTest as libei events to gamescope, and gamescope's handler logs
 * `gamescope_ei: Unhandled libei event!` / `Unhandled event EI_EVENT_SYNC
 * (91)` (`journalctl --user -u gamescope-session*`) instead of acking the
 * device-setup sync frame; once that happens, no further click or key from
 * that gamescope session visibly reaches KSP, proven by sending the same
 * input against a freshly booted, dialog-free Space Center and diffing two
 * screenshots. There is no known workaround from the Deck side (no gamescope
 * flag disables EI in favour of a legacy path); it needs a gamescope/libei
 * package fix. `verifyInputReaches` below is the fails-loudly guard for this:
 * run it before trusting any `input()` step in a scenario.
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
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
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
 *
 * Throws loudly (never returns false) when the before/during diff stays in
 * the noise floor, naming the measured fraction and pointing at the known
 * cause (see the module doc comment) so a scenario run fails clearly instead
 * of silently reporting steps that never did anything.
 */
const MIN_REAL_EFFECT_FRACTION = 0.08;

export async function verifyInputReaches(frameDir) {
  const before = `${frameDir}/input-check-before.png`;
  const during = `${frameDir}/input-check-during.png`;
  const after = `${frameDir}/input-check-after.png`;
  await gameFrame(before);
  await input("key Escape");
  await new Promise((done) => setTimeout(done, 600));
  await gameFrame(during);
  // Toggle back regardless: a no-op if Escape never opened anything, a close
  // if it did, so the scenario that follows starts from the state it began in.
  await input("key Escape");
  await new Promise((done) => setTimeout(done, 300));
  await gameFrame(after);

  const openedFraction = pixelDiffFraction(before, during);
  if (openedFraction < MIN_REAL_EFFECT_FRACTION) {
    throw new Error(
      `#759 input self-check FAILED: pressing Escape changed only ${(openedFraction * 100).toFixed(2)}% ` +
        `of the screen (need >=${(MIN_REAL_EFFECT_FRACTION * 100).toFixed(0)}% for a real pause-menu toggle). ` +
        `XTest input is not reaching the game. Check 'journalctl --user -u gamescope-session* | grep -i libei' ` +
        `on the Deck for 'Unhandled libei event' / 'EI_EVENT_SYNC' (the known cause as of 2026-10-01, see deck.mjs's ` +
        `module doc comment); no input()-driven step in this run can be trusted. Frames: ${before}, ${during}, ${after}`,
    );
  }
  return { openedFraction, before, during, after };
}
