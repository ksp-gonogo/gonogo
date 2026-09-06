import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: `Panel` is the only door to its own parts.
 *
 * `Panel` is a compound component. `Panel.Container`, `.Header`, `.Toolbar`,
 * `.Footer`, `.Title`, `.Glow`, `.Body`, `.Split`, `.Sidebar`, `.StatusDot`,
 * `.Delay`, `.Context` and `.Providers` all hang off it, so a widget that needs
 * a variant hand-composes from there and every part it reaches is the same
 * object the panel itself renders.
 *
 * ui-kit's barrel ALSO exported thirteen of those parts bare, under their
 * declared names (`PanelBody`, `PanelContainer`, `PanelDelayRail`, ...), from
 * 2026-08-19 until this guard landed. Two problems, neither of them tidiness:
 *
 *   - ui-kit is the PUBLISHED package, so a bare part is public API to every
 *     Uplink. `PanelContainer` and `PanelBody` are plain `styled.div`, which
 *     means the bare export froze a DOM structure as a contract: the compound
 *     could not rearrange what it composes without breaking a consumer that
 *     never went through `Panel`.
 *   - A second access path to one object is how the parts drift out of step
 *     with the whole. The same merge that added these exports removed
 *     `PanelContainer`'s padding, and nothing connected the two.
 *
 * Removing capability is not the point; the ACCESS PATH is. A hand-composed
 * panel still reaches every piece, through `Panel.X`.
 *
 * Sibling guard, same failure one level up: `styleguide-duplicate-primitives`
 * exists because `Panel` itself was copied into ui-kit rather than aliased, and
 * the copies drifted across 29 widgets before anyone noticed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const PANEL_SRC = join(REPO, "packages/ui-kit/src/Panel.tsx");
const UI_KIT_BARREL = join(REPO, "packages/ui-kit/src/index.ts");

/** A name that declares itself a piece of Panel: `PanelBody`, `PanelDelayRail`. */
const PANEL_PART_NAME = /^Panel[A-Z]/;

/**
 * The values on the compound object, read out of the `Object.assign(PanelRoot,
 * { ... })` literal. Handles both `Key: Value,` and the shorthand `Value,`, and
 * returns the VALUE side: that is the declared name a bare export would use.
 */
function compoundValues(panelSource: string): string[] {
  const open = panelSource.indexOf("Object.assign(PanelRoot, {");
  if (open === -1) return [];
  const close = panelSource.indexOf("\n});", open);
  const body = panelSource.slice(open, close === -1 ? undefined : close);

  const found: string[] = [];
  for (const [, value] of body.matchAll(
    /^\s*(?:[A-Za-z0-9_]+\s*:\s*)?([A-Za-z0-9_]+)\s*,\s*$/gm,
  )) {
    found.push(value);
  }
  return found;
}

/**
 * The VALUE names an `export { ... }` list publishes, under the name a consumer
 * imports (so `A as B` yields `B`). Type-only entries are dropped: a props type
 * is not a way to render a part.
 */
function exportedValues(list: string): string[] {
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^type\s/.test(entry))
    .map((entry) => {
      const aliased = /\bas\s+([A-Za-z0-9_$]+)$/.exec(entry);
      return aliased?.[1] ?? entry;
    });
}

/** Every value name the barrel re-exports, from any module. */
function barrelValues(barrelSource: string): Set<string> {
  const found = new Set<string>();
  for (const [, list] of barrelSource.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const name of exportedValues(list)) found.add(name);
  }
  return found;
}

/** Just the `export { ... } from "./Panel"` lists. */
function panelModuleExports(barrelSource: string): string[] {
  const found: string[] = [];
  for (const [, list] of barrelSource.matchAll(
    /export\s*\{([^}]*)\}\s*from\s*["']\.\/Panel["']/g,
  )) {
    found.push(...exportedValues(list));
  }
  return found;
}

const PANEL_SOURCE = readFileSync(PANEL_SRC, "utf8");
const BARREL_SOURCE = readFileSync(UI_KIT_BARREL, "utf8");

describe("Panel is the only door to its parts", () => {
  it("still finds the compound object it is anchored on", () => {
    // A regex that stops matching yields an empty part list, an empty list
    // intersects nothing, and nothing reads as success. Fail on the signature
    // before trusting a pass.
    const values = compoundValues(PANEL_SOURCE);
    expect(
      values,
      `The Object.assign(PanelRoot, { ... }) literal in ${PANEL_SRC} no longer\n` +
        `parses. Fix the extraction before believing this file's green.`,
    ).toEqual(expect.arrayContaining(["PanelBody", "PanelContainer"]));
  });

  it("exports no part of the compound bare from the ui-kit barrel", () => {
    const published = barrelValues(BARREL_SOURCE);
    const offenders = compoundValues(PANEL_SOURCE)
      .filter((name) => PANEL_PART_NAME.test(name))
      .filter((name) => published.has(name))
      .sort();

    expect(
      offenders,
      `These are reachable from \`Panel\` AND exported bare by ui-kit:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nDelete the bare export. Every consumer reaches the same object\n` +
        `through \`Panel.X\`, which keeps the compound free to rearrange what it\n` +
        `composes. ui-kit is published, so a bare part is a DOM structure\n` +
        `promised to every Uplink.`,
    ).toEqual([]);
  });

  it("exports nothing Panel-named but `Panel` itself out of ./Panel", () => {
    // The check above is keyed on the compound, so it cannot see a part that
    // was never added to it. This one closes that: a `Panel*` value declared in
    // Panel.tsx belongs on the compound, not on the barrel.
    const offenders = panelModuleExports(BARREL_SOURCE)
      .filter((name) => name !== "Panel" && PANEL_PART_NAME.test(name))
      .sort();

    expect(
      offenders,
      `ui-kit's barrel publishes these straight out of ./Panel:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nA \`Panel\`-prefixed value names itself a part of Panel. Put it on the\n` +
        `compound in Panel.tsx and let consumers reach it as \`Panel.X\`.`,
    ).toEqual([]);
  });

  it("sees a violation when there is one", () => {
    // Both predicates, run against text that deliberately breaks them. A gate
    // that cannot go red reports zero, and zero reads as success.
    const plantedPanel = [
      "export const Panel = Object.assign(PanelRoot, {",
      "  Container: PanelContainer,",
      "  Body: PanelBody,",
      "  Section,",
      "});",
    ].join("\n");
    const plantedBarrel = [
      'export { Panel, PanelBody, type PanelProps, Section } from "./Panel";',
      'export { PanelContainer } from "./Panel/Container";',
    ].join("\n");

    const published = barrelValues(plantedBarrel);
    const bareParts = compoundValues(plantedPanel)
      .filter((name) => PANEL_PART_NAME.test(name))
      .filter((name) => published.has(name))
      .sort();
    expect(bareParts).toEqual(["PanelBody", "PanelContainer"]);

    const fromPanelModule = panelModuleExports(plantedBarrel)
      .filter((name) => name !== "Panel" && PANEL_PART_NAME.test(name))
      .sort();
    expect(fromPanelModule).toEqual(["PanelBody"]);

    // `Section` is on the compound and exported bare on purpose: it is a kit
    // primitive the compound aliases, not a Panel part, and its name says so.
    expect(bareParts).not.toContain("Section");
    // A props type is not a render path.
    expect(fromPanelModule).not.toContain("PanelProps");
  });
});
