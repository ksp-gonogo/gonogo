/**
 * Writes the review sheet: one local HTML page listing every registered
 * widget, augment and contribution and every ui-kit component export, each
 * linking to its story in a running Storybook, with an approve checkbox,
 * comments and a JSON export.
 *
 * Reads a fresh `build-storybook`: the registrations from the built preview
 * itself (the one runtime that loads every registering module), the ui-kit
 * exports from the generator's own reading of `index.ts`, and the story ids
 * from the generator's `review-targets.json`, each checked against the built
 * `index.json`. Fails, writing nothing, when a listing has no story or names
 * one the index does not hold.
 *
 * `--storybook-url <url>` is where the links point (default
 * http://localhost:6006), `--only <id,id>` narrows the page, `--out <dir>`
 * moves it from `dist/review/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Registered } from "../src/stories/Coverage.stories";
import { serve, storyIds } from "./built";
import type { TargetKind } from "./generate-stories";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const STATIC = join(DIST, "static");
const STORIES = join(DIST, "stories");
const TEMPLATE = join(HERE, "review-sheet.html");
const REGISTRY_STORY = "coverage--registry";
const KINDS: readonly TargetKind[] = ["widget", "extension", "primitive"];

type Targets = Record<TargetKind, Record<string, string[]>>;

interface Listing {
  kind: TargetKind;
  id: string;
  title: string;
  subtitle: string;
  stories: string[];
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: run build-storybook first.`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
    throw new Error(`${where} is not a list of strings`);
  }
  return v;
}

/** The generator's `review-targets.json`: story ids by kind, then by listing id. */
function readTargets(file: string): Targets {
  const raw = readJson(file);
  if (!isRecord(raw)) throw new Error(`${file} is not an object`);
  const targets: Targets = { widget: {}, extension: {}, primitive: {} };
  for (const kind of KINDS) {
    const byId = raw[kind];
    if (!isRecord(byId)) throw new Error(`${file} has no ${kind} map`);
    for (const [id, ids] of Object.entries(byId)) {
      targets[kind][id] = strings(ids, `${file} ${kind} ${id}`);
    }
  }
  return targets;
}

/** The ui-kit component exports the generator found, grouped by how each is storied. */
function readUiKit(file: string): [string[], string][] {
  const raw = readJson(file);
  if (!isRecord(raw)) throw new Error(`${file} is not an object`);
  const uncovered = raw.uncovered;
  if (!Array.isArray(uncovered))
    throw new Error(`${file} has no uncovered list`);
  return [
    [strings(raw.defaults, `${file} defaults`), "default story"],
    [strings(raw.presets, `${file} presets`), "preset states"],
    [strings(raw.handwritten, `${file} handwritten`), "hand-written stories"],
    [
      uncovered.map((u) => (isRecord(u) ? String(u.name) : String(u))),
      "no story",
    ],
  ];
}

/** Every registration the built preview loads, read off the page that loads them all. */
async function readRegistered(base: string): Promise<Registered[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/iframe.html?id=${REGISTRY_STORY}&viewMode=story`);
    await page.waitForFunction(() => window.__gonogoRegistered !== undefined);
    return await page.evaluate(() => window.__gonogoRegistered?.() ?? []);
  } finally {
    await browser.close();
  }
}

function listings(
  registered: Registered[],
  primitives: [string[], string][],
  targets: Targets,
): Listing[] {
  const out: Listing[] = [];
  for (const r of registered) {
    const kind = r.kind === "widget" ? "widget" : "extension";
    out.push({
      kind,
      id: r.id,
      title: r.name ?? r.id,
      subtitle: r.kind === "widget" ? r.id : `${r.kind} in ${r.slot}`,
      stories: targets[kind][r.id] ?? [],
    });
  }
  for (const [names, how] of primitives) {
    for (const name of names) {
      out.push({
        kind: "primitive",
        id: name,
        title: name,
        subtitle: how,
        stories: targets.primitive[name] ?? [],
      });
    }
  }
  return out.sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.id.localeCompare(b.id),
  );
}

/** Every listing without a story, or with one the built index does not hold. */
function faults(all: Listing[], indexed: Set<string>): string[] {
  const out: string[] = [];
  for (const l of all) {
    if (l.stories.length === 0) out.push(`${l.kind} ${l.id} has no story`);
    for (const id of l.stories) {
      if (!indexed.has(id)) {
        out.push(`${l.kind} ${l.id} names story ${id}, not in the index`);
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const storybookUrl = (
    flag(argv, "--storybook-url") ?? "http://localhost:6006"
  ).replace(/\/+$/, "");
  const only = flag(argv, "--only");
  const outDir = resolve(flag(argv, "--out") ?? join(DIST, "review"));

  const primitives = readUiKit(join(STORIES, "ui-kit-coverage.json"));
  const targets = readTargets(join(STORIES, "review-targets.json"));
  if (!existsSync(join(STATIC, "index.json"))) {
    throw new Error(`${STATIC} holds no build: run build-storybook first.`);
  }

  const { server, url } = await serve(STATIC);
  let registered: Registered[];
  let indexed: Set<string>;
  try {
    indexed = new Set(await storyIds(url));
    registered = await readRegistered(url);
  } finally {
    server.close();
  }
  if (registered.length === 0) {
    throw new Error(`${REGISTRY_STORY} reported no registrations.`);
  }

  const all = listings(registered, primitives, targets);
  const found = faults(all, indexed);
  if (found.length > 0) {
    for (const f of found) console.error(`review-sheet: ${f}`);
    console.error(
      `review-sheet: ${found.length} listing(s) cannot link to a story; nothing written.`,
    );
    process.exitCode = 1;
    return;
  }

  const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
  const items = wanted ? all.filter((l) => wanted.has(l.id)) : all;
  const data = {
    generatedAt: new Date().toISOString(),
    sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: HERE })
      .toString()
      .trim(),
    storybookUrl,
    items,
  };
  mkdirSync(outDir, { recursive: true });
  const page = join(outDir, "index.html");
  writeFileSync(
    page,
    readFileSync(TEMPLATE, "utf8").replace(
      '"__REVIEW_DATA__"',
      JSON.stringify(data).replace(/</g, "\\u003c"),
    ),
  );
  const count = (kind: TargetKind) =>
    items.filter((i) => i.kind === kind).length;
  console.log(
    `review-sheet: ${count("widget")} widgets, ${count("extension")} extensions, ${count("primitive")} ui-kit components, every one linked to a story in the built index`,
  );
  console.log(`review-sheet: links point at ${storybookUrl}`);
  console.log(`review-sheet: file://${page}`);
}

await main();
