import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  InventoryAugment,
  InventoryContribution,
  InventoryWidget,
  UplinkInventory,
} from "../render-probe";
import { readJson, type UplinkPackage } from "./context";
import type { RenderedAsset } from "./driver";
import type { Scene } from "./scenes";
import { readWireSurface, wireSection } from "./wire";

/**
 * What the page generator needs of an asset, which is less than a render.
 *
 * `page-check.ts` builds this list from the scenes alone, with no browser and so
 * no rendered files behind it, to compare the page's markdown against the code.
 * The generator writes image LINKS, so a filename and a size are all it reads,
 * and asking it for a `shape` would either force that path to fabricate one or
 * put the freshness question somewhere that structurally cannot answer it.
 */
type PageAsset = Omit<RenderedAsset, "shape">;

/**
 * The manifest first, the page from it.
 *
 * `gonogo-uplink.json` is specced in `docs/creating-an-uplink.md`, typed as
 * `GonogoUplinkManifest`, consumed by the app's loader on the third-party path,
 * described in the author guide as "build-generated, never hand-written", and did
 * not exist anywhere. Six client `uplink.ts` files carried
 * `UPLINK_VERSION = "0.0.0-dev"` with a `TODO(version)` saying it should come
 * from that file.
 *
 * So the manifest is the primary output and the README is that manifest plus the
 * Uplink's own declared description. Build it the other way round, as a doc
 * generator that happens to emit a manifest, and it drifts: a wrong manifest is
 * parsed by the loader at install time and fails visibly, whereas a wrong
 * paragraph fails silently forever.
 *
 * ## What the page contains, and why it is so short
 *
 * The Uplink's description, each widget's own registered description, DATA in
 * tables, and the screenshots. Nothing else.
 *
 * That is a ruling, not a style preference, and it replaced a page roughly twice
 * the length. What came out: a rationale paragraph per widget on top of the
 * description its registration already carries (two answers to one question, the
 * second longer); the rules of Uplinks restated as if specific to one of them
 * (presence-gating, the universal `badges`/`filters`/`meters` segments every
 * widget has) which belong in the Uplink documentation once and never per Uplink;
 * a 45-word explanation of why an augment had no preview, repeated verbatim five
 * times, where an empty table cell says the same thing; a closing section listing
 * what the page could not tell the reader, which is not information; and every
 * image's alt text repeated as an italic caption directly beneath it, so each
 * screenshot stated its sentence twice.
 *
 * The test to apply to anything added here: a reader should skim the whole page
 * in under a minute and come away with what the Uplink does, what its widgets
 * show, and what it puts on the wire. And: **if a thing repeats per item, it is a
 * table, not a section.** The augments went from five headed six-line sections to
 * one five-row table, which is the same information and comparable at a glance,
 * which the sections never were.
 */

export interface UplinkManifestJson {
  id: string;
  version: string;
  description?: string;
  minAppVersion: string;
  apiVersion: string;
  uiKitVersion: string;
  contractMajor: number;
  contractMinor: number;
  integrity: string;
}

/**
 * The sha256 of the file the author DISTRIBUTES, and only when they name it.
 *
 * Deliberately NO fallback to hashing `dist/index.js`, which is wrong twice
 * over. That file is a `tsc` output, not the bundle anyone ships (the shipped
 * one is an esbuild bundle built elsewhere), so the hash would describe a file
 * no consumer ever fetches. And because it is a gitignored build artifact,
 * `--check` would compare a committed hash against whatever the last local
 * build happened to produce, so a sibling branch adding a widget reports the
 * page stale over a number that is not the page's business. A gate that cries
 * wolf is a gate someone turns off.
 *
 * So: no `--bundle`, no integrity, and a loud warning saying what that costs.
 */
