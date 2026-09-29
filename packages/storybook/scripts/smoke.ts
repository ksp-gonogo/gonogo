/**
 * Mounts every story in a built Storybook in Chromium and fails if any of them
 * throws: a render error, an uncaught page error, a widget scene whose fixture
 * mount rejected, or a set of scenes whose independence check (`data-check`)
 * failed.
 *
 * Serves the built `dist/static` itself, or checks a running Storybook when
 * `--url` is given. `--only <substring>` narrows the run to matching story ids.
 *
 * A ui-kit story must also show its component doing something: one that draws
 * nothing, or whose whole text is the component's own name, fails.
 *
 * Every story is also held to WCAG AA text contrast in the real browser, by
 * axe's `color-contrast` rule over what it actually painted: a backstop for
 * text the design system's own rules missed, such as a control whose words
 * came from a browser default. Words drawn through opacity fail on their own,
 * since axe passes some of them that read below contrast; a disabled control
 * is exempt, as WCAG exempts inactive components.
 *
 * Before it trusts a clean run it mounts the planted stories (`Smoke plant`),
 * which fail on purpose, and fails as BLIND if either is reported clean: a
 * checker that cannot see a failure reports every story clean.
 */

import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type AxeCore from "axe-core";
import { type Browser, chromium, type Page } from "playwright";
import { PNG } from "pngjs";
import { serve, storyEntries } from "./built";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(HERE, "../dist/static");
/** Each planted story, and the failure it must be reported with. */
const PLANTS: Record<string, string> = {
  "smoke-plant--render-throws": "planted: this story throws on purpose",
  "smoke-plant--mount-rejects":
    'widget "planted-not-registered" not registered',
  "smoke-plant--extension-unexercised": "does not exercise it",
  "smoke-plant--shared-probe-slot": "twr standard-launch-ok drew nothing",
  "smoke-plant--draws-nothing": "draws nothing",
  "smoke-plant--renders-its-name": "renders only its own name",
  "smoke-plant--unreadable-text": "contrast: #planted-unreadable",
  "smoke-plant--dimmed-words": "opacity: #planted-dimmed",
};
const PLANT_IDS = Object.keys(PLANTS);
const STORY_TIMEOUT_MS = 30_000;

declare global {
  interface Window {
    axe?: typeof AxeCore;
  }
}

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

/** Text below its WCAG AA contrast floor against what the browser painted behind it, one line per element. */
async function contrastFailures(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = window.axe;
    if (axe === undefined) throw new Error("smoke: axe did not load");
    const result = await axe.run("#storybook-root", {
      runOnly: { type: "rule", values: ["color-contrast"] },
      resultTypes: ["violations"],
    });
    return result.violations.flatMap((v) =>
      v.nodes.map(
        (n) =>
          `contrast: ${n.target.join(" ")}: ${n.any[0]?.message ?? "below the WCAG AA floor"}`,
      ),
    );
  });
}

/**
 * Words painted through an opacity below one, on themselves or an ancestor,
 * one line per element. Opacity zero is not drawn at all, so it is not dimmed.
 */
async function dimmedWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector("#storybook-root");
    if (root === null) return [];
    const found: string[] = [];
    const checked = new Set<Element>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? "";
      const el = node.parentElement;
      if (text === "" || el === null || checked.has(el)) continue;
      checked.add(el);
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      if (el.getClientRects().length === 0) continue;
      if (getComputedStyle(el).visibility !== "visible") continue;
      let alpha = 1;
      for (let at: Element | null = el; at !== null; at = at.parentElement) {
        alpha *= Number(getComputedStyle(at).opacity);
      }
      if (alpha === 0 || alpha > 0.999) continue;
      // Inline rather than a helper: a named function picks up a transpiler helper the page lacks.
      const cls = el.getAttribute("class")?.split(/\s+/)[0];
      const tag = el.tagName.toLowerCase();
      let where = cls ? `${tag}.${cls}` : tag;
      if (el.id) where = `#${el.id}`;
      found.push(
        `opacity: ${where} draws "${text.slice(0, 40)}" at ${alpha.toFixed(2)}`,
      );
    }
    return found;
  });
}
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
    if (errors.length === 0) {
      errors.push(...(await contrastFailures(page)));
      errors.push(...(await dimmedWords(page)));
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

/** Extension stories, slot stubs included, draw their host with one extension switchable by an `enabled` arg. */
const EXTENSION_PREFIX = "extensions-";

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

/** Stories held to showing their component at work, beyond mounting clean. */
const UI_KIT_PREFIX = "ui-kit-";
const SHOWS_PLANTS = [
  "smoke-plant--draws-nothing",
  "smoke-plant--renders-its-name",
];

/**
 * Whether a story shows more than an empty frame or its component's own name,
 * the two things a story generated from props alone falls back to. `name` is
 * the last segment of the story's title.
 */
async function storyShows(page: Page, name: string): Promise<string[]> {
  const root = page.locator("#storybook-root");
  const text = (await root.innerText()).replace(/\s+/g, " ").trim();
  if (text.toLowerCase() === name.toLowerCase()) {
    return [`renders only its own name, "${text}"`];
  }
  const box = await root.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return ["draws nothing"];
  const { data } = PNG.sync.read(await root.screenshot());
  const first = data.readUInt32LE(0);
  for (let i = 4; i < data.length; i += 4) {
    if (data.readUInt32LE(i) !== first) return [];
  }
  return ["draws nothing: every pixel of the story is its background"];
}

async function runAll(
  browser: Browser,
  base: string,
  ids: string[],
  titles: Map<string, string>,
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
        const heldToShow =
          id.startsWith(UI_KIT_PREFIX) || SHOWS_PLANTS.includes(id);
        if (outcome.errors.length === 0 && heldToShow) {
          const name = (titles.get(id) ?? "").split("/").pop() ?? "";
          outcome.errors.push(...(await storyShows(page, name)));
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
    const entries = await storyEntries(base);
    const all = entries.map((entry) => entry.id);
    const titles = new Map(entries.map((entry) => [entry.id, entry.title]));
    const missing = PLANT_IDS.filter((id) => !all.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `BLIND: the planted stories ${missing.join(", ")} are not in the index.`,
      );
    }
    for (const plant of await runAll(browser, base, PLANT_IDS, titles, true)) {
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
    const outcomes = await runAll(browser, base, ids, titles);
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
