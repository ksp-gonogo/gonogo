import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every generated `contract.ts` must keep spelling the `null` the wire sends.
 *
 * `JsonWriter.AppendObject` walks every pair of a payload dictionary and calls
 * `AppendValue` unconditionally, and `AppendValue`'s `case null:` writes the
 * four bytes `null`. So a reading nobody could take arrives as `"key":null`
 * with the key KEPT, and a published type of `T | undefined` makes the correct
 * guard a compile error while the substitution compiles clean:
 *
 *     if (g.state === null)   // TS2367 against `state?: boolean`
 *     g.state ?? false        // clean, and a claim the save never made
 *
 * The file is generated, so nothing here is fixed by editing it: the rule lives
 * in `RtConfig.ApplyUnitValueTypes` (see `NullUnionApplies`). What this guards
 * is the REGENERATION. A knob nudged, a new Uplink slice registered through a
 * path that skips the pass, or a Reinforced.Typings upgrade that resolves types
 * differently would all silently take the unions back out, and a generated file
 * is exactly where nobody looks.
 *
 * ## Why this is a rule and not a list of numbers
 *
 * A count floor passes when one field loses its union and another gains one,
 * and it needs re-seeding every time a payload grows a field. The expectation
 * here is DERIVED from the file instead: every optional member whose type is a
 * value type must carry the union, so the check states the rule rather than
 * last week's total.
 *
 * `asyncapi.yaml` looks like a better witness and is not. It is generated FROM
 * this same TypeScript and takes its nullability from the `?`, so holding one
 * to the other proves only that the file agrees with itself.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
}

/**
 * Every generated contract in the tree, DISCOVERED rather than listed: each
 * bundled Uplink is on its way out to the gonogo-uplinks repo, and a departure
 * must not read as a regression, nor a new Uplink as covered when it is not.
 */
function generatedContracts(root: string): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "mod/*/__generated__/contract.ts",
      "mod/*/*/*/__generated__/contract.ts",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => line.endsWith("/__generated__/contract.ts"));
}

/**
 * The properties whose KEY a flattener leaves out entirely, so `| null` would
 * describe a state that cannot arrive. Each is marked
 * `[SitrepOmittedWhenNull]` at its C# property, which is what the codegen
 * reads; this list is the assertion's own copy of the same two decisions.
 */
const OMITTED_WHEN_NULL = new Set([
  /* EnvelopeCodec.AppendMeta guards it on HasValue, alone among Meta's fields:
     a gap is rare by construction, so every frame would otherwise carry 17
     bytes saying nothing happened. */
  "Meta.gapSinceUt",
  // JsonWriter.AppendPendingUplink guards it on HasValue, because a zero
  // throttle and an unknown value must never arrive looking the same.
  "PendingUplink.commandedValue",
]);

/** A member declaration: a leading tab, a name, an optional `?`, a type. */
const MEMBER = /^\t(\w+)(\??): (.+);$/;

/**
 * Whether an emitted type is the TypeScript for a nullable C# VALUE type, which
 * is the half the codegen widens.
 *
 * `boolean` and `number` cover `bool?`, every numeric, and a cross-assembly
 * enum (which rtcli emits as its ordinal). A same-assembly enum emits under its
 * own name, so the file's own `export enum` declarations are the roster for
 * those. `Value<"m">` is a nullable quantity, where the two rules compose.
 *
 * Everything else is a nullable REFERENCE type, which crosses the same wire the
 * same way and is deliberately NOT widened: `string?`, `T[]?` (including
 * `Value<"m">[]`, which is why the match is anchored) and a POCO.
 */
function isValueType(base: string, enums: ReadonlySet<string>): boolean {
  return (
    base === "boolean" ||
    base === "number" ||
    /^Value<"[^"]*">$/.test(base) ||
    enums.has(base)
  );
}

