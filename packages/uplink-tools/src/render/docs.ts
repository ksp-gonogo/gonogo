import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
  InventoryErrorCode,
  UplinkInventory,
} from "../render-probe";
import { widgetFactsOf, widgetFactValueMd } from "../widget-facts";
import type { UplinkPackage } from "./context";
import type { RenderedAsset } from "./driver";
import type { Scene } from "./scenes";
import type { WidgetRecord } from "./widgetRecord";
import { commandSection, readWireSurface, wireSection } from "./wire";

/**
 * What the page generator needs of an asset: a filename and a size, without the
 * rendered `shape`. `page-check.ts` builds this list from the scenes alone, with
 * no browser and so no rendered files, to compare the page's markdown against
 * the code.
 */
export type PageAsset = Omit<RenderedAsset, "shape">;

/**
 * The assets a render of these scenes writes, named from the scenes alone.
 *
 * The page links images by filename, so the prose can be built without a render
 * as long as the names come out as the renderer's would. The rule mirrors
 * `renderOneScene`: a motion scene records its first size as a GIF, and every
 * other size of any scene is a still.
 */
export function linkedAssets(scenes: readonly Scene[]): PageAsset[] {
  return scenes.flatMap((scene) =>
    scene.modes.map((mode, index): PageAsset => {
      const motion = scene.steps !== undefined && scene.steps.length > 0;
      const kind = motion && index === 0 ? "motion" : "still";
      const ext = kind === "motion" ? "gif" : "png";
      return {
        scene,
        mode: mode.name,
        file: `${scene.name}--${mode.name}.${ext}`,
        kind,
      };
    }),
  );
}

/** The `integrity` the manifest on disk already carries, or the empty claim. */
export function committedIntegrity(manifestPath: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const integrity: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "integrity")
        : undefined;
    if (typeof integrity === "string") return integrity;
  } catch {
    // No manifest yet, or one nothing can parse. Either way there is no hash to keep, and the caller is about to write a whole new file over it.
  }
  return "";
}

/*
 * The manifest first, the page from it.
 *
 * The manifest is the primary output and the README is that manifest plus the
 * Uplink's own declared description. A wrong manifest is parsed by the loader
 * at install time and fails visibly, whereas a wrong paragraph fails silently,
 * so the page is built from the manifest and not the other way round.
 *
 * The page holds the Uplink's description, each widget's own registered
 * description, data in tables, and the screenshots. It leaves out what
 * duplicates a registration (a rationale paragraph per widget), what belongs in
 * the Uplink documentation once (presence-gating, the universal `badges`,
 * `filters` and `meters` segments), repeated boilerplate about missing
 * previews, a closing section of what the page could not say, and an image's
 * alt text repeated as a caption.
 *
 * A reader should be able to skim the whole page in under a minute and come
 * away with what the Uplink does, what its widgets show, and what it puts on
 * the wire. Anything that repeats per item is a table, not a section.
 */

/**
 * The Uplink's `gonogo-uplink.json`: its id, version, compat numbers, bundle
 * integrity and widget list, in the shape `@ksp-gonogo/sitrep-sdk` defines.
 * Useful for telling the app which Gonogo releases an Uplink works with and
 * which bundle file to fetch. Written by `uplink-tools docs`, `page` and
 * `bundle`, which all call the same writer, and returned by {@link buildManifest}.
 *
 * @category Uplink page
 */
export type UplinkManifestJson = UplinkManifest;

/**
 * The sha256 of the file the author distributes, and only when they name it.
 *
 * There is no fallback to hashing `dist/index.js`: that file is a `tsc` output,
 * not the bundle anyone ships, and as a gitignored build artifact it would make
 * `--check` compare a committed hash against whatever the last local build
 * produced.
 *
 * With no `--bundle` no new integrity is computed. A hash already in the manifest stays
 * there: it was stamped from a bundle by an earlier `--bundle` run, and writing
 * the page again must not blank it, since an empty one is refused by the app.
 * Only a manifest with no hash at all draws the warning saying what that costs.
 */
