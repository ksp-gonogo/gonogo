import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * The two primitives that take a `Reading` are FED readings, enforced.
 *
 * Operator ruling (#257, 8): *"Waste of time having Meter support Reading if
 * it's not going to be enforced."* `<Unit>` and `<Meter>` each say, in their
 * declared prop types, that they will draw how current a number is and how well
 * it is known. A call site that hands one a bare fraction it divided itself gets
 * a bar with neither, and it gets it silently: the picture is identical to a
 * healthy reading's, so nothing on screen says the currency and the band went
 * missing on the way in.
 *
 * ## Why a ratchet when the types already refuse a number
 *
 * Because the types refusing it is a DECISION, and the point of a ratchet is to
 * keep a decision from being undone quietly. Widening `MeterValue` back to
 * `number | MeterValue` is one word, it makes every gate green, and nothing but
 * this file would notice. That is not hypothetical: the same widening is how
 * both primitives ended up accepting a bare magnitude in the first place.
 *
 * There is a second reason, and it is the one the compiler structurally cannot
 * cover. A cast in the prop expression buys past the declared type at one call
 * site with no diagnostic anywhere, and `@ts-expect-error` does it in the open
 * while still passing a typecheck.
 *
 * ## The three gates
 *
 * - **A, the declaration.** Both primitives are typed over the PER-VALUE
 *   `Reading` and never over `TopicReading`. `TopicReading<Value<U>>` maps a
 *   `Value`'s own members into field readings and claims its `abs` and `max`
 *   are quantities with a currency; it compiled for a week because the proxy
 *   every caller went through satisfies the shape structurally. Gate A is what
 *   stops that particular nonsense coming back
 * - **B, the call sites.** No arithmetic, no bare magnitude and no cast in a
 *   `value` or `capacity` prop of either primitive, anywhere in the app or in
 *   any Uplink
 * - **C, blindness.** Every shape B refuses is planted and must be counted, and
 *   every shape it must ACCEPT is planted and must not be. A matcher that has
 *   stopped matching reports a clean tree, which reads exactly like success.
 *
 * ## Its other half, which is a different gate and not a duplicate
 *
 * `primitive-reading-feed.scan.ts` covers the fault this file cannot see: a
 * call site that HOLDS a reading and hands over `reading.value`. That is not a
 * magnitude, not arithmetic and not a cast, so gate B passes it, and it
 * discards the band and the staleness exactly as silently as the shapes above.
 * It needs the compiler to spot, because the question is what the expression's
 * type is.
 *
 * Cross-planted both ways rather than assumed: arithmetic at a call site fails
 * THIS gate and passes that one, and `<Unit value={reading.value} />` fails
 * that one and passes this. Neither is redundant.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** The primitives this gate is about, by their tag name. */
const PRIMITIVES = ["Unit", "Meter"] as const;

/** The props of those primitives that take a quantity or a reading of one. */
const QUANTITY_PROPS = ["value", "capacity"] as const;

/**
 * This file, which is the one exclusion and earns it: gate C's fixtures are
 * real call sites written out as strings, so the walk reads them as code. That
 * it does is the proof at GATE level rather than at matcher level.
 */
const SELF = "packages/core/src/styleguide-primitive-inputs.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__generated__")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, so a paragraph ABOUT a violation is not one.
 *
 * Both forms, and strings are left alone: a prop expression never spans a
 * string literal boundary in a way this needs, and blanking them would break
 * the brace counting that finds the expression's end.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Every `<Unit>` and `<Meter>` opening tag's attribute text.
 *
 * Brace-counted rather than matched to the first `>`, because a prop expression
 * routinely contains one: `capacity={m.capacity > 0 ? c : null}` ends the tag
 * four tokens after a `>` that is a comparison. Counting braces is what tells
 * the two apart, and getting it wrong truncates the expression this gate is
 * about to read.
 */
