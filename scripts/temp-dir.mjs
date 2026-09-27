/**
 * A scratch directory under the OS temp root that is gone once its process is.
 *
 * Removal happens on the process's `exit` event, which covers a normal finish,
 * every `process.exit` (including one inside a `try`, which skips `finally`)
 * and an uncaught throw. A signal is covered by a detached watcher instead: a
 * JavaScript signal handler cannot run while the script is blocked in
 * `spawnSync`, and nothing at all runs in-process after a SIGKILL. The watcher
 * sits in its own process group, so the Ctrl-C that stops the script leaves it
 * standing, and it removes the directory once its parent has gone.
 *
 * `GONOGO_KEEP_TMP=1` keeps every directory for debugging and prints each path
 * on exit.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const keep = process.env.GONOGO_KEEP_TMP === "1";
const owned = new Set();

/**
 * Runs in the watcher. Its parent pid changes to the reaper's once the script
 * has exited, however it exited, which a pid probe could mistake for a reused
 * pid.
 */
const WATCHER = `
const { rmSync } = require("node:fs");
const [parent, ...dirs] = process.argv.slice(1);
const timer = setInterval(() => {
  if (String(process.ppid) === parent) return;
  clearInterval(timer);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 250);
`;

function removeOwned() {
  for (const dir of owned) {
    if (keep) {
      console.error(`kept temp dir: ${dir}`);
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Creates `<tmpdir>/<prefix>XXXXXX` and returns its path. */
export function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (owned.size === 0) process.on("exit", removeOwned);
  owned.add(dir);
  if (!keep) {
    spawn(process.execPath, ["-e", WATCHER, String(process.pid), dir], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  return dir;
}
