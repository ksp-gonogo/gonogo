import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildUplinkManifest,
  NO_BUNDLE_INTEGRITY_WARNING,
  readUplinkDeclaration,
  type UplinkDeclaration,
  type UplinkManifest,
} from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import type {
  InventoryAugment,
  InventoryContribution,
  InventoryWidget,
  UplinkInventory,
} from "../render-probe";
import type { UplinkPackage } from "./context";
import type { RenderedAsset } from "./driver";
import type { Scene } from "./scenes";
import { commandSection, readWireSurface, wireSection } from "./wire";

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

/**
 * The manifest's shape is `@ksp-gonogo/sitrep-sdk`'s, and so is the code that
 * builds it.
 *
 * `docs` used to declare a rival nine-field shape here while `gonogo-uplink
 * bundle` wrote thirteen fields under the same filename, and nothing said which
 * one the loader honours. Both now call one writer, so an author who runs either
 * command gets the same file.
 */
export type UplinkManifestJson = UplinkManifest;

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
    return { integrity: "", warning: NO_BUNDLE_INTEGRITY_WARNING };
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
type DeclaredMod = NonNullable<UplinkDeclaration["mod"]>;

/**
 * What `uplink.json` says this Uplink wraps, or nothing.
 *
 * The file is found by the sdk's own search, so the declaration this page prints
 * from is the one the manifest was built from. Absent is normal: an Uplink
 * bundled inside the app's own repo has no separate declaration, and the page
 * omits the row it would have filled rather than inventing one.
 */
function declaredMod(pkgDir: string): DeclaredMod | undefined {
  return readUplinkDeclaration(pkgDir)?.declared.mod ?? undefined;
}

/**
 * The manifest, through the sdk's writer, with the compat numbers read out of
 * the bundle rather than out of whichever packages this tool resolved.
 *
 * Everything else, `uplink.json` and the client's `package.json` included, the
 * writer reads for itself, so `gonogo-uplink bundle` reaches the same answers
 * from the same files.
 */
export function buildManifest(inputs: DocsInputs): {
  manifest: UplinkManifestJson;
  warning?: string;
} {
  const { integrity, warning } = bundleIntegrity(inputs.pkg, inputs.bundle);
  return {
    manifest: buildUplinkManifest({
      clientDir: inputs.pkg.dir,
      registered: {
        id: inputs.inventory.id,
        name: inputs.inventory.name,
        version: inputs.inventory.version,
        description: inputs.inventory.description,
      },
      compat: inputs.inventory.compat,
      integrity,
    }),
    warning,
  };
}

/**
 * The first line of every generated `README.md`, and the thing `docs` looks for
 * before it overwrites one.
 *
 * `docs` writes the README from the registrations, so overwriting the one it
 * wrote last time is the whole job. Overwriting a README a person WROTE is not,
 * and the two are indistinguishable to a `writeFile`: an author who ran the
 * command in a package that already had a hand-written readme lost it, with no
 * warning and no recovery outside git. The marker is what tells them apart, so
 * it is a constant rather than a line in a template.
 */
export const README_GENERATED_MARKER =
  "<!-- Generated by `gonogo-uplink docs`.";

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

/**
 * The SCENES declared for one registration, as distinct from the ASSETS rendered
 * from them.
 *
 * <p>One scene becomes several assets (one per size), so counting assets answers
 * "how many pictures" and counting scenes answers "how many STATES somebody
 * thought worth showing". The second is the question review needs.</p>
 */
function scenesFor(inputs: DocsInputs, kind: string, id: string): Scene[] {
  return inputs.scenes.filter(
    (scene) => scene.target.kind === kind && scene.target.id === id,
  );
}

/**
 * Scenes that assert nothing, which are pictures nobody has read.
 *
 * <p>A WARNING rather than a failure: a scene with no `paints` still renders and
 * still gets looked at. But `paints` is what caught RP-1's efficiency bug (a
 * string that was expected and did not appear), and a scene without any is one
 * where nobody wrote down what the render should say.</p>
 */
export function scenesAssertingNothing(inputs: DocsInputs): string[] {
  return inputs.scenes
    .filter((scene) => scene.paints.length === 0)
    .map((scene) => `${scene.target.id} / ${scene.name}`);
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
      // How many STATES somebody thought worth showing, not how many pictures.
      // A widget with three warning states and one scene is the shape that hides
      // a finding, and this is what makes that visible in review.
      ["Scenes", String(scenesFor(inputs, "widget", widget.id).length)],
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
      String(scenesFor(inputs, "augment", augment.id).length),
      notes.join("; "),
    ];
  });
  if (rows.length === 0) return [];
  return [
    "## Augments",
    "",
    ...table(["Augment", "Into", "Reads", "Presence", "Scenes", "Notes"], rows),
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
        '  defineUplinkClient({ id, version, name, description: "..." })\n\n' +
        "It is a field rather than a prose file on purpose. Everything else on " +
        "the page comes from your registrations, your contract slice and your " +
        "fixtures, so this is the only sentence anyone writes.",
    );
  }

  const wire = readWireSurface(inputs.pkg.dir);
  const mod = declaredMod(inputs.pkg.dir);
  const out: string[] = [
    `${README_GENERATED_MARKER} Do not edit this file: it is written`,
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
    ...commandSection(wire),
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
