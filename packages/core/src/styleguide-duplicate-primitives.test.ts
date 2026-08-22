import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: a shared primitive is implemented ONCE, in
 * `@ksp-gonogo/ui-kit`.
 *
 * ui-kit is the published package, so it is the only one a third-party
 * Uplink can import. `@ksp-gonogo/ui` is app-side and private. When a
 * primitive exists in both, an Uplink and a built-in widget rendering "the
 * same" component are rendering two different components, and nothing says
 * so.
 *
 * This is not a tidiness rule, it has already cost real time twice:
 *
 *   - `Panel` was copied into ui-kit when that package was created rather
 *     than aliased back. Nothing noticed for months. The compound-Panel
 *     rework then improved only the ui copy, so `<Panel panelTitle="X">`
 *     was a type error from ui-kit, and ui-kit's `PanelBody` was a
 *     padding-only box that did not scroll, silently clipping overflow
 *     where the other one scrolled it. Twenty-nine widgets imported the
 *     stale one.
 *   - `Badge` was the same copy, caught here before it diverged: four
 *     widgets on one, nine on the other, identical apart from a doc
 *     comment. Given time it would have been Panel again.
 *
 * The fix in both cases is the same and is cheap: `packages/ui/src/X.tsx`
 * becomes a re-export from ui-kit. Thirteen of ui's files already are.
 *
 * What this does NOT forbid: a genuinely app-only primitive in ui (LineChart
 * and the rest are fine, they have no ui-kit twin), or ui re-exporting a
 * ui-kit name. Only a second IMPLEMENTATION.
 *
 * `Gauge` was on that app-only list until 2026-08-18 and should not have been:
 * it imports nothing but React, and an Uplink was reaching into this private
 * package for it. Being app-only is a claim about what a primitive DEPENDS on,
 * not about who happens to render it today.
 *
 * ---
 *
 * The name check above is BLIND INSIDE ui-kit, and that is not an oversight
 * that can be patched by pointing it at one more directory: TypeScript already
 * forbids two exports of one name in one module graph, so intra-package
 * duplication necessarily wears a DIFFERENT name and a name-equality scan can
 * never see it. It needs a different kind of check, which is the second half of
 * this file.
 *
 * The instance that prompted it: `StatusPill` (`Readout.tsx`) is `Badge` with a
 * rival tone vocabulary. Both are uppercase, letter-spaced, pill-radiused
 * status chips; `Badge` speaks the canonical `Severity` and reports itself into
 * `PanelStatusStore`, `StatusPill` speaks `ReadoutTone` and reports nothing. So
 * six render sites are status chips that can never reach a panel's status
 * summary, and nothing said so. The Panel failure mode above, one package
 * inward.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const UI = join(REPO, "packages/ui/src");
const UI_KIT = join(REPO, "packages/ui-kit/src");

/** `export const|function|class|interface|type|enum Name` */
const DECLARED_RE =
  /^export\s+(?:default\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;

/** A file whose whole job is `export { … } from "@ksp-gonogo/ui-kit"`. */
const ALIASES_UI_KIT_RE =
  /export\s*\{[^}]*\}\s*from\s*["']@ksp-gonogo\/ui-kit["']/s;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (entry === "index.ts") continue;
    out.push(full);
  }
  return out;
}

/** name -> repo-relative file that declares it. */
function declarations(dir: string, skipAliases: boolean): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    if (skipAliases && ALIASES_UI_KIT_RE.test(text)) continue;
    for (const [, name] of text.matchAll(DECLARED_RE)) {
      if (!found.has(name)) found.set(name, relative(REPO, file));
    }
  }
  return found;
}

/**
 * Names that legitimately exist in both because they mean different things,
 * not because a component was copied. Keep this empty if you can: an entry
 * here is a naming collision that a reader has to hold in their head.
 */
const ALLOWED: readonly string[] = [];

