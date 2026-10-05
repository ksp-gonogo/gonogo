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
 * one the index does not hold, or when a slot the sdk declares has no augment
 * row: every run first drops one slot's rows and fails as BLIND if that check
 * does not report it.
 *
 * A fourth kind, `prose`, lists every string of each registered copy table
 * (`prose-sources.ts`): its current text, a box to rewrite it in, and the
 * story that shows it, found by reading each of the table's stories in the
 * built preview. A string no story shows is a fault like a missing story, and
 * every run plants one and fails as BLIND if it is not reported. The export
 * carries each rewritten string with the text it replaces, for `prose-apply`.
 *
 * Each item carries its fingerprint and how it stands against the review
 * ledger (`--ledger <path>`, see `ledger.ts`). The page lists only what is not
 * approved at its current fingerprint, and says how many it left out; `--all`
 * lists everything. An item that cannot be fingerprinted is a fault like a
 * missing story.
 *
 * `--storybook-url <url>` is where the links point (default
 * http://localhost:6006), `--only <id,id>` and `--kind <kind,kind>` narrow the
 * page, `--out <dir>` moves it from `dist/review/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Project, SyntaxKind } from "ts-morph";
import type { Registered } from "../src/stories/Coverage.stories";
import { serve, storyEntries } from "./built";
import { Fingerprinter } from "./fingerprint";
import type { TargetKind } from "./generate-stories";
import {
  type ItemKind,
  ledgerKey,
  ledgerPath,
  readLedger,
  type Standing,
  standing,
} from "./ledger";
import {
  proseFingerprint,
  readCopy,
  type Shown,
  storiesShowing,
} from "./prose";
import { PROSE_SOURCES, type ProseSource } from "./prose-sources";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const STATIC = join(DIST, "static");
const STORIES = join(DIST, "stories");
const TEMPLATE = join(HERE, "review-sheet.html");
const REGISTRY_STORY = "coverage--registry";
const KINDS: readonly TargetKind[] = ["widget", "extension", "primitive"];
const ITEM_KINDS: readonly ItemKind[] = [...KINDS, "prose"];
/** A string planted in every copy table that no story shows, which the shown-nowhere check must report. */
const PROSE_PLANT = "planted prose: no story shows these words";
const REPO = resolve(HERE, "../../..");
const SLOTS = resolve(REPO, "mod/sitrep-sdk/src/api/slots.ts");

type Targets = Record<TargetKind, Record<string, string[]>>;

interface Listing {
  kind: ItemKind;
  id: string;
  title: string;
  subtitle: string;
  /** The slot an augment row fills. */
  slot?: string;
  stories: string[];
  /** A prose item's current text. */
  text?: string;
}

/** A listing with stories of its own to be fingerprinted by: everything but prose. */
interface TargetListing extends Listing {
  kind: TargetKind;
}

interface Reviewed extends Listing {
  fingerprint: string;
  standing: Standing;
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
): TargetListing[] {
  const out: TargetListing[] = [];
  for (const r of registered) {
    const kind = r.kind === "widget" ? "widget" : "extension";
    out.push({
      kind,
      id: r.id,
      title: r.name ?? r.id,
      subtitle: r.kind === "widget" ? r.id : `${r.kind} in ${r.slot}`,
      slot: r.kind === "augment" ? r.slot : undefined,
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

/** What each story's page reads once it has settled: every element's text and worded attribute. */
async function readShown(base: string, ids: readonly string[]): Promise<Shown> {
  const shown: Record<string, string[]> = {};
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const id of ids) {
      await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
      await page.waitForFunction(
        () =>
          (document.querySelector("#storybook-root")?.children.length ?? 0) > 0,
      );
      let last = "";
      for (let tries = 0; tries < 20; tries++) {
        await page.waitForTimeout(250);
        const now = await page.evaluate(
          () => document.querySelector("#storybook-root")?.textContent ?? "",
        );
        if (now === last) break;
        last = now;
      }
      shown[id] = await page.evaluate(() => {
        const root = document.querySelector("#storybook-root");
        if (root === null) return [];
        const out = new Set<string>();
        for (const el of [root, ...root.querySelectorAll("*")]) {
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text !== "") out.add(text);
          for (const name of ["aria-label", "title", "placeholder"]) {
            const value = el.getAttribute(name);
            if (value) out.add(value.replace(/\s+/g, " ").trim());
          }
        }
        return [...out];
      });
    }
  } finally {
    await browser.close();
  }
  return shown;
}

/**
 * One source's strings as listings, each with the stories that show it, and a
 * fault for each string none does.
 */
function proseListings(
  source: ProseSource,
  shown: Shown,
  order: readonly string[],
): { listings: Listing[]; faults: string[] } {
  const file = resolve(REPO, source.file);
  const entries = readCopy(
    readFileSync(file, "utf8"),
    source.exportName,
    source.file,
  );
  const listings: Listing[] = [];
  const found: string[] = [];
  if (order.length === 0) {
    found.push(
      `prose source ${source.id} has no story titled ${source.storyTitle}`,
    );
  }
  if (storiesShowing("plant", PROSE_PLANT, shown, order).length > 0) {
    throw new Error(
      `BLIND: a planted string no story shows was found in ${source.storyTitle}, so a string reported as shown means nothing.`,
    );
  }
  for (const entry of entries) {
    const stories = storiesShowing(entry.key, entry.text, shown, order);
    if (stories.length === 0) {
      found.push(
        `prose ${source.id}:${entry.key} is shown by no story titled ${source.storyTitle}`,
      );
    }
    listings.push({
      kind: "prose",
      id: `${source.id}:${entry.key}`,
      title: entry.key,
      subtitle: source.title,
      stories,
      text: entry.text,
    });
  }
  return { listings, faults: found };
}

/** Every slot id the sdk's `SlotRegistry` declares. */
function declaredSlots(): string[] {
  const file = new Project({
    skipAddingFilesFromTsConfig: true,
  }).addSourceFileAtPath(SLOTS);
  const registry = file
    .getDescendantsOfKind(SyntaxKind.InterfaceDeclaration)
    .find((i) => i.getName() === "SlotRegistry");
  if (!registry) throw new Error(`${SLOTS} declares no SlotRegistry`);
  const slots = registry
    .getProperties()
    .map((p) => p.getName().replace(/^"|"$/g, ""));
  if (slots.length === 0) throw new Error(`${SLOTS} declares no slots`);
  return slots;
}

/** Each declared slot no augment row fills. */
function unlistedSlots(all: Listing[], declared: string[]): string[] {
  const listed = new Set(all.flatMap((l) => (l.slot ? [l.slot] : [])));
  return declared.filter((slot) => !listed.has(slot));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const storybookUrl = (
    flag(argv, "--storybook-url") ?? "http://localhost:6006"
  ).replace(/\/+$/, "");
  const only = flag(argv, "--only");
  const kinds = flag(argv, "--kind");
  const everything = argv.includes("--all");
  const outDir = resolve(flag(argv, "--out") ?? join(DIST, "review"));

  const primitives = readUiKit(join(STORIES, "ui-kit-coverage.json"));
  const targets = readTargets(join(STORIES, "review-targets.json"));
  if (!existsSync(join(STATIC, "index.json"))) {
    throw new Error(`${STATIC} holds no build: run build-storybook first.`);
  }

  const { server, url } = await serve(STATIC);
  let registered: Registered[];
  let indexed: Set<string>;
  const prose: Listing[] = [];
  const proseFaults: string[] = [];
  try {
    const entries = await storyEntries(url);
    indexed = new Set(entries.map((entry) => entry.id));
    registered = await readRegistered(url);
    for (const source of PROSE_SOURCES) {
      const order = entries
        .filter((entry) => entry.title === source.storyTitle)
        .map((entry) => entry.id);
      const read = proseListings(source, await readShown(url, order), order);
      prose.push(...read.listings);
      proseFaults.push(...read.faults);
    }
  } finally {
    server.close();
  }
  if (registered.length === 0) {
    throw new Error(`${REGISTRY_STORY} reported no registrations.`);
  }

  const all = listings(registered, primitives, targets);
  const declared = declaredSlots();
  const [plant] = declared;
  const planted = all.filter((l) => l.slot !== plant);
  if (!unlistedSlots(planted, declared).includes(plant)) {
    throw new Error(
      `BLIND: with every row for slot ${plant} dropped, the slot check did not report it, so a clean run means nothing.`,
    );
  }
  const fingerprinter = new Fingerprinter(REPO);
  const ledgerFile = ledgerPath(argv);
  const ledger = readLedger(ledgerFile);
  const reviewed: Reviewed[] = [];
  const unprinted: string[] = [];
  for (const l of all) {
    const print = fingerprinter.fingerprint(l);
    if ("fault" in print) {
      unprinted.push(`cannot fingerprint: ${print.fault}`);
      continue;
    }
    const entry = ledger[ledgerKey(l.kind, l.id)];
    reviewed.push({
      ...l,
      fingerprint: print.hash,
      standing: standing(entry, print.hash),
    });
  }
  for (const l of prose) {
    const fingerprint = proseFingerprint(l.text ?? "");
    reviewed.push({
      ...l,
      fingerprint,
      standing: standing(ledger[ledgerKey(l.kind, l.id)], fingerprint),
    });
  }
  const found = [
    ...unprinted,
    ...proseFaults,
    ...faults(all, indexed),
    ...unlistedSlots(all, declared).map(
      (slot) => `slot ${slot} is declared and no augment row fills it`,
    ),
  ];
  if (found.length > 0) {
    for (const f of found) console.error(`review-sheet: ${f}`);
    console.error(
      `review-sheet: ${found.length} listing(s) cannot link to a story; nothing written.`,
    );
    process.exitCode = 1;
    return;
  }

  const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
  const wantedKinds = kinds
    ? new Set(kinds.split(",").map((s) => s.trim()))
    : null;
  for (const kind of wantedKinds ?? []) {
    if (!ITEM_KINDS.some((k) => k === kind)) {
      throw new Error(`--kind ${kind} is not one of ${ITEM_KINDS.join(", ")}`);
    }
  }
  const asked = reviewed.filter(
    (l) =>
      (!wanted || wanted.has(l.id)) &&
      (!wantedKinds || wantedKinds.has(l.kind)),
  );
  const items = everything
    ? asked
    : asked.filter((l) => l.standing !== "approved");
  const stillApproved = asked.filter((l) => l.standing === "approved").length;
  const leftOut = asked.length - items.length;
  const data = {
    generatedAt: new Date().toISOString(),
    sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: HERE })
      .toString()
      .trim(),
    storybookUrl,
    leftOut,
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
  const count = (kind: ItemKind) => items.filter((i) => i.kind === kind).length;
  console.log(
    `review-sheet: ${count("widget")} widgets, ${count("extension")} extensions, ${count("primitive")} ui-kit components, every one linked to a story in the built index`,
  );
  console.log(
    `review-sheet: ${count("prose")} prose strings from ${PROSE_SOURCES.length} copy table(s), every one shown by a story (plant: a string no story shows, reported)`,
  );
  const changed = items.filter((i) => i.standing === "changed").length;
  console.log(
    everything
      ? `review-sheet: every item listed, ${stillApproved} of them approved and unchanged`
      : `review-sheet: ${items.length} unapproved item(s) listed (${changed} approved before and changed since); ${stillApproved} approved and unchanged, left out`,
  );
  console.log(
    existsSync(ledgerFile)
      ? `review-sheet: ledger ${ledgerFile}`
      : `review-sheet: no ledger at ${ledgerFile}, so nothing counts as approved`,
  );
  console.log(
    `review-sheet: all ${declared.length} declared slots have an augment row (plant: slot ${plant} dropped, reported)`,
  );
  console.log(`review-sheet: links point at ${storybookUrl}`);
  console.log(`review-sheet: file://${page}`);
}

await main();