function bundleIntegrity(
  pkg: UplinkPackage,
  bundle: string | undefined,
): { integrity: string; warning?: string } {
  if (!bundle) {
    return {
      integrity: "",
      warning:
        "no --bundle given, so gonogo-uplink.json carries an EMPTY integrity " +
        "and the app will quarantine this Uplink with an integrity mismatch. " +
        "That is correct for a working copy: regenerate with " +
        "`--bundle <the file you distribute>` when you cut a release. It is " +
        "deliberately NOT defaulted to dist/, which holds a compiler output " +
        "rather than the bundle a consumer fetches.",
    };
  }
  const candidate = resolve(pkg.dir, bundle);
  try {
    statSync(candidate);
  } catch {
    throw new Error(
      `gonogo-uplink: --bundle ${bundle} does not exist (looked at ` +
        `${candidate}). Naming a bundle and getting no hash would be worse ` +
        "than naming none.",
    );
  }
  const bytes = readFileSync(candidate);
  return {
    integrity: `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export interface DocsInputs {
  pkg: UplinkPackage;
  inventory: UplinkInventory;
  scenes: Scene[];
  assets: readonly PageAsset[];
  /** Path, relative to the package, of the file distributed to users. */
  bundle?: string;
  /** Where assets live, relative to the package. */
  assetDir: string;
}

/** What the Uplink wraps, from `uplink.json`'s `mod` block when it has one. */
interface DeclaredMod {
  name?: string;
  builtAgainst?: string;
  tier?: string;
}

/**
 * `uplink.json`, searched from the client upwards.
 *
 * It sits beside BOTH halves of an Uplink, so it is one level up from a flat
 * layout's client and two from a monorepo's, exactly as `gonogo-uplink bundle`
 * searches for it. Absent is normal: an Uplink bundled inside the app's own repo
 * has no separate declaration, and the page simply omits the row it would have
 * filled rather than inventing one.
 */
function declaredUplink(pkgDir: string): { mod?: DeclaredMod } {
  let dir = pkgDir;
  for (let up = 0; up < 3; up++) {
    const file = join(dir, "uplink.json");
    if (existsSync(file)) {
      const found = readJson<{ mod?: DeclaredMod | null }>(file);
      if (found.mod) return { mod: found.mod };
    }
    dir = resolve(dir, "..");
  }
  return {};
}

export function buildManifest(inputs: DocsInputs): {
  manifest: UplinkManifestJson;
  warning?: string;
} {
  const { integrity, warning } = bundleIntegrity(inputs.pkg, inputs.bundle);
  const declared = readJson<{
    version?: string;
    gonogo?: { minAppVersion?: string };
  }>(join(inputs.pkg.dir, "package.json"));
  // The client's `defineUplinkClient({ version })` is the source of the number
  // this manifest carries, and the package's own version is what a consumer
  // installs. Six Uplinks declared "0.0.0-dev" against a published 0.0.1, under
  // a TODO saying the BUILD would inject the version from this manifest, which
  // cannot work: the manifest is generated from the declaration.
  if (
    declared.version !== undefined &&
    inputs.inventory.version !== declared.version
  ) {
    throw new Error(
      `gonogo-uplink: this client declares version "${inputs.inventory.version}" ` +
        `through defineUplinkClient, and package.json says "${declared.version}". ` +
        "The manifest can only claim one of them, and the app compares what it " +
        "reads here against what the loaded bundle declares. Make them equal " +
        "(the declaration in client/src/uplink.ts is the one to edit).",
    );
  }
  return {
    manifest: {
      id: inputs.inventory.id,
      version: inputs.inventory.version,
      description: inputs.inventory.description,
      // The one gate field nothing can derive: it is a claim about the APP, and
      // only the author knows which app feature their Uplink needs. Declared in
      // package.json under `gonogo.minAppVersion`; "0.0.0" means no floor.
      minAppVersion: declared.gonogo?.minAppVersion ?? "0.0.0",
      apiVersion: inputs.inventory.compat.apiVersion,
      uiKitVersion: inputs.inventory.compat.uiKitVersion,
      contractMajor: inputs.inventory.compat.contractMajor,
      contractMinor: inputs.inventory.compat.contractMinor,
      integrity,
    },
    warning,
  };
}

/** Backticked, comma-joined, or an en dash for a table cell with nothing in it. */
function list(items: readonly string[]): string {
  return items.length > 0 ? items.map((i) => `\`${i}\``).join(", ") : "–";
}

