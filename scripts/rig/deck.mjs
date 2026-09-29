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
 */
import { execFile } from "node:child_process";

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
