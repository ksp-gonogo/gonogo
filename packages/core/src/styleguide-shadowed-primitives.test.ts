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

/** Where widgets live. ui-kit itself is excluded: it declares these names. */
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

function kitExports(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(UI_KIT)) {
    const text = readFileSync(file, "utf8");
    for (const [, name] of text.matchAll(
      /^export\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)/gm,
    )) {
      names.add(name);
    }
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part
          .replace(/^\s*type\s+/, "")
          .split(" as ")
          .pop()
          ?.trim();
        if (name && /^[A-Z]/.test(name)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * What already shadows a kit name, as `Name@repo-relative-path`.
 *
 * A DECLINING baseline, the same shape as the token ratchets: a new entry
 * fails the build, a removed one is a cleanup and passes. It is a record of
 * a backlog, not an endorsement.
 *
 * **Renaming is not how an entry leaves this list.** That was the first read
 * of it and it was wrong: a rename satisfies the guard and leaves the
 * hand-rolled component exactly where it was, now invisible. The list is an
 * inventory of places the design system is not being used, so an entry leaves
 * by being CONVERTED to its kit counterpart, accepting that the kit moves the
 * visuals, or by being logged as genuinely different.
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
const BASELINE = new Set<string>([
  "Box@packages/ui/src/DataKeyMultiPicker.tsx",
  "Dial@packages/components/src/TransferWindow/index.tsx",
  "Field@packages/app/src/components/MissionBanner.tsx",
  "Field@packages/components/src/LandingStatus/index.tsx",
  "Field@packages/components/src/ManeuverPlanner/TriggerEditor.tsx",
  "Grid@packages/components/src/CurrentOrbit/index.tsx",
  "Panel@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Readout@packages/components/src/SemiMajorAxis/index.tsx",
  "Row@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Row@packages/components/src/PowerSystems/index.tsx",
  "Row@packages/components/src/StationConnectView/index.tsx",
  "Row@packages/ui/src/DataKeyMultiPicker.tsx",
  "RowName@packages/components/src/TargetPicker/index.tsx",
  "RowName@packages/serial/src/SerialDevicesMenu/index.tsx",
  "Stack@packages/ui/src/BannerStack.tsx",
  "ToggleButton@mod/GonogoScansatUplink/client/src/ScienceAugment/index.tsx",
  "Value@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Value@packages/components/src/CurrentOrbit/index.tsx",
  "Value@packages/components/src/ManeuverPlanner/ManeuverPreview.tsx",
]);

/** Every shadowing declaration on disk right now, baseline or not. */
function currentShadows(): Set<string> {
  const kit = kitExports();
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