function openingTags(code: string): string[] {
  const tags: string[] = [];
  const opener = new RegExp(`<(${PRIMITIVES.join("|")})(?![A-Za-z0-9_])`, "g");
  for (const match of code.matchAll(opener)) {
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(code.slice(match.index + match[0].length, i));
  }
  return tags;
}

/**
 * The expression a tag passes to one of the quantity props, or `null` where it
 * passes none.
 *
 * Only the braced form is read. `value="x"` is a string and cannot be a
 * quantity, so the type refuses it on its own and there is nothing here to add.
 */
function quantityExpressions(attrs: string): string[] {
  const found: string[] = [];
  for (const prop of QUANTITY_PROPS) {
    const at = new RegExp(`(?<![A-Za-z0-9_$])${prop}=\\{`, "g");
    for (const match of attrs.matchAll(at)) {
      let depth = 1;
      let i = match.index + match[0].length;
      const start = i;
      for (; i < attrs.length && depth > 0; i++) {
        if (attrs[i] === "{") depth++;
        else if (attrs[i] === "}") depth--;
      }
      found.push(attrs.slice(start, i - 1).trim());
    }
  }
  return found;
}

/**
 * The expression with everything inside brackets removed, which is what the
 * checks below reason about.
 *
 * `value={value("ratio", linked / total)}` is CORRECT: the division happens
 * inside a call that mints a quantity from it, and the primitive is handed the
 * quantity. `value={linked / total}` is the violation, and the two differ only
 * in depth. Nothing else separates them, which is why this is a depth walk and
 * not a search for a slash.
 */
