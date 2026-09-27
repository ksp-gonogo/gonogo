/**
 * Mounts every story in a built Storybook in Chromium and fails if any of them
 * throws: a render error, an uncaught page error, or a widget scene whose
 * fixture mount rejected.
 *
 * Serves the built `dist/static` itself, or checks a running Storybook when
 * `--url` is given. `--only <substring>` narrows the run to matching story ids.
 *
 * Before it trusts a clean run it mounts the planted stories (`Smoke plant`),
 * which fail on purpose, and fails as BLIND if either is reported clean: a
 * checker that cannot see a failure reports every story clean.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(HERE, "../dist/static");
const PLANT_IDS = ["smoke-plant--render-throws", "smoke-plant--mount-rejects"];
const STORY_TIMEOUT_MS = 30_000;
const WORKERS = 4;

/** Below this many stories the run is not a smoke check of the set. */
const MIN_STORIES = 300;

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serve(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(dir, path);
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

interface Outcome {
  id: string;
  errors: string[];
}

/** Mounts one story and returns what went wrong, empty when it mounted clean. */
async function mountStory(
  page: Page,
  base: string,
  id: string,
): Promise<Outcome> {
  const errors: string[] = [];
  const onError = (err: Error) => errors.push(`page error: ${err.message}`);
  page.on("pageerror", onError);
  try {
    await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        document.body.classList.contains("sb-show-main") ||
        document.body.classList.contains("sb-show-errordisplay"),
      undefined,
      { timeout: STORY_TIMEOUT_MS },
    );
    // A widget scene mounts after the first render, and can fail after it.
    await page.waitForFunction(
      () =>
        document.body.classList.contains("sb-show-errordisplay") ||
        [...document.querySelectorAll("[data-scene]")].every(
          (el) => el.getAttribute("data-scene") === "mounted",
        ),
      undefined,
      { timeout: STORY_TIMEOUT_MS },
    );
    const shown = await page.evaluate(() => {
      if (!document.body.classList.contains("sb-show-errordisplay"))
        return null;
      const box = document.querySelector("#error-message, .sb-errordisplay");
      return (box?.textContent ?? "render error").trim().slice(0, 400);
    });
    if (shown) errors.push(`render error: ${shown}`);
  } catch (err) {
    errors.push(
      `did not settle: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  } finally {
    page.off("pageerror", onError);
  }
  return { id, errors };
}

/** The ids of every story in a Storybook's index, refusing an index of any other shape. */
async function storyIds(base: string): Promise<string[]> {
  const res = await fetch(`${base}/index.json`);
  const index: unknown = await res.json();
  const entries =
    typeof index === "object" && index !== null && "entries" in index
      ? index.entries
      : undefined;
  if (typeof entries !== "object" || entries === null) {
    throw new Error(`${base}/index.json holds no story entries.`);
  }
  const ids: string[] = [];
  for (const entry of Object.values(entries)) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("type" in entry) || entry.type !== "story") continue;
    if ("id" in entry && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}

async function runAll(
  browser: Browser,
  base: string,
  ids: string[],
  quiet = false,
): Promise<Outcome[]> {
  const queue = [...ids];
  const outcomes: Outcome[] = [];
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, ids.length) }, async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const outcome = await mountStory(page, base, id);
        outcomes.push(outcome);
        if (quiet) continue;
        const mark = outcome.errors.length === 0 ? "ok  " : "FAIL";
        console.log(`  ${mark} ${id}`);
      }
      await context.close();
    }),
  );
  return outcomes;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf("--url");
  const onlyFlag = args.indexOf("--only");
  const only = onlyFlag === -1 ? undefined : args[onlyFlag + 1];
  let server: Server | undefined;
  let base = urlFlag === -1 ? undefined : args[urlFlag + 1];
  if (!base) {
    if (!existsSync(join(STATIC, "index.json"))) {
      throw new Error(
        `${STATIC} has no index.json: run build-storybook first.`,
      );
    }
    ({ server, url: base } = await serve(STATIC));
  }

  const browser = await chromium.launch();
  try {
    const all = await storyIds(base);
    const missing = PLANT_IDS.filter((id) => !all.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `BLIND: the planted stories ${missing.join(", ")} are not in the index.`,
      );
    }
    for (const plant of await runAll(browser, base, PLANT_IDS, true)) {
      if (plant.errors.length === 0) {
        throw new Error(
          `BLIND: the planted story ${plant.id} fails on purpose and was reported clean, so a clean run means nothing.`,
        );
      }
      console.log(`smoke: plant ${plant.id} seen (${plant.errors[0]})`);
    }

    const ids = all.filter(
      (id) => !PLANT_IDS.includes(id) && (!only || id.includes(only)),
    );
    if (!only && ids.length < MIN_STORIES) {
      throw new Error(
        `smoke: only ${ids.length} stories in the index, below the floor of ${MIN_STORIES}.`,
      );
    }
    const outcomes = await runAll(browser, base, ids);
    const failed = outcomes.filter((o) => o.errors.length > 0);
    for (const f of failed) {
      console.error(`\nFAIL ${f.id}`);
      for (const e of f.errors) console.error(`  ${e}`);
    }
    console.log(
      `\nsmoke: ${outcomes.length - failed.length}/${outcomes.length} stories mounted clean, ${failed.length} failed.`,
    );
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server?.close();
  }
}

await main();
