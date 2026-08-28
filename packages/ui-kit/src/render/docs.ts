import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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
 * author's prose. Build it the other way round, as a doc generator that happens
 * to emit a manifest, and it drifts: a wrong manifest is parsed by the loader at
 * install time and fails visibly, whereas a wrong paragraph fails silently
 * forever.
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

/** The one authored file, split into a lede and per-registration sections. */
export interface Prose {
  lede: string;
  /** Keyed `widget:<id>` / `augment:<id>` / `contribution:<id>`. */
  sections: Map<string, string>;
}

const SECTION_RE = /^##\s+(widget|augment|contribution):(\S+)\s*$/;

export function parseProse(source: string): Prose {
  const lede: string[] = [];
  const sections = new Map<string, string>();
  let current: { key: string; lines: string[] } | undefined;
  const flush = () => {
    if (current) sections.set(current.key, current.lines.join("\n").trim());
    current = undefined;
  };
  for (const line of source.split(/\r?\n/)) {
    const match = SECTION_RE.exec(line);
    if (match) {
      flush();
      current = { key: `${match[1]}:${match[2]}`, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else lede.push(line);
  }
  flush();
  return { lede: lede.join("\n").trim(), sections };
}

/**
 * A section naming an id nothing registered fails the build.
 *
 * Prose about a widget that no longer exists is the drift this whole tool is
 * against, and it is the half a generator cannot notice on its own: the page just
 * stops carrying the paragraph and nobody looks for it.
 */
export function assertProseTargetsExist(
  prose: Prose,
  inventory: UplinkInventory,
): void {
  const known = new Set<string>([
    ...inventory.widgets.map((w) => `widget:${w.id}`),
    ...inventory.augments.map((a) => `augment:${a.id}`),
    ...inventory.contributions.map((c) => `contribution:${c.id}`),
  ]);
  const unknown = [...prose.sections.keys()].filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `uplink.md: ${unknown.length} section(s) name a registration that does ` +
        `not exist:\n  ${unknown.map((k) => `## ${k}`).join("\n  ")}\n` +
        `Registered: ${[...known].sort().join(", ")}`,
    );
  }
}