describe("shared primitives are implemented once, in ui-kit", () => {
  it("no name is implemented in both @ksp-gonogo/ui and @ksp-gonogo/ui-kit", () => {
    const kit = declarations(UI_KIT, false);
    const app = declarations(UI, true);

    const duplicated = [...app.entries()]
      .filter(([name]) => kit.has(name) && !ALLOWED.includes(name))
      .map(([name, file]) => `${name}  (${file}  vs  ${kit.get(name)})`)
      .sort();

    expect(
      duplicated,
      duplicated.length === 0
        ? ""
        : `These names are implemented in BOTH packages:\n\n` +
            duplicated.map((d) => `  ${d}`).join("\n") +
            `\n\nui-kit is the canonical home for anything an Uplink may need.\n` +
            `Delete the copy in packages/ui and make that file a re-export:\n\n` +
            `  export { Thing, type ThingProps } from "@ksp-gonogo/ui-kit";\n\n` +
            `If the two genuinely mean different things, rename one. Adding to\n` +
            `ALLOWED in this file is the last resort, not the first.`,
    ).toEqual([]);
  });

  it("ui-kit does not import from the app-side ui package", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(UI_KIT)) {
      const text = readFileSync(file, "utf8");
      if (/from\s*["']@ksp-gonogo\/ui["']/.test(text)) {
        offenders.push(relative(REPO, file));
      }
    }

    expect(
      offenders,
      `ui-kit is published and ui is private, so this import would ship a\n` +
        `broken package. Move what is needed INTO ui-kit instead:\n` +
        offenders.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Within ui-kit: one visual FORM, one component.
//
// Detection is by shape rather than by name, for the reason in the header: a
// name-equality scan is structurally incapable of seeing intra-package
// duplication. The "static pill" form is a styled block that is uppercase,
// letter-spaced and pill-radiused, and is NOT an interactive control (a tab, a
// filter chip: those are pills that DO something when pressed, and the
// behaviour is what makes them a different component rather than a copy).
// ---------------------------------------------------------------------------

/** `const Name = styled.tag<...>` / `styled(Other)<...>`, capturing the tag or the wrapped name. */
const STYLED_DECL_RE =
  /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*styled(?:\.([a-zA-Z]+)|\(\s*([A-Za-z0-9_.]+)\s*\))/g;

/** Interactive by construction: a control that happens to be pill-shaped. */
function isInteractive(
  tag: string | undefined,
  wrapped: string | undefined,
): boolean {
  if (tag === "button" || tag === "a") return true;
  if (wrapped !== undefined && /Button|Link|Anchor/.test(wrapped)) return true;
  return false;
}

/** The styled block's template body: from its opening backtick to the closing one. */
function styledBody(text: string, from: number): string {
  const open = text.indexOf("`", from);
  if (open === -1) return "";
  const close = text.indexOf("`", open + 1);
  return close === -1 ? text.slice(open) : text.slice(open + 1, close);
}

function isStaticPill(body: string): boolean {
  return (
    body.includes("text-transform: uppercase") &&
    body.includes("--radius-pill") &&
    body.includes("letter-spacing")
  );
}

/** styled name -> repo-relative file, for every static pill in ui-kit. */
function staticPills(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(STYLED_DECL_RE)) {
      const [, name, tag, wrapped] = m;
      if (isInteractive(tag, wrapped)) continue;
      if (!isStaticPill(styledBody(text, (m.index ?? 0) + m[0].length))) {
        continue;
      }
      found.set(name, relative(REPO, file));
    }
  }
  return found;
}

/**
 * The one component allowed to draw a static status pill. `Badge` is it: it
 * speaks the canonical `Severity` and reports into `PanelStatusStore`, so a
 * chip drawn through it can reach a panel's status summary.
 */
const PILL_OWNER = "Badge__Body";

/**
 * Every other static pill in ui-kit, with why it is still here. SHRINK-ONLY:
 * an entry comes out when the component folds into `Badge`, and a new one is a
 * failure rather than an addition. Allowlisting a fresh duplicate is the move
 * this whole file exists to make hard.
 */
const PILL_DEBT: Readonly<Record<string, string>> = {
  // `Badge` with a rival tone vocabulary (`ReadoutTone` rather than `Severity`)
  // and no `report`, so its six render sites are status chips that cannot
  // contribute to a panel's status summary. Folding it means giving `Badge`
  // StatusPill's padding, weight and alert pulse as a variant and migrating
  // seven call sites across three packages, which is its own change.
  StatusPill: "packages/ui-kit/src/Readout.tsx",
};

describe("within ui-kit, one visual form is one component", () => {
  it("finds no static pill outside Badge and the recorded debt", () => {
    const pills = staticPills(UI_KIT);

    expect(
      pills.has(PILL_OWNER),
      `The scan no longer sees ${PILL_OWNER}, the component it is anchored on.\n` +
        `A shape scan that stops matching reports an empty offender list, and an\n` +
        `empty list reads as success. Fix the signature before trusting a pass.`,
    ).toBe(true);

    const offenders = [...pills.entries()]
      .filter(([name]) => name !== PILL_OWNER && !(name in PILL_DEBT))
      .map(([name, file]) => `${name}  (${file})`)
      .sort();

    expect(
      offenders,
      `These draw ui-kit's status pill a second time:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nRender through \`Badge\` instead. It speaks the canonical Severity\n` +
        `and reports into PanelStatusStore, so a chip drawn through it can reach\n` +
        `a panel's status summary; a private copy never can, and nothing on\n` +
        `screen says which kind the operator is looking at.`,
    ).toEqual([]);
  });

  it("keeps the debt list shrink-only: every entry still exists", () => {
    const pills = staticPills(UI_KIT);
    const stale = Object.keys(PILL_DEBT).filter((name) => !pills.has(name));

    expect(
      stale,
      `These are recorded as pill debt but are no longer static pills in ui-kit,\n` +
        `so the entry is stale. Delete it: that is the list shrinking.\n` +
        stale.map((s) => `  ${s}`).join("\n"),
    ).toEqual([]);
  });

  it("sees a violation when there is one", () => {
    // The scan is only worth its green if it can go red. Same predicate, same
    // shape, against a block that is deliberately a second pill.
    const planted = [
      "const RivalPill = styled.div`",
      "  display: inline-flex;",
      "  border-radius: var(--radius-pill, 999px);",
      "  letter-spacing: 0.12em;",
      "  text-transform: uppercase;",
      "`;",
    ].join("\n");

    const hits: string[] = [];
    for (const m of planted.matchAll(STYLED_DECL_RE)) {
      const [, name, tag, wrapped] = m;
      if (isInteractive(tag, wrapped)) continue;
      if (isStaticPill(styledBody(planted, (m.index ?? 0) + m[0].length))) {
        hits.push(name);
      }
    }

    expect(hits).toEqual(["RivalPill"]);
    expect(hits[0] === PILL_OWNER || (hits[0] ?? "") in PILL_DEBT).toBe(false);
  });

  it("leaves an interactive pill alone: a tab and a filter chip are not badges", () => {
    const pills = staticPills(UI_KIT);
    // Both match the pill CSS and both are `styled.button`. A control that does
    // something when pressed is a different component, not a copy of `Badge`.
    expect(pills.has("Tabs__Button")).toBe(false);
    expect(pills.has("ChipButton")).toBe(false);
  });
});
