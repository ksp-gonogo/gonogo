/**
 * Mounts every story in a built Storybook in Chromium and fails if any of them
 * throws: a render error, an uncaught page error, a widget scene whose fixture
 * mount rejected, or a set of scenes whose independence check (`data-check`)
 * failed.
 *
 * Serves the built `dist/static` itself, or checks a running Storybook when
 * `--url` is given. `--only <substring>` narrows the run to matching story ids.
 *
 * Before it trusts a clean run it mounts the planted stories (`Smoke plant`),
 * which fail on purpose, and fails as BLIND if either is reported clean: a
 * checker that cannot see a failure reports every story clean.
 */
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { serve, storyIds } from "./built";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(HERE, "../dist/static");
/** Each planted story, and the failure it must be reported with. */
const PLANTS: Record<string, string> = {
  "smoke-plant--render-throws": "planted: this story throws on purpose",
  "smoke-plant--mount-rejects":
    'widget "planted-not-registered" not registered',
  "smoke-plant--extension-unexercised": "does not exercise it",
  "smoke-plant--shared-probe-slot": "twr standard-launch-ok drew nothing",
};
const PLANT_IDS = Object.keys(PLANTS);
const STORY_TIMEOUT_MS = 30_000;
const WORKERS = 4;

/** Below this many stories the run is not a smoke check of the set. */
const MIN_STORIES = 300;

interface Outcome {
  id: string;
  errors: string[];
}

/**
 * Runs in the page before Storybook does: records the preview's own verdict on
 * the story, `storyRendered` once React has committed it, or the failure event.
 * `sb-show-main` alone is set before the story's tree is in the DOM, so a scene
 * checked on it can be missed entirely. Plain source rather than a function, so
 * the transpiler's helpers are not serialised into a page that lacks them.
 */
const LISTEN_FOR_RENDER = `
  (() => {
    const state = { rendered: false, failed: null };
    window.__smoke = state;
    const attach = () => {
      const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel || typeof channel.on !== "function") {
        setTimeout(attach, 10);
        return;
      }
      channel.on("storyRendered", () => { state.rendered = true; });
      for (const event of ["storyErrored", "storyThrewException", "storyMissing"]) {
        channel.on(event, (detail) => {
          const text = detail instanceof Error ? detail.message : JSON.stringify(detail);
          state.failed = event + ": " + String(text).slice(0, 300);
        });
      }
    };
    attach();
  })();
`;

/** Mounts one story and returns what went wrong, empty when it mounted clean. */
async function mountStory(
  page: Page,
  base: string,
  id: string,
  args = "",
): Promise<Outcome> {
  const errors: string[] = [];
  const onError = (err: Error) => errors.push(`page error: ${err.message}`);
  page.on("pageerror", onError);
  try {
    await page.goto(`${base}/iframe.html?id=${id}&viewMode=story${args}`, {
      waitUntil: "domcontentloaded",
      // A dev server compiles on first request, so the first load can be slow.
      timeout: 120_000,
    });
    await page.waitForFunction(
      () => {
        const state = Reflect.get(window, "__smoke");
        return (
          state?.rendered === true ||
          state?.failed !== null ||
          document.body.classList.contains("sb-show-errordisplay")
        );
      },
      undefined,
      { timeout: STORY_TIMEOUT_MS },
    );
    const failed = await page.evaluate(
      () => Reflect.get(window, "__smoke")?.failed ?? null,
    );
    if (failed) errors.push(`story failed: ${failed}`);
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
    // A scene set checks its scenes' independence once they have all mounted.
    await page.waitForFunction(
      () => document.querySelector('[data-check="pending"]') === null,
      undefined,
      { timeout: STORY_TIMEOUT_MS },
    );
    const faults = await page.evaluate(() =>
      [...document.querySelectorAll('[data-check="fail"]')].map(
        (el) => el.getAttribute("data-check-fault") ?? "",
      ),
    );
    for (const fault of faults) {
      errors.push(`independence check failed: ${fault}`);
    }
  } catch (err) {
    errors.push(
      `did not settle: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  } finally {
    page.off("pageerror", onError);
  }
  return { id, errors };
}

/** Extension stories draw their host with one extension switchable by an `enabled` arg. */
const EXTENSION_PREFIX = "extensions--";

/**
 * Whether switching the story's extension off changes what its host draws.
 *
 * An extension story whose scene never exercises the extension renders the
 * same pixels either way, and passes as coverage while showing nothing of it.
 */
async function extensionShows(
  page: Page,
  base: string,
  id: string,
): Promise<string[]> {
  const on = await page.locator("[data-scene]").screenshot();
  const off = await mountStory(page, base, id, "&args=enabled:!false");
  if (off.errors.length > 0) return off.errors.map((e) => `with it off, ${e}`);
  const without = await page.locator("[data-scene]").screenshot();
  if (Buffer.compare(on, without) !== 0) return [];
  return [
    "the host draws the same pixels with the extension off, so this scene does not exercise it",
  ];
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
      await context.addInitScript({ content: LISTEN_FOR_RENDER });
      const page = await context.newPage();
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const outcome = await mountStory(page, base, id);
        const isExtension =
          id.startsWith(EXTENSION_PREFIX) ||
          id === "smoke-plant--extension-unexercised";
        if (outcome.errors.length === 0 && isExtension) {
          outcome.errors.push(...(await extensionShows(page, base, id)));
        }
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
      if (!plant.errors.some((e) => e.includes(PLANTS[plant.id]))) {
        throw new Error(
          `BLIND: the planted story ${plant.id} fails on purpose and was not reported with its own failure (${plant.errors.join("; ") || "reported clean"}), so a clean run means nothing.`,
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
