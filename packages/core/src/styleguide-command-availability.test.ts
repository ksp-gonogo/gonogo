// @vitest-environment node
//
// esbuild's `transformSync`, used to strip comments below, throws "JavaScript
// environment is broken" under jsdom. Nothing in this file touches the DOM.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * A widget does not decide whether a command is available.
 *
 * A command's own declaration carries what it needs (its scene, its facility
 * limits, its flags), the mod evaluates that before anyone presses, and
 * `useCommand` refuses locally on the verdict. `CommandButton` and every
 * `useCommandButton` chrome then draw the control dark with the command's own
 * sentence. A widget that also passes `disabled`, `enabled` or `aria-disabled`
 * to a command control has made a second, private decision about the same
 * command, and the two drift: a scene gate outlived the backend that needed it
 * and kept upgrades dark in scenes where the game accepts them.
 *
 * ## The rule
 *
 * 1. A JSX element that carries a command (a `handle` prop, a prop named
 *    `*Cmd` or `*Command`, or an `onClick` that calls `.send(`) takes no
 *    `disabled`, `enabled` or `aria-disabled` prop.
 * 2. A file that calls `useCommandButton` sets `disabled` / `aria-disabled`
 *    only from the hook's own phases (`isPending`, `isBlocked`) or as a bare
 *    literal, never from a condition of its own.
 *
 * ## What it cannot see
 *
 * A raw button whose `onClick` calls a callback prop that sends somewhere
 * else, rather than `.send(` in place: the command is not visible at the tag.
 */

/** The widget roots: the mechanism itself lives in ui-kit and the sdk and is not a widget. */
const WIDGET_ROOT =
  /^(packages\/(app|components)\/src|mod\/[^/]+\/client\/src)$/;

const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

/** Props that decide availability. */
const AVAILABILITY_PROPS = new Set(["disabled", "enabled", "aria-disabled"]);

/** The hook's own phases, the only sources rule 2 accepts. */
const HOOK_PHASES = /\b(isPending|isBlocked)\b/;

/**
 * Widget-side availability decisions that remain, each with why it has not
 * moved onto the command's declaration. Keyed `file :: element`. Shrink-only:
 * an entry that no longer matches fails, so it cannot stand as an excuse for
 * the next one.
 */
const AVAILABILITY_DEBT: Record<string, string> = {
  "packages/components/src/SpaceCenterStatus/FacilityCell.tsx :: UpgradeButton":
    "Per-facility affordability: the gate report carries one argument-free verdict per command, so a price that depends on which facility cannot be declared yet",
  "packages/components/src/SpaceCenterStatus/UpgradeButton.tsx :: UpgradeButtonStyled":
    "Draws FacilityCell's per-facility affordability verdict, above",
  "packages/components/src/TechTree/NodeRow.tsx :: CommandButton":
    "Per-node science affordability, argument-dependent like the facility price",
  "packages/components/src/TechTree/DetailPanel.tsx :: CommandButton":
    "Per-node science affordability, argument-dependent like the facility price",
  "packages/components/src/Strategies/AvailableRow.tsx :: CommandButton":
    "Per-strategy CanBeActivated and a per-factor cost, argument-dependent",
  "packages/components/src/Strategies/ScreenSections.tsx :: CommandButton":
    "Per-strategy CanBeDeactivated, argument-dependent",
  "packages/components/src/ContractManager/ContractManagerView.tsx :: CommandButton":
    "A held contract board: the offer the arguments name may be gone, which no argument-free verdict can say",
  "packages/components/src/Experiments/ScienceExperimentRow.tsx :: CommandButton":
    "A held instrument list: the part the arguments name may have changed, argument-dependent",
  "packages/components/src/FleetReliability/RepairControl.tsx :: CommandButton":
    "Per-part crew skill and spares, from a reliability backend that declares no gates",
  "packages/components/src/Navball/index.tsx :: ControlSurface":
    "Controllability is argument-free but rides control streams as well as buttons; the vessel Uplink declares no gate and the stream path does not read one",
};