/** A two-column fact table, skipping every row whose value is empty. */
function facts(rows: ReadonlyArray<[string, string | undefined]>): string[] {
  const present = rows.filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (present.length === 0) return [];
  return [
    "| | |",
    "| --- | --- |",
    ...present.map(([label, value]) => `| ${label} | ${value} |`),
    "",
  ];
}

/** A headed table, or nothing at all when it would have no rows. */
function table(
  headers: readonly string[],
  rows: readonly string[][],
): string[] {
  if (rows.length === 0) return [];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
    "",
  ];
}

/**
 * The images for one registration: alt text and nothing else.
 *
 * The alt text was previously repeated verbatim as an italic caption directly
 * underneath every image, so each screenshot stated its sentence twice. The
 * scene's caption goes in the alt, where a screen reader and a broken-image
 * placeholder both find it.
 *
 * A scene rendered at several sizes gets ONE caption, on the first, and a short
 * size phrase on the others: five images captioned with the same sentence is the
 * repetition this page is against, and "the same widget at its minimum size" is
 * the only thing the extra renders actually add.
 */
function images(inputs: DocsInputs, assets: readonly PageAsset[]): string[] {
  const out: string[] = [];
  const captioned = new Set<string>();
  for (const asset of assets) {
    const path = `${inputs.assetDir}/${asset.file}`;
    const first = !captioned.has(asset.scene.name);
    captioned.add(asset.scene.name);
    out.push("", `![${first ? altFor(asset) : sizePhrase(asset)}](${path})`);
  }
  return out;
}

function altFor(asset: PageAsset): string {
  return asset.scene.caption ?? asset.scene.name;
}

function sizePhrase(asset: PageAsset): string {
  if (asset.mode === "min") return "The same widget at its minimum size";
  const mode = asset.scene.modes.find((m) => m.name === asset.mode);
  return mode
    ? `The same widget at ${mode.w} × ${mode.h}`
    : `The same widget, ${asset.mode}`;
}

function assetsFor(
  inputs: DocsInputs,
  kind: string,
  id: string,
): readonly PageAsset[] {
  return inputs.assets.filter(
    (a) => a.scene.target.kind === kind && a.scene.target.id === id,
  );
}

function widgetSection(inputs: DocsInputs, widget: InventoryWidget): string[] {
  const out = [`### ${widget.name}`, "", widget.description, ""];
  // `channels` when the widget declares them, `dataRequirements` otherwise: they
  // are two generations of the same declaration and a widget on the older one
  // still reads something, so quoting an empty `channels` would print nothing
  // about a widget with five topics.
  const reads =
    widget.channels.length > 0 ? widget.channels : widget.dataRequirements;
  const slots = [...widget.augmentSlots, ...widget.contributionSlots];
  out.push(
    ...facts([
      ["Widget id", `\`${widget.id}\``],
      ["Reads", reads.length > 0 ? list(reads) : undefined],
      [
        "Uses if present",
        widget.optionalChannels.length > 0
          ? list(widget.optionalChannels)
          : undefined,
      ],
      [
        "Actions",
        widget.actions.length > 0
          ? list(widget.actions.map((a) => a.id))
          : undefined,
      ],
      ["Slots", slots.length > 0 ? list(slots) : undefined],
      [
        "Only while present",
        widget.requires.length > 0 ? list(widget.requires) : undefined,
      ],
      ["Replaces", widget.replaces ? `\`${widget.replaces}\`` : undefined],
      ["Default size", `${widget.modes[0].w} × ${widget.modes[0].h}`],
    ]),
  );
  out.push(...images(inputs, assetsFor(inputs, "widget", widget.id)));
  return out;
}

/**
 * Every augment in ONE table, with its images after it.
 *
 * A section per augment was six lines each and five of them repeated the same
 * paragraph about previews. As a table the five are comparable at a glance,
 * which is what a reader is actually doing: seeing which host widgets this
 * Uplink reaches into.
 */
