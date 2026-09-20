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
 * here is DERIVED from the file instead: every optional member must carry the
 * union unless the wire OMITS its key, so the check states the rule rather than
 * last week's total.
 *
 * The rule holds for a reference type exactly as for a value type, because
 * `JsonWriter` never consults the C# nullable annotation: a `string?` and a
 * `double?` both arrive as `"key":null`.
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
 * describe a state that cannot arrive. This list is the assertion's own copy of
 * what the flatteners do.
 *
 * A payload property says it with `[SitrepOmittedWhenNull]` at its C# property,
 * which is what the codegen reads. An ENVELOPE property has no marker: the
 * envelope is outside `ApplyUnitValueTypes` altogether (see the reasoning at
 * that call), so an attribute there would be read by nothing.
 */
const OMITTED_WHEN_NULL = new Set([
  /* EnvelopeCodec.AppendMeta guards it on HasValue, alone among Meta's fields:
     a gap is rare by construction, so every frame would otherwise carry 17
     bytes saying nothing happened. */
  "Meta.gapSinceUt",
  // JsonWriter.AppendPendingUplink guards it on HasValue, because a zero
  // throttle and an unknown value must never arrive looking the same.
  "PendingUplink.commandedValue",
  // JsonWriter.AppendCommandResult writes neither key on a success, rather than
  // putting an empty refusal shape on every ack.
  "CommandResult.breach",
  "CommandResult.detail",
  // EnvelopeCodec.WriteErrorMsg guards both on null: an error that names no
  // request and no topic carries neither key.
  "ErrorMsg.requestId",
  "ErrorMsg.topic",
  // The vantage a command centre stamps on its own request. Client-written, so
  // it is left out rather than transmitted as an absence, the same rule the
  // `Args` skip below states.
  "CommandRequest.vantage",
  /* The career economy group, and the reason it is nine entries rather than a
     type rule: `CareerViewProvider.CarryIfPresent` copies a key only when the
     capture carried it, which is the ONE provider that does not launder an
     absence into an explicit null. Every other ViewProvider reads the raw dict
     through a null-safe reader and writes an unconditional literal, so a key
     KspHost skipped still arrives holding null. Career says why it differs:
     "An absent key and a key holding null are different facts here": a model
     that has no such pool at all, versus a pool that is empty. */
  "CareerEconomy.economyModel",
  "CareerEconomy.reputationDecayPerDay",
  "CareerEconomy.subsidyPerDay",
  "CareerEconomy.subsidyMinPerDay",
  "CareerEconomy.subsidyMaxPerDay",
  "CareerEconomy.upkeepPerDay",
  "CareerEconomy.unlockCredit",
  "CareerEconomy.upkeep",
  "CareerEconomy.upkeepBeforeModifiers",
]);

/**
 * The provider extension bag. `JsonWriter.AppendProviderExtensions` omits the
 * key when no provider filled one, so a payload no provider extended carries no
 * trace of the mechanism. Matched by TYPE because it is one rule spread over
 * every elected payload rather than a rule per payload.
 */
const OMITTED_BAG_TYPE = "ProviderExtensions";

/** A member declaration: a leading tab, a name, an optional `?`, a type. */
const MEMBER = /^\t(\w+)(\??): (.+);$/;

/** Every optional member of one generated file that cannot hold a null. */
function unwidened(source: string): { checked: number; missing: string[] } {
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
      if (tsType === OMITTED_BAG_TYPE) continue;
      checked++;
      if (
        !tsType.endsWith(" | null") &&
        !OMITTED_WHEN_NULL.has(`${typeName}.${field}`)
      ) {
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

  it("widens every optional member", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const rel of contracts) {
      const found = unwidened(readFileSync(join(root, rel), "utf8"));
      checked += found.checked;
      problems.push(...found.missing.map((m) => `${rel} ${m}`));
    }
    // A walk that stopped early has nothing to disagree with and reports a
    // clean tree, so the count is a floor under the walk rather than a target.
    // It moves DOWN as Uplinks leave for their own repo, each taking its
    // generated contract with it, so it is lowered deliberately when that
    // happens and kept well clear of the remaining files' own total.
    expect(checked).toBeGreaterThan(400);
    expect(problems).toEqual([]);
  });

  it("sees a union that has been taken back out", () => {
    // The check's pass condition is an empty list, and an empty list is also
    // what a parse that stopped matching produces. Strip a union from a copy of
    // the real file and require exactly that field back, named.
    //
    // ONE plant of each KIND, because value and reference types reach the union
    // by different branches of the codegen, and a check that measures only one
    // of them reports a clean tree for the other.
    const sdk = readFileSync(
      join(root, "mod/sitrep-sdk/src/__generated__/contract.ts"),
      "utf8",
    );
    const damaged = sdk
      .replace("\tstate?: boolean | null;", "\tstate?: boolean;")
      .replace(
        "\tactivateBlockedReason?: string | null;",
        "\tactivateBlockedReason?: string;",
      );
    expect(damaged, "the planted edits matched nothing").not.toBe(sdk);
    expect(unwidened(damaged).missing.sort()).toEqual([
      "ActionGroupState.state: `boolean`",
      "CareerStrategy.activateBlockedReason: `string`",
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
    /* And the rule reaching a reference type, which crosses the same wire the
       same way: a refusal's own sentence, and the payload a failed command
       carries as an explicit null. */
    expect(sdk).toMatch(/\n\tactivateBlockedReason\?: string \| null;\n/);
    expect(sdk).toMatch(/\n\tpayload\?: T \| null;\n/);
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
    // The reference-typed half. Nothing about a reference type excludes it, so
    // these hold only while their marker does.
    expect(sdk).toMatch(/\n\tbreach\?: LimitBreach;\n/);
    expect(sdk).toMatch(/\n\tdetail\?: string;\n/);
    // Career, the one provider that does not launder an absence into a null.
    // A value type, a reference type and a nested payload, so the assertion
    // covers all three shapes the marker has to survive.
    expect(sdk).toMatch(/\n\tunlockCredit\?: Value<"funds">;\n/);
    expect(sdk).toMatch(/\n\teconomyModel\?: string;\n/);
    expect(sdk).toMatch(/\n\tupkeep\?: CareerUpkeep;\n/);
  });
});