/** Every optional value-typed member of one generated file that cannot hold a null. */
function unwidened(source: string): { checked: number; missing: string[] } {
  const enums = new Set(
    [...source.matchAll(/^export enum (\w+)/gm)].map((m) => m[1]),
  );
  const missing: string[] = [];
  let checked = 0;
  for (const block of source.matchAll(
    /^export interface (\w+)(?:<[^>]*>)?(?: extends [^\n{]+)?\s*\n\{\n([\s\S]*?)^\}/gm,
  )) {
    const typeName = block[1];
    /* A command ARGS type is a wire-WRITE, and the pass skips it on purpose: a
       client leaves an argument it is not setting OUT, and a type offering
       `| null` invites it to transmit an absence instead. */
    if (typeName.endsWith("Args")) continue;
    for (const line of block[2].split("\n")) {
      const member = MEMBER.exec(line);
      if (!member || member[2] !== "?") continue;
      const [, field, , tsType] = member;
      const nullable = tsType.endsWith(" | null");
      const base = nullable ? tsType.slice(0, -" | null".length) : tsType;
      if (!isValueType(base, enums)) continue;
      checked++;
      if (!nullable && !OMITTED_WHEN_NULL.has(`${typeName}.${field}`)) {
        missing.push(`${typeName}.${field}: \`${tsType}\``);
      }
    }
  }
  return { checked, missing };
}

describe("generated contract types can hold the null the wire sends", () => {
  const root = repoRoot();
  const contracts = generatedContracts(root);

  it("finds the generated contracts to check", () => {
    // A discovery that reaches nothing checks nothing and passes, which is the
    // shape of a gate gone blind rather than of a clean tree. Core's own is
    // named because it is the published SDK and never leaves.
    expect(contracts).toContain("mod/sitrep-sdk/src/__generated__/contract.ts");
    expect(contracts.length).toBeGreaterThan(1);
  });

  it("widens every optional value-typed member", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const rel of contracts) {
      const found = unwidened(readFileSync(join(root, rel), "utf8"));
      checked += found.checked;
      problems.push(...found.missing.map((m) => `${rel} ${m}`));
    }
    // A walk that stopped early has nothing to disagree with and reports a
    // clean tree, so the count is a floor under the walk rather than a target.
    //
    // It moves DOWN as Uplinks leave for their own repo, because each takes its
    // generated contract with it: 786 across seven files when this landed, 582
    // once RP-1's went. Lowered deliberately each time rather than left to fail,
    // and kept well clear of the remaining files' own total so it still catches
    // a discovery that reaches nothing.
    expect(checked).toBeGreaterThan(400);
    expect(problems).toEqual([]);
  });

  it("sees a union that has been taken back out", () => {
    // The check's pass condition is an empty list, and an empty list is also
    // what a parse that stopped matching produces. Strip one union from a copy
    // of the real file and require exactly that field back, named.
    const sdk = readFileSync(
      join(root, "mod/sitrep-sdk/src/__generated__/contract.ts"),
      "utf8",
    );
    const damaged = sdk.replace(
      "\tstate?: boolean | null;",
      "\tstate?: boolean;",
    );
    expect(damaged, "the planted edit matched nothing").not.toBe(sdk);
    expect(unwidened(damaged).missing).toEqual([
      "ActionGroupState.state: `boolean`",
    ]);
  });

  it("publishes a known three-valued field as three-valued", () => {
    // The field the defect was found on: `null` means the backend knows the
    // group exists but could not read whether it is engaged, which is NOT that
    // it is disengaged. A client that collapses the two draws an OFF toggle for
    // a group whose state nobody knows, and inverting that reading commands the
    // wrong way.
    const sdk = readFileSync(
      join(root, "mod/sitrep-sdk/src/__generated__/contract.ts"),
      "utf8",
    );
    expect(sdk).toMatch(/\n\tstate\?: boolean \| null;\n/);
    // And the rule reaching a quantity, where it composes with the unit wrap
    // rather than replacing it.
    expect(sdk).toMatch(/\n\tlan\?: Value<"°"> \| null;\n/);
  });

  it("leaves a key the wire OMITS un-nullable", () => {
    // `| null` on one of these would send a reader looking for a state that
    // cannot arrive. Asserted against the file as well as excused in the set
    // above, so the excuse cannot outlive the decision it names.
    const sdk = readFileSync(
      join(root, "mod/sitrep-sdk/src/__generated__/contract.ts"),
      "utf8",
    );
    expect(sdk).toMatch(/\n\tgapSinceUt\?: number;\n/);
    expect(sdk).toMatch(/\n\tcommandedValue\?: number;\n/);
  });
});
