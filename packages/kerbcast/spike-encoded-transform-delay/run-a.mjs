// Playwright driver for harness A (encoded-transform delay) across all
// three engines. Prints a JSON result per engine and a combined summary.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8934;

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
  chromium: {
    launcher: chromium,
    launchArgs: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
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

    await page.goto(`http://localhost:${PORT}/harness-a.html`, {
      waitUntil: "load",
    });

    await page.waitForFunction(() => window.__harnessAResult?.done, {
      timeout: 30000,
    });

    const result = await page.evaluate(() => window.__harnessAResult);
    return {
      engine: name,
      ok: true,
      result,
      consoleTail: consoleLines.slice(-40),
    };
  } catch (err) {
    let consoleTail = [];
    try {
      consoleTail =
        (await browser
          .contexts()[0]
          ?.pages()[0]
          ?.evaluate(() => window.__harnessAResult)) ?? [];
    } catch {}
    return {
      engine: name,
      ok: false,
      error: String(err),
      partial: consoleTail,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    const only = process.argv[2] ? [process.argv[2]] : Object.keys(ENGINES);
    const results = [];
    for (const name of only) {
      console.error(`\n=== running harness A on ${name} ===`);
      const r = await runOne(name);
      results.push(r);
      console.log(JSON.stringify(r, null, 2));
    }
    console.error("\n=== SUMMARY ===");
    for (const r of results) {
      console.error(
        r.engine,
        r.ok ? "OK" : "FAILED",
        r.ok
          ? JSON.stringify({
              capabilityUsed: r.result.capabilityUsed,
              meanDelayMs: r.result.meanDelayMs,
              stdDevDelayMs: r.result.stdDevDelayMs,
              error: r.result.error,
              timedOut: r.result.timedOut,
            })
          : r.error,
      );
    }
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