function topLevel(expression: string): string {
  let out = "";
  let depth = 0;
  for (const ch of expression) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Arithmetic at the top level: a caller dividing rather than the kit. */
const ARITHMETIC = /[+*/]|(?<=[A-Za-z0-9_$)\]\s])-(?=[\s(A-Za-z0-9_$])/;

/** The whole expression is a magnitude: `0.5`, `1_000`, `Number.NaN`. */
const BARE_MAGNITUDE = /^(-?[0-9][0-9_.eE+-]*|Number\.(NaN|[A-Z_]+))$/;

/**
 * A cast, which buys past the declared type with no diagnostic anywhere.
 *
 * Read at the TOP LEVEL like the rest, and that is a distinction rather than
 * consistency for its own sake. `value("m/s", relVel as number)` casts the
 * MAGNITUDE on its way into a quantity, which this gate has no opinion about;
 * what it refuses is a cast standing between the expression and the prop, which
 * is the one that says "trust me" about the very thing the prop declares.
 */
const CAST = /(?<![A-Za-z0-9_$])as(?![A-Za-z0-9_$])/;

/** Why one expression is refused, or `null` where it is fine. */
function refuse(expression: string): string | null {
  const top = topLevel(expression);
  if (BARE_MAGNITUDE.test(expression.trim()))
    return "a bare magnitude, not a quantity";
  if (ARITHMETIC.test(top)) return "arithmetic the primitive should be doing";
  if (CAST.test(top)) return "a cast past the declared type";
  return null;
}

/** Every refusal in one file's source, as readable lines. */
function offencesIn(code: string): string[] {
  const out: string[] = [];
  for (const attrs of openingTags(stripComments(code))) {
    for (const expression of quantityExpressions(attrs)) {
      const why = refuse(expression);
      if (why !== null) out.push(`${expression}: ${why}`);
    }
  }
  return out;
}

describe("A: the primitives are declared over the per-value Reading", () => {
  it.each([
    ["packages/ui-kit/src/Unit.tsx", "UnitValue"],
    ["packages/ui-kit/src/Meter.tsx", "MeterValue"],
  ])("%s types %s over Reading and never TopicReading", (file, alias) => {
    const code = readFileSync(join(REPO_ROOT, file), "utf8");
    const declaration = new RegExp(
      `export type ${alias}<[^=]*=\\s*([^;]+);`,
    ).exec(code);
    expect(declaration, `${alias} is not declared in ${file}`).not.toBeNull();
    const body = declaration?.[1] ?? "";
    expect(
      body,
      `${alias} must admit a per-value Reading: that is what a field of a ` +
        `topic reading IS, and what these primitives draw a band from.`,
    ).toMatch(/(?<![A-Za-z])Reading</);
    expect(
      body,
      `${alias} may not name TopicReading. Over a Value that type maps the ` +
        `value's OWN MEMBERS into field readings and claims its abs and max ` +
        `are quantities with a currency. It compiles only because the proxy ` +
        `every caller goes through satisfies the shape structurally.`,
    ).not.toMatch(/TopicReading</);
  });
});

describe("B: every call site passes what the primitives declare", () => {
  it("no app or Uplink tag hands one a magnitude, arithmetic or a cast", () => {
    const offenders: string[] = [];
    for (const root of styleguideScanRoots(REPO_ROOT)) {
      for (const file of walk(join(REPO_ROOT, root))) {
        const rel = relative(REPO_ROOT, file);
        if (rel === SELF) continue;
        for (const offence of offencesIn(readFileSync(file, "utf8"))) {
          offenders.push(`${rel}: ${offence}`);
        }
      }
    }
    expect(
      offenders,
      `<Unit> and <Meter> declare that they take a quantity or a whole ` +
        `Reading, and draw the currency and the band off one. A call site ` +
        `that divides first, or hands over a bare magnitude, gets a bar with ` +
        `neither and no sign that either went missing. Pass value("<unit>", n) ` +
        `for a figure you computed, the reading itself where you hold one, or ` +
        `null where there is no number.`,
    ).toEqual([]);
  });
});

describe("C: the gate can see each shape it refuses", () => {
  /*
   * Planted per shape rather than one sample per gate. A matcher goes blind one
   * pattern at a time, and a gate that still catches a bare `0.5` while having
   * stopped seeing `a / b` reports a clean tree for the half it lost.
   */
  it.each([
    ['<Meter label="x" value={0.5} />', "a bare magnitude"],
    ['<Meter label="x" value={Number.NaN} />', "a non-finite magnitude"],
    ['<Meter label="x" value={a.amount / a.capacity} />', "a division"],
    ["<Unit value={left - spent} />", "a subtraction"],
    ['<Meter label="x" value={total * 0.5} />', "a multiplication"],
    [
      '<Meter label="x" value={reading as TopicReading<number>} />',
      "a cast past the type",
    ],
    [
      '<Meter label="x" capacity={tank.max / 2} />',
      "arithmetic in the capacity",
    ],
  ])("refuses %s (%s)", (source) => {
    expect(offencesIn(source)).toHaveLength(1);
  });

  it.each([
    ['<Meter label="x" value={value("ratio", linked / total)} />', "minted"],
    ['<Meter label="x" value={fill(row.fraction)} />", ', "via a helper"],
    [
      '<Meter label="x" capacity={m.capacity > 0 ? value("u", m.capacity) : null} />',
      "a comparison and a guard, not arithmetic",
    ],
    ["<Unit value={flight.altitudeAsl} />", "a field reading"],
    ['<Meter label="x" value={dose?.value ?? null} />', "a contributed entry"],
    ["<UnitInput value={0.5} />", "a different component entirely"],
    [
      '<Unit value={value("m/s", relVel as number)} />',
      "a cast on the magnitude, inside the mint, not on the prop",
    ],
  ])("accepts %s (%s)", (source) => {
    expect(offencesIn(source)).toEqual([]);
  });

  it("reads a comment about a violation as a comment", () => {
    expect(offencesIn(`// <Meter label="x" value={0.5} />\n`)).toEqual([]);
  });

  it("finds the whole expression past a comparison in an earlier prop", () => {
    /*
     * The brace walk, pinned. Matched to the first `>` this tag ends inside its
     * own first prop, the violation in the second is never read, and the gate
     * goes quietly half-blind on every multi-prop call site in the tree.
     */
    expect(
      offencesIn('<Meter label="x" capacity={n > 0 ? c : null} value={0.5} />'),
    ).toHaveLength(1);
  });
});
