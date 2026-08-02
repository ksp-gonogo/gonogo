import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: nothing declares a local component under a name the
 * kit already publishes.
 *
 * Its sibling `styleguide-duplicate-primitives.test.ts` catches the same
 * component implemented in both shared packages. This catches the quieter
 * version: a widget that builds its own and calls it by the kit's name.
 *
 * `Navball` did exactly this. It had a local
 * `const ToggleButton = styled.button<{ $active: boolean }>` and used it for
 * SAS, RCS, precision, every SAS mode and the fly-by-wire arm. The kit's
 * `ToggleButton` sets `aria-pressed` from `active`; the local one set no
 * ARIA at all, so eleven two-state controls announced themselves to a screen
 * reader as plain buttons with no on/off state. Nothing flagged it, because
 * from inside the file the name resolved perfectly.
 *
 * That is the whole danger: a shadowing copy reads as correct at the call
 * site. `<ToggleButton active={sasOn}>` looks like the kit component whether
 * or not it is one, and the difference only shows up in a screen reader or a
 * theme change.
 *
 * The rule is not "never write a local styled component". It is "do not give
 * one a name the kit already owns". If the local version is genuinely
 * different, name it for what it is (`ModeBadge`, `StepBtn`, `TinyValue` all
 * pass). If it is not different, import the kit's.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const UI_KIT = join(REPO, "packages/ui-kit/src");

/**
 * Where widgets live. ui-kit itself is excluded here because it legitimately
 * declares every one of these names once, at its own canonical file (that
 * declaration is not a shadow). ui-kit IS still scanned, separately, below:
 * `Combobox.tsx` once had a private `const EmptyState = styled.div` that
 * shadowed the public `EmptyState.tsx` export, and this list alone couldn't
 * see it. A within-ui-kit shadow gets the same regex pass, minus the file(s)
 * that are the name's legitimate owner (its `export function/const/class`
 * site, or an `export { Name } from "./Name"` barrel line).
 */
const SCANNED = [
  "packages/components/src",
  "packages/app/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/ui/src",
  "mod",
];

/** `const Foo = styled.tag` / `styled(Other)`, the local-component form. */
const LOCAL_STYLED_RE =
  /^(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*styled[.(]/gm;

/** `function Foo(` / `const Foo = (props) =>` at module scope. */
const LOCAL_COMPONENT_RE =
  /^(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Every ui-kit public export name, mapped to the file(s) where it is
 * legitimately declared or re-exported (an `export function/const/class
 * Name` site, or a barrel's `export { Name } from "./Name"` line). The
 * within-ui-kit shadow scan uses the file set to tell "this IS the public
 * `EmptyState`" apart from "this is a second, different declaration that
 * happens to share the name" without flagging the former.
 */
function kitExportOwners(): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const own = (name: string, file: string) => {
    let files = owners.get(name);
    if (!files) {
      files = new Set();
      owners.set(name, files);
    }
    files.add(file);
  };
  for (const file of sourceFiles(UI_KIT)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(REPO, file);
    for (const [, name] of text.matchAll(
      /^export\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)/gm,
    )) {
      own(name, rel);
    }
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part
          .replace(/^\s*type\s+/, "")
          .split(" as ")
          .pop()
          ?.trim();
        if (name && /^[A-Z]/.test(name)) own(name, rel);
      }
    }
  }
  return owners;
}

