import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The reserved-name rule is written down twice, in two languages, and this
 * holds the two copies in step.
 *
 * `Reading`'s currency members (`state`, `value`, `atUt`, `asOfUt`, `grade`,
 * `reckoning`) are names a payload field may not take: a topic reading is
 * `TopicCurrency<P> & TopicFields<P>`, so a field spelled like one lands on the
 * currency's own member and the intersection collapses to `never`.
 *
 * `reading.ts` states the list as `ReservedReadingKey` and works around a
 * collision with `Exclude<keyof P, ReservedReadingKey>`, which is SILENT: the
 * field drops off the field-property surface with no field reading and no
 * explanation. `RtConfig.ReservedReadingKeys` states the same list on the C#
 * side and REFUSES the collision at codegen, which is where the author who
 * spelled it that way is standing.
 *
 * Neither can generate the other: one is a TypeScript type, the other a
 * reflection-time array in an assembly the SDK never loads. So they are two
 * hand-written lists of six short strings, and the failure mode of two such
 * lists is that one of them quietly grows. This is the ratchet against that:
 * the codegen refusal that does not know about a key is a gate with a hole in
 * exactly the shape of the key it is missing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const READING_TS = join(REPO, "mod/sitrep-sdk/src/reading.ts");
const RT_CONFIG_CS = join(REPO, "mod/Sitrep.Contract/RtConfig.cs");

/** The string-literal members of `export type ReservedReadingKey = ...`. */
function keysFromReadingTs(): string[] {
  const source = readFileSync(READING_TS, "utf8");
  const declaration = /export type ReservedReadingKey =([\s\S]*?);/.exec(
    source,
  );
  if (!declaration) {
    throw new Error(
      `${READING_TS} no longer declares \`export type ReservedReadingKey\`. ` +
        "Either it was renamed, in which case fix this test, or the exclusion " +
        "was deleted, in which case delete this test and the codegen debt list " +
        "with it.",
    );
  }
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The string members of `internal static readonly string[] ReservedReadingKeys`. */
function keysFromRtConfig(): string[] {
  const source = readFileSync(RT_CONFIG_CS, "utf8");
  const declaration =
    /internal static readonly string\[\] ReservedReadingKeys\s*=\s*\{([\s\S]*?)\};/.exec(
      source,
    );
  if (!declaration) {
    throw new Error(
      `${RT_CONFIG_CS} no longer declares \`ReservedReadingKeys\`. The codegen ` +
        "refusal is what makes the collision loud; without it the exclusion in " +
        "reading.ts goes back to dropping fields silently.",
    );
  }
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("the reserved Reading keys are the same list on both sides", () => {
  it("reading.ts and RtConfig.cs name the same keys", () => {
    const ts = keysFromReadingTs();
    const cs = keysFromRtConfig();

    // Sorted, because the two files order them for their own readers: the TS
    // union follows the currency's declaration order and the C# array follows
    // it by hand. Order is not part of the rule; membership is.
    expect([...cs].sort()).toEqual([...ts].sort());
  });

  it("neither list is empty, so an equality of two nothings cannot pass", () => {
    // Both regexes above can match a declaration whose body has been emptied,
    // and two empty arrays compare equal. That is the shape of a gate reporting
    // success because it has stopped reading anything.
    expect(keysFromReadingTs().length).toBeGreaterThanOrEqual(6);
    expect(keysFromRtConfig().length).toBeGreaterThanOrEqual(6);
  });
});
