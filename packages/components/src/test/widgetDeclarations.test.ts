import { classifyRequirement, getComponents } from "@ksp-gonogo/core";
import { DYNAMIC_WHOLE_TOPIC_PREFIXES } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import "../index";

/**
 * Every `dataRequirements` and `fields` entry every built-in widget declares
 * must resolve to something real (`classifyRequirement` in
 * `@ksp-gonogo/core` has the four legal forms). Read resolution walks a
 * path without checking the leaf, so a misspelt field would otherwise render
 * as a permanent `undefined`. Reads the real registry, not source text.
 *
 * Covers only the widgets this package registers. Uplink widgets and the
 * augment registry are checked by
 * `packages/app/src/__tests__/uplink-widget-declarations.test.ts`.
 */
describe("widget dataRequirements resolve to something real", () => {
  /**
   * `channels` and `optionalChannels` are left out: a built-in widget may
   * mount on an Uplink-owned channel that only resolves once that Uplink's
   * client is loaded, which the app gate has.
   */
  const declared = getComponents().flatMap((def) =>
    [...(def.dataRequirements ?? []), ...(def.fields ?? [])].map(
      (requirement) => ({
        id: def.id,
        requirement,
      }),
    ),
  );

  it("found a non-trivial number of declarations (scan sanity check)", () => {
    // An empty registry would make the assertion below vacuous.
    expect(declared.length).toBeGreaterThan(100);
  });

  it("classifies every declaration, no unresolvable entries", () => {
    const unresolvable = declared
      .filter(
        ({ requirement }) => classifyRequirement(requirement) === undefined,
      )
      .map(({ id, requirement }) => `${id}: ${requirement}`)
      .sort();

    expect(unresolvable).toEqual([]);
  });

  it("rejects a plausible-looking field that does not exist", () => {
    // Positive control: a kind here means the classifier has gone permissive.
    expect(
      classifyRequirement("career.status.balances.notAField"),
    ).toBeUndefined();
    expect(classifyRequirement("spaceCenter.state.notAField")).toBeUndefined();
    expect(classifyRequirement("career.status.balances.funds")).toBe(
      "field-path",
    );
    expect(classifyRequirement("career.status")).toBe("wire-topic");
    expect(classifyRequirement("spaceCenter.state")).toBe("derived-channel");
    // A retired flat-vocabulary key has nothing to resolve against.
    expect(classifyRequirement("career.funds")).toBeUndefined();
  });
});

/**
 * A Topic family is a pattern whose every placeholder fills one whole dotted
 * segment, and whose literal prefix is one the store splits as a whole Topic.
 * Without the second, the store would read `fleet.abc.contact` as a field of a
 * Topic nobody publishes.
 */
function familyFault(pattern: string): string | undefined {
  const segments = pattern.split(".");
  const malformed = segments.find(
    (segment) =>
      /[<>]/.test(segment) && !/^<[A-Za-z][A-Za-z0-9]*>$/.test(segment),
  );
  if (malformed !== undefined) return `"${malformed}" is not a whole segment`;
  const prefix = pattern.slice(0, pattern.indexOf("<"));
  if (prefix === "") return undefined;
  if (!DYNAMIC_WHOLE_TOPIC_PREFIXES.some((p) => `${prefix}x`.startsWith(p))) {
    return `"${prefix}" is not a registered dynamic prefix`;
  }
  return undefined;
}

describe("widget Topic families are well formed and registered", () => {
  it("rejects a placeholder inside a segment and an unregistered prefix", () => {
    // Positive control: a checker that accepts these reports zero faults for any tree.
    expect(familyFault("fleet.a<x>b.contact")).toBeDefined();
    expect(familyFault("nowhere.<id>.state")).toBeDefined();
    expect(familyFault("fleet.<vessel>.contact")).toBeUndefined();
    expect(familyFault("<domain>.available")).toBeUndefined();
  });

  it("faults no family any built-in widget declares", () => {
    const faults = getComponents().flatMap((def) =>
      [...(def.channelFamilies ?? []), ...(def.optionalChannelFamilies ?? [])]
        .map((pattern) => [pattern, familyFault(pattern)] as const)
        .filter(([, fault]) => fault !== undefined)
        .map(([pattern, fault]) => `${def.id}: ${pattern} (${fault})`),
    );
    expect(faults).toEqual([]);
  });
});