/**
 * What already shadows a kit name, as `Name@repo-relative-path`.
 *
 * A DECLINING baseline, the same shape as the token ratchets: a new entry
 * fails the build, a removed one is a cleanup and passes. It is a record of
 * a backlog, not an endorsement.
 *
 * **EMPTY, and it must stay that way.** 89 entries at the start of the sweep,
 * zero now, so a new shadow is a build failure rather than a line someone can
 * add to a list.
 *
 * **The order matters, and getting it wrong is how this list grew.** An entry
 * leaves in one of two ways, and the second is only available after the first
 * has been tried and written up:
 *
 * 1. **Convert** to the kit's counterpart, accepting that the kit moves the
 *    visuals. This is the default and it cleared roughly 70 entries.
 * 2. **Rename for what it actually is**, once an adversarial look has shown
 *    the widget does something the kit genuinely cannot, and that reason is
 *    recorded. This is what the failure message below has always advised, and
 *    it is correct precisely BECAUSE the component is different: leaving a
 *    disclosure button called `ToggleButton` is an active hazard, since a
 *    reader assumes the kit's two-state control and its `aria-pressed`.
 *
 * A rename done INSTEAD of step 1 is the failure mode. It satisfies the guard
 * and leaves a hand-rolled duplicate of something the kit already offers,
 * now invisible to the thing that was inventorying it. That happened once,
 * to nine components, and all nine were put back and redone.
 *
 * **Before accepting that a widget is special, ask what the KIT is missing.**
 * Ten additions came out of this sweep (`Cluster.wrap`/`align`/`center`,
 * `Grid.align`/`rowGap`, `Section.as`, `SectionTitle`'s weight and `$rule`,
 * `ConfigForm.$boxed`, `Card.tone`/`dimmed`, `Value`'s `faint` tone,
 * `Row.interactive`/`selected`, `BoxRadius.lg`), and eight of them came from
 * an entry that read as "genuinely different" until the question was turned
 * around. The sharpest: three components were logged as needing a `Surface`
 * primitive the kit lacked, and the real gap was one missing enum member.
 *
 * The counterpart is by FUNCTION, not by name, and reading the name as the
 * target is what produced the renames. The kit's `Row` is specifically a
 * `styled.li` with `space-between` for a list row carrying a name and badges;
 * most local components called `Row` are not that, and convert to `Cluster`,
 * `Card`, `Stack` or `Grid` instead.
 *
 * Every entry also asks a second question: **should the kit grow to cover
 * this?** Three sites wanting the same missing thing is the strongest signal
 * the kit has a hole, and the `SectionTitle` sweep proved it twice: the kit's
 * version was missing the bold weight that seven of nine copies set, and three
 * modals had each written the same rule-under-the-heading by hand.
 *
 * Navball is why the guard exists at all: its local `ToggleButton` was a real
 * substitute for the kit's with none of the ARIA, so eleven two-state controls
 * announced no on/off state. It read as correct at every call site.
 */
const BASELINE = new Set<string>([]);

/** Every shadowing declaration on disk right now, baseline or not. */
function currentShadows(): Set<string> {
  const owners = kitExportOwners();
  const kit = new Set(owners.keys());
  const found = new Set<string>();

  for (const root of SCANNED) {
    for (const file of sourceFiles(join(REPO, root))) {
      const text = readFileSync(file, "utf8");
      // A file that IMPORTS the name from the kit and also declares it
      // would not compile, so only look at files that do not import it.
      for (const re of [LOCAL_STYLED_RE, LOCAL_COMPONENT_RE]) {
        re.lastIndex = 0;
        for (const [, name] of text.matchAll(re)) {
          if (!kit.has(name)) continue;
          found.add(`${name}@${relative(REPO, file)}`);
        }
      }
    }
  }

  // The within-ui-kit pass: a local declaration inside ui-kit that shares a
  // name with a DIFFERENT public export than the one it is. Skip the file(s)
  // that legitimately own the name (its own declaration site, or a barrel
  // re-export) so the public component never flags itself.
  for (const file of sourceFiles(UI_KIT)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(REPO, file);
    for (const re of [LOCAL_STYLED_RE, LOCAL_COMPONENT_RE]) {
      re.lastIndex = 0;
      for (const [, name] of text.matchAll(re)) {
        if (!kit.has(name)) continue;
        if (owners.get(name)?.has(rel)) continue;
        found.add(`${name}@${rel}`);
      }
    }
  }

  return found;
}

describe("no local component shadows a ui-kit export", () => {
  it("finds no shadowing declaration", () => {
    const fresh = [...currentShadows()].filter((e) => !BASELINE.has(e)).sort();
    expect(
      fresh,
      `These declare a local component under a name @ksp-gonogo/ui-kit already
publishes, so the call site reads as the kit's component and is not:

${fresh.map((o) => `  ${o}`).join("\n")}

Either import the kit's version, or rename the local one for what it actually
is. Navball's local ToggleButton is why this guard exists: it looked right at
every call site and set aria-pressed on none of eleven controls.

If you genuinely need a differently-named local component, rename it. Adding
to BASELINE is for recording what was already there, not for new work.`,
    ).toEqual([]);
  });

  it("holds no stale BASELINE entry", () => {
    // Without this the baseline is a list, not a ratchet. A batch could
    // convert six widgets, leave their six lines behind, and the count would
    // never move; the next reader would then believe there was more debt than
    // there is and, worse, a NEW shadow at one of those paths would be
    // silently pre-forgiven.
    //
    // The C# unit-coverage ratchet asserts the same thing, and this one is
    // where the idea came from, so it should have had it first.
    const current = currentShadows();
    const stale = [...BASELINE].filter((e) => !current.has(e)).sort();

    expect(
      stale,
      `These BASELINE entries no longer shadow anything, so the baseline is
overstating the remaining debt and pre-forgiving those paths:

${stale.map((s) => `  ${s}`).join("\n")}

Delete them. If a conversion or rename cleared one, that is the win: take the
line out in the same commit.`,
    ).toEqual([]);
  });
});