function augmentTable(inputs: DocsInputs): string[] {
  const rows = inputs.inventory.augments.map((augment: InventoryAugment) => {
    const notes: string[] = [];
    if (augment.suppressesVanillaBase) notes.push("replaces the host surface");
    if (augment.settings.length > 0) {
      notes.push(
        `adds ${augment.settings.map((s) => `\`${s.key}\` (${s.type})`).join(", ")}`,
      );
    }
    return [
      `\`${augment.id}\``,
      `\`${augment.augments}\``,
      list(augment.channels),
      augment.requires ? `only while \`${augment.requires}\`` : "",
      notes.join("; "),
    ];
  });
  if (rows.length === 0) return [];
  return [
    "## Augments",
    "",
    ...table(["Augment", "Into", "Reads", "Presence", "Notes"], rows),
    ...inputs.inventory.augments.flatMap((augment) =>
      images(inputs, assetsFor(inputs, "augment", augment.id)),
    ),
    "",
  ];
}

function contributionTable(inputs: DocsInputs): string[] {
  const rows = inputs.inventory.contributions.map(
    (contribution: InventoryContribution) => [
      `\`${contribution.id}\``,
      `\`${contribution.contributes}\``,
      list(contribution.deps),
      contribution.requires ? `only while \`${contribution.requires}\`` : "",
    ],
  );
  if (rows.length === 0) return [];
  return [
    "## Contributions",
    "",
    ...table(["Contribution", "Into", "Computed from", "Presence"], rows),
    ...inputs.inventory.contributions.flatMap((contribution) =>
      images(inputs, assetsFor(inputs, "contribution", contribution.id)),
    ),
    "",
  ];
}

function modelTable(inputs: DocsInputs): string[] {
  const rows = [
    ...inputs.inventory.processors.map((id) => ["processor", `\`${id}\``]),
    ...inputs.inventory.reckonedTopics.map((id) => [
      "forward model",
      `\`${id}\``,
    ]),
    ...inputs.inventory.derivedChannels.map((id) => [
      "derived channel",
      `\`${id}\``,
    ]),
  ];
  if (rows.length === 0) return [];
  return ["## Models", "", ...table(["Kind", "Id"], rows)];
}

export function buildReadme(
  inputs: DocsInputs,
  manifest: UplinkManifestJson,
): string {
  const { inventory } = inputs;
  if (!inventory.description?.trim()) {
    throw new Error(
      "gonogo-uplink docs: this client declares no `description`, and the page " +
        "opens with it.\n\n" +
        "Add one to `defineUplinkClient` in client/src/uplink.ts, in one or two " +
        "sentences saying what the Uplink does:\n" +
        '  defineUplinkClient({ id, version, name, description: "…" })\n\n' +
        "It is a field rather than a prose file on purpose. Everything else on " +
        "the page comes from your registrations, your contract slice and your " +
        "fixtures, so this is the only sentence anyone writes.",
    );
  }

  const wire = readWireSurface(inputs.pkg.dir);
  const mod = declaredUplink(inputs.pkg.dir).mod;
  const out: string[] = [
    "<!-- Generated by `gonogo-uplink docs`. Do not edit this file: it is written",
    "     from the registrations, the contract slice and the fixtures. -->",
    "",
    `# ${inventory.name}`,
    "",
    // Whitespace collapsed, not just trimmed. A description written across source
    // lines arrives carrying the newline and the source indent, and four spaces at
    // the start of a markdown line is a CODE BLOCK: the Uplink's one sentence
    // would render as monospace with a scrollbar.
    inventory.description.replace(/\s+/g, " ").trim(),
    "",
    ...facts([
      ["Uplink id", `\`${inventory.id}\``],
      ["Version", `\`${inventory.version}\``],
      [
        "Wraps",
        mod?.name
          ? `${mod.name}${mod.builtAgainst ? ` ${mod.builtAgainst}` : ""}${mod.tier ? ` (${mod.tier})` : ""}`
          : undefined,
      ],
      [
        "Built against",
        `contract ${manifest.contractMajor}.${manifest.contractMinor}, api ${manifest.apiVersion}, ui-kit ${manifest.uiKitVersion}`,
      ],
    ]),
    ...wireSection(wire),
  ];

  if (inventory.widgets.length > 0) {
    out.push("## Widgets", "");
    for (const widget of inventory.widgets) {
      out.push(...widgetSection(inputs, widget), "");
    }
  }
  out.push(...augmentTable(inputs));
  out.push(...contributionTable(inputs));
  out.push(...modelTable(inputs));

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