const MINIMUM_FILES = 250;

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
}

/** Comments removed, JSX preserved, so a prop written about in prose is not a prop. */
function stripComments(source: string, path: string): string {
  return transformSync(source, {
    loader: path.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    jsx: "preserve",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code;
}

interface Tag {
  name: string;
  /** Top-level props, with the source text of each value (empty for a bare prop). */
  props: Map<string, string>;
}

/**
 * Reads a balanced `{...}` or quoted value starting at `i`, returning the index
 * after it. Strings inside braces are skipped so a `}` in a string cannot close
 * the expression early.
 */
function skipValue(src: string, i: number): number {
  const open = src[i];
  if (open === '"' || open === "'") {
    const close = src.indexOf(open, i + 1);
    return close < 0 ? src.length : close + 1;
  }
  if (open !== "{") return i;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      const close = src.indexOf(c, j + 1);
      j = close < 0 ? src.length : close;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return src.length;
}

/** Every JSX opening tag of a capitalised or lower-case element, with its top-level props. */
function jsxTags(src: string): Tag[] {
  const tags: Tag[] = [];
  const opener = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    const props = new Map<string, string>();
    let i = m.index + m[0].length;
    while (i < src.length) {
      const c = src[i];
      if (c === ">" || (c === "/" && src[i + 1] === ">")) break;
      if (c === "{") {
        i = skipValue(src, i);
        continue;
      }
      const attr = /^[A-Za-z_$][\w$:-]*/.exec(src.slice(i));
      if (!attr) {
        i++;
        continue;
      }
      i += attr[0].length;
      if (src[i] !== "=") {
        props.set(attr[0], "");
        continue;
      }
      const end = skipValue(src, i + 1);
      props.set(attr[0], src.slice(i + 1, end));
      i = end;
    }
    tags.push({ name: m[1], props });
  }
  return tags;
}

function carriesCommand(tag: Tag): boolean {
  for (const [name, value] of tag.props) {
    if (name === "handle" || /(Cmd|Command)$/.test(name)) return true;
    if (name === "onClick" && /\.send\(/.test(value)) return true;
  }
  return false;
}

/** A bare prop or a string literal, which states a fixed rendering rather than deciding anything. */
function isLiteral(value: string): boolean {
  return (
    value === "" ||
    /^["']/.test(value) ||
    /^\{\s*(true|false)\s*\}$/.test(value)
  );
}

/** The offending elements in one file's source, as `name` strings. */
function offenders(raw: string, path: string): string[] {
  const src = stripComments(raw, path);
  const hookCaller = /\buseCommandButton\b/.test(src);
  const found: string[] = [];
  for (const tag of jsxTags(src)) {
    const decided = [...tag.props].filter(([name]) =>
      AVAILABILITY_PROPS.has(name),
    );
    if (decided.length === 0) continue;
    if (carriesCommand(tag)) {
      found.push(tag.name);
      continue;
    }
    if (!hookCaller) continue;
    const ownCondition = decided.some(
      ([, value]) => !isLiteral(value) && !HOOK_PHASES.test(value),
    );
    if (ownCondition) found.push(tag.name);
  }
  return found;
}

interface Walk {
  perRoot: Map<string, number>;
  filesWalked: number;
  found: Set<string>;
  unparseable: string[];
}

function walk(root: string): Walk {
  const perRoot = new Map<string, number>();
  const found = new Set<string>();
  const unparseable: string[] = [];
  let filesWalked = 0;
  for (const rel of styleguideScanRoots(root).filter((r) =>
    WIDGET_ROOT.test(r),
  )) {
    const listed = execFileSync("git", ["ls-files", rel], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx$/.test(f) && !EXCLUDED.test(f));
    perRoot.set(rel, listed.length);
    for (const file of listed) {
      filesWalked++;
      const source = readFileSync(join(root, file), "utf8");
      if (!/disabled|enabled/.test(source)) continue;
      try {
        for (const name of offenders(source, file))
          found.add(`${file} :: ${name}`);
      } catch {
        unparseable.push(file);
      }
    }
  }
  return { perRoot, filesWalked, found, unparseable };
}

const root = repoRoot();
const scan = walk(root);

describe("a widget does not decide whether a command is available", () => {
  it("walked the host widgets and the Uplink clients", () => {
    const roots = [...scan.perRoot.keys()];
    expect(roots).toContain("packages/components/src");
    expect(roots).toContain("packages/app/src");
    expect(roots.some((r) => r.startsWith("mod/"))).toBe(true);
    expect(
      [...scan.perRoot].filter(([, n]) => n === 0).map(([r]) => r),
    ).toEqual([]);
    expect(scan.filesWalked).toBeGreaterThanOrEqual(MINIMUM_FILES);
  });

  it("could parse every file it needed to read", () => {
    expect(scan.unparseable, "files esbuild could not parse").toEqual([]);
  });

  it("can see a violation (planted)", () => {
    const planted: Record<string, string> = {
      handleProp: `export const W = () => <CommandButton handle={cmd} label="Go" disabled={!ready} />;`,
      namedCmdProp: `export const W = () => <HireButton hireCmd={cmd} enabled={canHire} />;`,
      sendInClick: `export const W = () => (\n  <button type="button" aria-disabled={!inScene} onClick={() => cmd.send({})}>Go</button>\n);`,
      hookChrome: `export function W() {\n  const { press } = useCommandButton({ handle });\n  return <Styled disabled={scene !== "SpaceCenter"} onClick={() => press(true)} />;\n}`,
    };
    const missed = Object.entries(planted)
      .filter(([name, src]) => offenders(src, `${name}.tsx`).length === 0)
      .map(([name]) => name);
    expect(
      missed,
      "planted availability decisions this scan walked past",
    ).toEqual([]);
  });

  it("does not flag what it should not (planted)", () => {
    const clean: Record<string, string> = {
      commandButton: `export const W = () => <CommandButton handle={cmd} label="Go" />;`,
      pendingChrome: `export function W() {\n  const { isPending, isBlocked } = useCommandButton({ handle });\n  return <><S disabled aria-busy="true" /><S aria-disabled={isBlocked || undefined} /><S disabled={isPending} /></>;\n}`,
      formControl: `export const W = () => <input disabled={saving} onChange={f} />;`,
      prose: `// <CommandButton handle={cmd} disabled={x} />\nexport const W = () => null;`,
    };
    const flagged = Object.entries(clean)
      .filter(([name, src]) => offenders(src, `${name}.tsx`).length > 0)
      .map(([name]) => name);
    expect(flagged, "legitimate code this scan flagged").toEqual([]);
  });

  it("has no entry for a file that no longer exists", () => {
    const missing = Object.keys(AVAILABILITY_DEBT)
      .map((key) => key.split(" :: ")[0])
      .filter((rel) => !existsSync(join(root, rel)));
    expect(missing).toEqual([]);
  });

  it("has no listed decision that has since moved onto the command", () => {
    const stale = Object.keys(AVAILABILITY_DEBT).filter(
      (key) => !scan.found.has(key),
    );
    expect(
      stale,
      "delete these from AVAILABILITY_DEBT in the commit that moved them",
    ).toEqual([]);
  });

  it("has no unlisted widget-side availability decision", () => {
    const unlisted = [...scan.found]
      .filter((key) => !(key in AVAILABILITY_DEBT))
      .sort();
    expect(
      unlisted,
      "declare the requirement on the command (GateDeclarations) and let CommandButton / useCommandButton draw it; do not decide it in the widget",
    ).toEqual([]);
  });
});