function bundleIntegrity(
  pkg: UplinkPackage,
  bundle: string | undefined,
): { integrity: string; warning?: string } {
  if (!bundle) {
    const kept = committedIntegrity(join(pkg.dir, "gonogo-uplink.json"));
    return kept
      ? { integrity: kept }
      : { integrity: "", warning: NO_BUNDLE_INTEGRITY_WARNING };
  }
  const candidate = resolve(pkg.dir, bundle);
  try {
    statSync(candidate);
  } catch {
    throw new Error(
      `uplink-tools: --bundle ${bundle} does not exist (looked at ` +
        `${candidate}). Naming a bundle and getting no hash would be worse ` +
        "than naming none.",
    );
  }
  const bytes = readFileSync(candidate);
  return {
    integrity: `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

/**
 * What `buildReadme` and `buildManifest` build the page from: the Uplink package,
 * its inventory, its scenes, the pictures drawn for them and where they live.
 * Useful for generating an Uplink's page without a browser, by passing the
 * scenes with no rendered pictures. Used by the renderer behind
 * `uplink-tools docs` and by the page check.
 *
 * @category Uplink page
 */
export interface DocsInputs {
  /** The Uplink package. */
  pkg: UplinkPackage;
  /** What its client registers. */
  inventory: UplinkInventory;
  /** The scenes its fixtures define. */
  scenes: Scene[];
  /** The pictures drawn for them. */
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
 * Builds the Uplink's manifest with the sdk's manifest writer, with the compat
 * numbers read from the bundle itself, and returns it with a warning when no
 * bundle integrity is available. Useful for generating the manifest an app
 * checks before it loads the Uplink. Used by `uplink-tools docs`, `page` and
 * `bundle`, which build the same manifest from the same files.
 *
 * @category Uplink page
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
 * The first line of every generated `README.md`, and the thing `docs` and `page`
 * look for before they overwrite one. It names both because either writes it.
 * It tells a generated README, which may be overwritten, from one an author
 * wrote, which may not.
 */
export const README_GENERATED_MARKER =
  "<!-- Generated by `uplink-tools docs` or `uplink-tools page`.";

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
 * The scene's caption goes in the alt, where a screen reader and a
 * broken-image placeholder both find it.
 *
 * A picture that has not been drawn is left out. `page` writes this text with
 * no browser, so an Uplink that has never run `docs` has no pictures yet, and a
 * link to one would be a broken image on the page's first day. `docs` draws
 * them before it writes the page, so there they are always found.
 */
export function imageLinks(
  pkgDir: string,
  assetDir: string,
  assets: readonly PageAsset[],
): string[] {
  const out: string[] = [];
  for (const asset of assets) {
    const path = `${assetDir}/${asset.file}`;
    if (!existsSync(join(pkgDir, path))) continue;
    out.push("", `![${altFor(asset)}](${path})`);
  }
  return out;
}

function altFor(asset: PageAsset): string {
  return asset.scene.caption ?? asset.scene.name;
}

/**
 * The page's picture(s) of one registration: every `hero` scene, at its own
 * first mode.
 *
 * A scene's first mode is the one `linkedAssets` records a motion scene's GIF
 * under, so taking it here is what keeps a hero'd motion scene's picture a
 * film rather than the still of some other mode.
 *
 * Throws when a target has scenes and no hero among them, since the author has
 * not yet chosen how to picture it; no fixture is picked by default.
 */
function heroAssetsFor(
  inputs: DocsInputs,
  kind: string,
  id: string,
): readonly PageAsset[] {
  const scenes = scenesFor(inputs, kind, id);
  if (scenes.length === 0) return [];
  const heroes = new Set(
    scenes.filter((scene) => scene.hero).map((scene) => scene.name),
  );
  if (heroes.size === 0) {
    throw new Error(
      `uplink-tools docs: ${kind} "${id}" has ${scenes.length} scene(s) and ` +
        'none is marked "_scene.hero": true, so the page has no picture to ' +
        `show for it:\n  ${scenes.map((s) => s.file).join("\n  ")}\n\n` +
        'Mark at least one fixture\'s "_scene" block with "hero": true. Any ' +
        "number may carry it; every one that does is shown.",
    );
  }
  return inputs.assets.filter(
    (a) =>
      a.scene.target.kind === kind &&
      a.scene.target.id === id &&
      heroes.has(a.scene.name) &&
      a.mode === a.scene.modes[0].name,
  );
}

/**
 * The scenes declared for one registration, as distinct from the assets rendered
 * from them. One scene becomes several assets (one per size), so counting scenes
 * gives the number of states shown and counting assets the number of pictures.
 */
function scenesFor(inputs: DocsInputs, kind: string, id: string): Scene[] {
  return inputs.scenes.filter(
    (scene) => scene.target.kind === kind && scene.target.id === id,
  );
}

/**
 * Scenes that assert nothing: those with no `paints`. This is a warning and not a
 * failure, since such a scene still renders, but `paints` is what catches an
 * expected string that does not appear.
 */
export function scenesAssertingNothing(inputs: DocsInputs): string[] {
  return inputs.scenes
    .filter((scene) => scene.paints.length === 0)
    .map((scene) => `${scene.target.id} / ${scene.name}`);
}

/**
 * The Uplink's widgets as {@link WidgetRecord}s, without the harness's own
 * fields such as render sizes. Useful for describing the Uplink's widgets to a
 * reader. Used to build the README's widget sections and `docs/widgets.json`,
 * which both come from this list.
 *
 * @category Uplink page
 */
export function widgetRecordsOf(inventory: UplinkInventory): WidgetRecord[] {
  return inventory.widgets.map(({ modes: _m, ...record }) => record);
}

// Takes the record, never the inventory entry, so nothing reaches a widget's section that `docs/widgets.json` does not also carry.
function widgetSection(inputs: DocsInputs, widget: WidgetRecord): string[] {
  const out = [`### ${widget.name}`, "", widget.description, ""];
  out.push(
    ...facts([
      ...widgetFactsOf(widget).map((fact): [string, string] => [
        fact.label,
        widgetFactValueMd(fact.items),
      ]),
      // How many STATES somebody thought worth showing, not how many pictures.
      // A widget with three warning states and one scene is the shape that hides
      // a finding, and this is what makes that visible in review.
      ["Scenes", String(scenesFor(inputs, "widget", widget.id).length)],
    ]),
  );
  out.push(
    ...imageLinks(
      inputs.pkg.dir,
      inputs.assetDir,
      heroAssetsFor(inputs, "widget", widget.id),
    ),
  );
  return out;
}

/**
 * Every augment in one table, with its images after it, so a reader can compare
 * which host widgets this Uplink reaches into.
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
      imageLinks(
        inputs.pkg.dir,
        inputs.assetDir,
        heroAssetsFor(inputs, "augment", augment.id),
      ),
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
      imageLinks(
        inputs.pkg.dir,
        inputs.assetDir,
        heroAssetsFor(inputs, "contribution", contribution.id),
      ),
    ),
    "",
  ];
}

/**
 * The refusal refinements this Uplink answers with, each under the core code a
 * client classifies it by. Absent when the Uplink declares none.
 */
function errorCodeTable(inputs: DocsInputs): string[] {
  return errorCodeSection(inputs.inventory.errorCodes ?? []);
}

/** The "Error codes" section for a list of refinements, or nothing for none. */
export function errorCodeSection(
  codes: readonly InventoryErrorCode[],
): string[] {
  const rows = codes.map((code) => [
    `\`${code.id}\``,
    code.refines ? `\`${code.refines}\`` : "",
    code.sentence,
    code.meaning.replace(/\s+/g, " ").trim(),
  ]);
  if (rows.length === 0) return [];
  return [
    "## Error codes",
    "",
    ...table(["Code", "Refines", "Reads as", "Meaning"], rows),
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
  return [
    "## Models",
    "",
    ...table(["Kind", "Id"], rows),
    ...inputRuleExemptions(inputs),
  ];
}

/**
 * The input rules this Uplink's models opted out of, under the same heading the
 * models themselves are listed under.
 *
 * Absent when there are none: the store holds every model to a reach no further
 * than its inputs and a band no wider than its inputs warrant, so a page with no
 * such table has models that take both defaults.
 */
function inputRuleExemptions(inputs: DocsInputs): string[] {
  const rows = inputs.inventory.reckonerExemptions.map((exemption) => [
    `\`${exemption.topic}\``,
    exemption.rule,
    exemption.reason,
  ]);
  if (rows.length === 0) return [];
  return [
    "",
    "### Input rules these models opt out of",
    "",
    ...table(["Topic", "Rule", "Why it is sound"], rows),
  ];
}

/**
 * The Uplink's generated page as markdown, built from its description, widgets,
 * augments, contributions, channels and error codes. Throws when the client
 * declares no `description`, which opens the page, or a widget registers none.
 * Useful for keeping an Uplink's README current with what its client registers.
 * Used by `uplink-tools docs` and `page` and by the page check.
 *
 * @category Uplink page
 * @categoryDescription Uplink page
 * The page an Uplink publishes about itself: its README, the manifest beside
 * its bundle, its widget records, and the channels and payloads it puts on the
 * wire, all generated from the code.
 */
export function buildReadme(
  inputs: DocsInputs,
  manifest: UplinkManifestJson,
): string {
  const { inventory } = inputs;
  if (!inventory.description?.trim()) {
    throw new Error(
      "uplink-tools docs: this client declares no `description`, and the page " +
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
        `contract ${manifest.contractMajor}.${manifest.contractMinor}, extension API ${manifest.apiVersion}`,
      ],
    ]),
    ...wireSection(wire),
    ...commandSection(wire),
  ];

  const records = widgetRecordsOf(inventory);
  const undescribed = records.filter((widget) => !widget.description?.trim());
  if (undescribed.length > 0) {
    throw new Error(
      `uplink-tools docs: ${undescribed.map((widget) => `\`${widget.id}\``).join(", ")} ` +
        `register${undescribed.length === 1 ? "s" : ""} no \`description\`, and it is the one ` +
        "sentence the page and the widget picker have for a widget.\n\n" +
        "Add one where the widget is registered, in plain words: what it shows " +
        "and what an operator can do with it.\n" +
        '  registerComponent({ id, name, description: "...", ... })',
    );
  }
  if (records.length > 0) {
    out.push("## Widgets", "");
    for (const widget of records) {
      out.push(...widgetSection(inputs, widget), "");
    }
  }
  out.push(...augmentTable(inputs));
  out.push(...contributionTable(inputs));
  out.push(...modelTable(inputs));
  out.push(...errorCodeTable(inputs));

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
