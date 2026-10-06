import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { compilerOptions } from "./published-entry-points";

/**
 * The scans behind `styleguide-widget-slots.test.ts`: a core widget names the
 * same slots in its registration as the sdk's slot registries declare for it,
 * and no slot is declared both in the sdk and again in `packages/components`.
 *
 * The Uplink README lists a widget's slots from its registration and the
 * reference site lists them from the registries, so the two must agree for
 * both pages to describe one widget.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SDK_DIR = "mod/sitrep-sdk";
const COMPONENTS_SRC = "packages/components/src";

/** The registries a slot id can be declared in. */
export type RegistryName =
  | "SlotRegistry"
  | "ContributionRegistry"
  | "WidgetScopeRegistry";

const REGISTRIES: readonly RegistryName[] = [
  "SlotRegistry",
  "ContributionRegistry",
  "WidgetScopeRegistry",
];

/** Every key of each registry, as the published sdk declares them. */
export type RegistryKeys = Record<RegistryName, ReadonlySet<string>>;

/** One widget's slots, as its `registerComponent` call names them. */
export interface WidgetSlots {
  id: string;
  file: string;
  augmentSlots: readonly string[];
  contributionSlots: readonly string[];
}

/** Reads the sdk's registries through the type checker, so every merged declaration counts. */
export function sdkRegistryKeys(root = REPO_ROOT): RegistryKeys {
  const program = ts.createProgram(
    [join(root, SDK_DIR, "src/index.ts")],
    compilerOptions(SDK_DIR, root),
  );
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(join(root, SDK_DIR, "src/index.ts"));
  if (!entry) throw new Error("the sdk program has no src/index.ts");
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) throw new Error("the sdk entry has no module symbol");
  const exports = new Map(
    checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s]),
  );
  const keysOf = (name: RegistryName): ReadonlySet<string> => {
    const exported = exports.get(name);
    if (!exported) throw new Error(`the sdk does not export ${name}`);
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    return new Set(checker.getPropertiesOfType(type).map((p) => p.name));
  };
  return {
    SlotRegistry: keysOf("SlotRegistry"),
    ContributionRegistry: keysOf("ContributionRegistry"),
    WidgetScopeRegistry: keysOf("WidgetScopeRegistry"),
  };
}

function trackedComponentFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", COMPONENTS_SRC], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test(-d)?\.tsx?$/.test(f));
}

/** The text between the brace at `open` and its match. */
function braced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") depth++;
    if (text[i] === "}" || text[i] === "]") depth--;
    if (depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/**
 * The slot ids each `registerComponent` call in `files` names. An array
 * element is a string literal, or a constant declared with one somewhere in
 * the same files; anything else throws, so a slot list the scan cannot read is
 * a failure rather than a silent empty one.
 */
export function widgetSlotsOf(
  files: readonly { path: string; text: string }[],
): WidgetSlots[] {
  const constants = new Map<string, string>();
  for (const { text } of files) {
    for (const m of text.matchAll(
      /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g,
    )) {
      constants.set(m[1], m[2]);
    }
  }
  const resolve = (element: string, file: string): string => {
    const literal = element.match(/^"([^"]+)"$/);
    if (literal) return literal[1];
    const named = constants.get(element);
    if (named !== undefined) return named;
    throw new Error(`${file}: cannot read slot "${element}"`);
  };
  const listOf = (body: string, key: string, file: string): string[] => {
    const at = body.search(new RegExp(`\\b${key}\\s*:\\s*\\[`));
    if (at === -1) return [];
    const open = body.indexOf("[", at);
    return braced(body, open)
      .split(",")
      .map((e) => e.replace(/\/\/[^\n]*/g, "").trim())
      .filter((e) => e.length > 0)
      .map((e) => resolve(e, file));
  };
  const widgets: WidgetSlots[] = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/registerComponent(?:<[^>]*>)?\(\s*\{/g)) {
      const body = braced(text, (m.index ?? 0) + m[0].length - 1);
      const id = body.match(/^\s*id:\s*"([^"]+)"/m)?.[1];
      if (id === undefined)
        throw new Error(`${path}: a registration with no literal id`);
      widgets.push({
        id,
        file: path,
        augmentSlots: listOf(body, "augmentSlots", path),
        contributionSlots: listOf(body, "contributionSlots", path),
      });
    }
  }
  return widgets;
}

/** Every core widget's slots, from `packages/components`. */
export function coreWidgetSlots(root = REPO_ROOT): WidgetSlots[] {
  const files = trackedComponentFiles(root).map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
  return widgetSlotsOf(files);
}

/**
 * Where a widget's registration and the registries disagree: a slot the
 * registration names that its registry does not declare, and a registry key
 * with the widget's prefix that the registration does not name.
 */
export function slotDrift(
  widgets: readonly WidgetSlots[],
  keys: RegistryKeys,
): string[] {
  const faults: string[] = [];
  for (const w of widgets) {
    const named = new Set([...w.augmentSlots, ...w.contributionSlots]);
    for (const slot of w.augmentSlots) {
      if (!keys.SlotRegistry.has(slot)) {
        faults.push(
          `${w.id}: augmentSlots names "${slot}", which SlotRegistry does not declare`,
        );
      }
    }
    for (const slot of w.contributionSlots) {
      if (!keys.ContributionRegistry.has(slot)) {
        faults.push(
          `${w.id}: contributionSlots names "${slot}", which ContributionRegistry does not declare`,
        );
      }
    }
    for (const registry of ["SlotRegistry", "ContributionRegistry"] as const) {
      for (const key of keys[registry]) {
        if (key.startsWith(`${w.id}.`) && !named.has(key)) {
          faults.push(
            `${w.id}: ${registry} declares "${key}", which the registration does not name`,
          );
        }
      }
    }
  }
  return faults;
}

/** One registry key a `packages/components` file declares again. */
export interface DuplicateDeclaration {
  file: string;
  registry: RegistryName;
  key: string;
}

/**
 * Every key a `declare module` block in `files` adds to a registry the sdk
 * already declares it in.
 */
export function duplicateDeclarations(
  files: readonly { path: string; text: string }[],
  keys: RegistryKeys,
): DuplicateDeclaration[] {
  const found: DuplicateDeclaration[] = [];
  for (const { path, text } of files) {
    for (const block of text.matchAll(
      /declare module "@ksp-gonogo\/(?:core|sitrep-sdk|ui-kit)"\s*\{/g,
    )) {
      const body = braced(text, (block.index ?? 0) + block[0].length - 1);
      for (const iface of body.matchAll(/interface\s+(\w+)\s*\{/g)) {
        const registry = REGISTRIES.find((r) => r === iface[1]);
        if (!registry) continue;
        const members = braced(body, (iface.index ?? 0) + iface[0].length - 1);
        for (const key of members.matchAll(/^\s*"?([\w.-]+)"?\??\s*:/gm)) {
          if (keys[registry].has(key[1])) {
            found.push({ file: path, registry, key: key[1] });
          }
        }
      }
    }
  }
  return found;
}

/** Every registry key `packages/components` declares again, in the tree. */
export function coreDuplicateDeclarations(
  keys: RegistryKeys,
  root = REPO_ROOT,
): DuplicateDeclaration[] {
  const files = trackedComponentFiles(root).map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
  return duplicateDeclarations(files, keys);
}

/** A planted registry, for the scans to prove they can see a fault. */
export const PLANTED_KEYS: RegistryKeys = {
  SlotRegistry: new Set(["planted.declared", "planted.both"]),
  ContributionRegistry: new Set(["planted.feed", "plots"]),
  WidgetScopeRegistry: new Set(["planted"]),
};