/** The lede's first paragraph, which is the Uplink's one-line description. */
function ledeSentence(lede: string): string | undefined {
  const body = lede.replace(/^#[^\n]*\n/, "").trim();
  if (body.length === 0) return undefined;
  const paragraph = body.split(/\n\s*\n/)[0];
  return paragraph.replace(/\s+/g, " ").trim();
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
  assets: RenderedAsset[];
  prose: Prose;
  /** Path, relative to the package, of the file distributed to users. */
  bundle?: string;
  /** Where assets live, relative to the package. */
  assetDir: string;
  /** `augment:<id>` / `contribution:<id>` with no scene, named on the page. */
  unpreviewed: string[];
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
      description: ledeSentence(inputs.prose.lede),
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

function list(items: readonly string[]): string {
  return items.length > 0 ? items.map((i) => `\`${i}\``).join(", ") : "none";
}

function assetsFor(
  inputs: DocsInputs,
  kind: string,
  id: string,
): RenderedAsset[] {
  return inputs.assets.filter(
    (a) => a.scene.target.kind === kind && a.scene.target.id === id,
  );
}

/**
 * The image block for one registration.
 *
 * Every image says which TIER produced it. A widget is mounted in the real
 * dashboard provider stack; an augment or contribution is mounted in a stand-in
 * `Panel`, because its host widget lives in a package an Uplink may not import. A
 * reader must never have to guess which of those they are looking at, and the
 * stand-in is visible in the render's own title bar as well as here.
 */
function images(inputs: DocsInputs, assets: RenderedAsset[]): string[] {
  const out: string[] = [];
  for (const asset of assets) {
    const caption = asset.scene.caption ?? asset.scene.name;
    const path = `${inputs.assetDir}/${asset.file}`;
    out.push("", `![${caption}](${path})`, "", `*${caption}*`);
    if (asset.scene.expectsEmpty) {
      out.push("", `> Empty by design: ${asset.scene.expectsEmpty}`);
    }
  }
  return out;
}

function widgetSection(inputs: DocsInputs, widget: InventoryWidget): string[] {
  const out = [`### ${widget.name}`, "", widget.description, ""];
  out.push(`- Widget id: \`${widget.id}\``);
  // `channels` when the widget declares them, `dataRequirements` otherwise: they
  // are two generations of the same declaration and a widget on the older one
  // still reads something, so quoting an empty `channels` would print "none"
  // about a widget with five topics.
  out.push(
    `- Needs: ${list(widget.channels.length > 0 ? widget.channels : widget.dataRequirements)}`,
  );
  if (widget.optionalChannels.length > 0) {
    out.push(`- Uses if present: ${list(widget.optionalChannels)}`);
  }
  if (widget.actions.length > 0) {
    out.push(
      `- Can be driven by: ${list(widget.actions.map((a) => a.id))} (serial input)`,
    );
  }
  if (widget.augmentSlots.length > 0) {
    out.push(`- Other mods may render into: ${list(widget.augmentSlots)}`);
  }
  if (widget.contributionSlots.length > 0) {
    out.push(
      `- Other mods may contribute data to: ${list(widget.contributionSlots)}`,
    );
  }
  if (widget.requires.length > 0) {
    out.push(`- Only live while present: ${list(widget.requires)}`);
  }
  if (widget.replaces) out.push(`- Replaces: \`${widget.replaces}\``);
  out.push(
    `- Default size: ${widget.modes[0].w} x ${widget.modes[0].h} grid units`,
  );
  const extra = inputs.prose.sections.get(`widget:${widget.id}`);
  if (extra) out.push("", extra);
  out.push(...images(inputs, assetsFor(inputs, "widget", widget.id)));
  return out;
}

function augmentSection(
  inputs: DocsInputs,
  augment: InventoryAugment,
): string[] {
  const out = [`### \`${augment.id}\` into \`${augment.augments}\``, ""];
  out.push(`- Reads: ${list(augment.channels)}`);
  if (augment.requires)
    out.push(`- Only while present: \`${augment.requires}\``);
  if (augment.suppressesVanillaBase) {
    out.push("- Suppresses the host's own default surface for that slot");
  }
  if (augment.settings.length > 0) {
    out.push(
      `- Adds settings to its host: ${list(augment.settings.map((s) => `${s.key} (${s.type})`))}`,
    );
  }
  const extra = inputs.prose.sections.get(`augment:${augment.id}`);
  if (extra) out.push("", extra);
  const shots = assetsFor(inputs, "augment", augment.id);
  out.push(
    "",
    shots.length > 0
      ? "> Rendered in a STAND-IN host panel: the real host widget ships with " +
          "the app and an Uplink may not import it, so the section's own layout " +
          "is faithful and how it sits under the host's rows is not shown."
      : "> No preview: no fixture names this augment. An augment that draws in " +
          "its host's own coordinate space (a map projection, an SVG transform) " +
          "cannot honestly be shown in a stand-in panel, which has nothing to " +
          "draw against; one that renders ordinary content can gain a preview " +
          "by adding a fixture.",
  );
  out.push(...images(inputs, shots));
  return out;
}

function contributionSection(
  inputs: DocsInputs,
  contribution: InventoryContribution,
): string[] {
  const out = [
    `### \`${contribution.id}\` into \`${contribution.contributes}\``,
    "",
  ];
  out.push(`- Computed from: ${list(contribution.deps)}`);
  if (contribution.requires) {
    out.push(`- Only while present: \`${contribution.requires}\``);
  }
  const extra = inputs.prose.sections.get(`contribution:${contribution.id}`);
  if (extra) out.push("", extra);
  out.push(
    ...images(inputs, assetsFor(inputs, "contribution", contribution.id)),
  );
  return out;
}

export function buildReadme(
  inputs: DocsInputs,
  manifest: UplinkManifestJson,
): string {
  const { inventory, prose } = inputs;
  const out: string[] = [
    "<!-- Generated by `gonogo-uplink docs`. Do not edit this file: edit",
    "     `uplink.md` for the prose, and the registrations for everything else. -->",
    "",
    `# ${inventory.name}`,
    "",
  ];
  if (prose.lede) out.push(prose.lede, "");
  out.push(
    "| | |",
    "| --- | --- |",
    `| Uplink id | \`${inventory.id}\` |`,
    `| Version | \`${inventory.version}\` |`,
    `| Built against | contract ${manifest.contractMajor}.${manifest.contractMinor}, api ${manifest.apiVersion}, ui-kit ${manifest.uiKitVersion} |`,
    "",
  );

  // Before the widgets, because the wire surface is what the Uplink IS. A widget
  // is one way of looking at it, and another mod may build a different one.
  const wire = readWireSurface(inputs.pkg.dir);
  out.push(...wireSection(wire));

  if (inventory.widgets.length > 0) {
    out.push("## Widgets", "");
    for (const widget of inventory.widgets) {
      out.push(...widgetSection(inputs, widget), "");
    }
  }
  if (inventory.augments.length > 0) {
    out.push("## Sections added to other widgets", "");
    for (const augment of inventory.augments) {
      out.push(...augmentSection(inputs, augment), "");
    }
  }
  if (inventory.contributions.length > 0) {
    out.push("## Data contributed to other widgets", "");
    for (const contribution of inventory.contributions) {
      out.push(...contributionSection(inputs, contribution), "");
    }
  }

  const slots = inventory.widgets.flatMap((w) => [
    ...w.augmentSlots.map((s) => ({ slot: s, kind: "section", host: w.name })),
    ...w.contributionSlots.map((s) => ({
      slot: s,
      kind: "data",
      host: w.name,
    })),
  ]);
  // Printed even when the table is empty, and that is the point. Every widget
  // gets the framework segments whether it asks for them or not, so a page that
  // showed nothing here would let a reader conclude that a widget declaring no
  // bespoke slot cannot be extended at all. They are named as UNIVERSAL rather
  // than listed per widget, because listing them would count generic surface as
  // this Uplink's own design.
  if (inventory.widgets.length > 0) {
    out.push("## What other mods can extend in this Uplink", "");
    if (slots.length > 0) {
      out.push(
        "Slots these widgets declare:",
        "",
        "| Slot | Kind | In |",
        "| --- | --- | --- |",
        ...slots.map((s) => `| \`${s.slot}\` | ${s.kind} | ${s.host} |`),
        "",
      );
    }
    out.push(
      `${slots.length > 0 ? "On top of those, every" : "Every"} widget above ` +
        "carries the framework's universal segments (`badges`, `filters`, " +
        "`meters`), so another mod can add a badge, a filter or a meter to any " +
        "of them without this Uplink declaring anything. They are not listed " +
        "per widget: they are the floor every widget stands on, not this " +
        "Uplink's own extension surface.",
      "",
    );
  }

  const models = [
    ...inventory.processors.map((id) => ({ what: "processor", id })),
    ...inventory.reckonedTopics.map((id) => ({ what: "forward model", id })),
    ...inventory.derivedChannels.map((id) => ({ what: "derived channel", id })),
  ];
  if (models.length > 0) {
    out.push(
      "## Models and derived data",
      "",
      ...models.map((m) => `- ${m.what}: \`${m.id}\``),
      "",
    );
  }

  out.push("## What this page cannot tell you", "");
  if (wire.payloads.length > 0) {
    const n = wire.payloads.length;
    out.push(
      `- which topic ${n === 1 ? "the shape" : `each of the ${n} shapes`} under`,
      '  "Command args, dynamic channels and extensions" travels on. A dynamic',
      "  namespace composes its topic per subject at runtime and an extensions",
      "  bag has no topic of its own, so there is no fixed name for the codegen",
      "  to reflect; the mod's own channel constants are where those strings live",
    );
  }
  if (wire.present) {
    out.push(
      "- which commands the Uplink accepts, and each one's DELAY ROLE. Both are",
      "  declared where the mod registers them rather than as an attribute on a",
      "  payload, and the client sends a command by naming it at the call site,",
      "  so neither half of the build can enumerate them",
    );
  }
  out.push(
    "- capabilities the mod half declares, which are registered imperatively",
    "  rather than as a field, so nothing can enumerate them",
    "- what a widget DOES, as opposed to what it reads. That is the one thing",
    "  only its author can write, and `uplink.md` is where it goes",
    "",
  );
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
