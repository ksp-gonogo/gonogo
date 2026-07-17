// Playwright driver for harness C (decoded VideoFrame pool exhaustion,
// sourced from a real WebRTC-decoded remote track rather than a raw canvas
// capture track — see harness-c.html's header comment for why that
// distinction matters). Chrome is the only engine with a main-thread
// MediaStreamTrackProcessor per the prior verification
// (video-worker-report.md); we still probe all three so the harness
// reports "not applicable" honestly instead of being silently skipped.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8935;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [join(here, "server.mjs"), String(PORT)],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    proc.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) resolve(proc);
    });
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("exit", (code) => {
      if (code !== 0) reject(new Error(`server exited ${code}`));
    });
    setTimeout(() => resolve(proc), 2000);
  });
}

const ENGINES = {
  chromium: { launcher: chromium, launchArgs: {} },
  firefox: { launcher: firefox, launchArgs: {} },
  webkit: { launcher: webkit, launchArgs: {} },
};

async function runOne(name) {
  const { launcher, launchArgs } = ENGINES[name];
  const browser = await launcher.launch(launchArgs);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleLines = [];
    page.on("console", (msg) =>
      consoleLines.push(`[${msg.type()}] ${msg.text()}`),
    );
    page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err}`));

    await page.goto(`http://localhost:${PORT}/harness-c.html`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => window.__harnessCResult?.done, {
      timeout: 60000,
    });
    const result = await page.evaluate(() => window.__harnessCResult);
    return {
      engine: name,
      ok: true,
      result,
      consoleTail: consoleLines.slice(-40),
    };
  } catch (err) {
    return { engine: name, ok: false, error: String(err) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    const only = process.argv[2] ? [process.argv[2]] : Object.keys(ENGINES);
    for (const name of only) {
      console.error(`\n=== running harness C on ${name} ===`);
      const r = await runOne(name);
      console.log(JSON.stringify(r, null, 2));
    }
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
