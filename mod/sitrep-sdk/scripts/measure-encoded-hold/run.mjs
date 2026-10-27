/**
 * Holds a loopback WebRTC video feed in the production encoded-frame delay
 * (the built `dist/media` worker, driven through `attachEncodedWorkerFrameDelay`)
 * for minutes on one or more engines, and records the browser's memory over the
 * hold and how closely each frame is released to its due time.
 *
 *   node scripts/measure-encoded-hold/run.mjs [engine ...] [--delay 180] [--window 30]
 *       [--cap <bytes>] [--bitrate 2000000] [--dispose 1]
 *
 * `--dispose 1` also disposes the delay 3 s after the first measurement is
 * done and reports whether the page survived it (`crashed`).
 *
 * Needs `pnpm --filter @ksp-gonogo/sitrep-sdk build` first. Memory is the
 * resident size of the engine's own process tree, sampled with `ps` every 5 s,
 * so it reads the same on every engine.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = join(here, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript" };
const ENGINES = { chromium, firefox, webkit };

function flag(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

function serve() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const file =
      path === "/harness.html"
        ? join(here, "harness.html")
        : join(sdkRoot, normalize(path));
    if (!file.startsWith(sdkRoot) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "text/plain",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

function processTable() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], rssKb: +m[3], command: m[4] }));
}

/**
 * The server's descendants, plus on WebKit every Playwright WebContent process
 * that appeared after launch, because macOS starts those through launchd rather
 * than as children.
 */
function engineRssBytes(rootPid, engine, preexisting) {
  const table = processTable();
  const family = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of table) {
      if (family.has(p.ppid) && !family.has(p.pid)) {
        family.add(p.pid);
        grew = true;
      }
    }
  }
  if (engine === "webkit") {
    for (const p of table) {
      if (
        !preexisting.has(p.pid) &&
        /ms-playwright\/webkit|com\.apple\.WebKit\.(WebContent|Networking|GPU)/.test(
          p.command,
        )
      ) {
        family.add(p.pid);
      }
    }
  }
  return table
    .filter((p) => family.has(p.pid))
    .reduce((s, p) => s + p.rssKb * 1024, 0);
}

function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function summariseError(errorsMs) {
  const abs = errorsMs.map(Math.abs).sort((a, b) => a - b);
  const mean = errorsMs.reduce((s, v) => s + v, 0) / (errorsMs.length || 1);
  const sd = Math.sqrt(
    errorsMs.reduce((s, v) => s + (v - mean) ** 2, 0) / (errorsMs.length || 1),
  );
  return {
    frames: errorsMs.length,
    meanMs: +mean.toFixed(1),
    sdMs: +sd.toFixed(1),
    p50AbsMs: percentile(abs, 0.5),
    p95AbsMs: percentile(abs, 0.95),
    maxAbsMs: abs.at(-1) ?? null,
    earliestMs: Math.min(...errorsMs),
  };
}

async function measure(name, base, args) {
  const delay = Number(flag(args, "delay", 180));
  const windowSeconds = Number(flag(args, "window", 30));
  const query = new URLSearchParams({
    delay: String(delay),
    window: String(windowSeconds),
    bitrate: String(flag(args, "bitrate", 2_000_000)),
  });
  const cap = flag(args, "cap", null);
  if (cap) query.set("cap", cap);
  const dispose = flag(args, "dispose", null);
  if (dispose) query.set("dispose", dispose);

  const launchArgs =
    name === "chromium"
      ? {
          args: [
            "--enable-precise-memory-info",
            "--autoplay-policy=no-user-gesture-required",
          ],
        }
      : {};
  const preexisting = new Set(processTable().map((p) => p.pid));
  const server = await ENGINES[name].launchServer(launchArgs);
  const rootPid = server.process().pid;
  const browser = await ENGINES[name].connect(server.wsEndpoint());
  const rss = [];
  const startedAt = Date.now();
  const timer = setInterval(() => {
    rss.push({
      tSeconds: Math.round((Date.now() - startedAt) / 1000),
      rssBytes: engineRssBytes(rootPid, name, preexisting),
    });
  }, 5000);
  try {
    const page = await (await browser.newContext()).newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on(
      "console",
      (m) => m.type() === "error" && consoleErrors.push(m.text()),
    );
    await page.goto(`${base}/harness.html?${query}`);
    const baselineRss = engineRssBytes(rootPid, name, preexisting);
    await page.waitForFunction(() => window.__result?.done, null, {
      timeout: (delay + windowSeconds + 120) * 1000,
      polling: 5000,
    });
    let crashed = false;
    page.on("crash", () => {
      crashed = true;
    });
    if (dispose) {
      await page
        .waitForFunction(() => window.__result?.disposed, null, {
          timeout: 15000,
        })
        .catch(() => {});
    }
    const result = crashed
      ? { crashed }
      : await page
          .evaluate(() => window.__result)
          .catch(() => ({ crashed: true }));
    const errorsMs = result.errorsMs ?? [];
    delete result.errorsMs;
    return {
      engine: name,
      version: browser.version(),
      baselineRssBytes: baselineRss,
      peakRssBytes: Math.max(...rss.map((r) => r.rssBytes)),
      rss,
      release: summariseError(errorsMs),
      consoleErrors,
      ...result,
    };
  } finally {
    clearInterval(timer);
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const args = process.argv.slice(2);
const named = args.filter((a) => ENGINES[a]);
const engines = named.length > 0 ? named : Object.keys(ENGINES);
const httpServer = await serve();
const base = `http://127.0.0.1:${httpServer.address().port}`;
try {
  for (const name of engines) {
    console.log(JSON.stringify(await measure(name, base, args)));
  }
} finally {
  httpServer.close();
}
