import { describe, expect, it } from "vitest";
import { PUBLISHED_TOPIC_IDS } from "../topics";
import { CORE_PUBLISHED_PROCESSORS } from "./context";

/**
 * `PUBLISHED_TOPIC_IDS` is the type-level name for what
 * `CORE_PUBLISHED_PROCESSORS` registers, and the two are declared in
 * different files because the union has to live somewhere the api types can
 * import without pulling the spine in behind it.
 *
 * That separation is the whole risk. The list cannot be derived from the array:
 * `CORE_PUBLISHED_PROCESSORS` is typed `PublishedProcessorDefinition[]` and a
 * definition's `topic` is a plain `string`,
 * so every literal is erased before a type could read it. Nothing about a
 * hand-written union fails on its own when the array moves.
 *
 * So it is checked both ways. A channel registered but unlisted would be a
 * channel no widget can declare, which reads as "that widget cannot be
 * migrated" rather than as a missing entry. A channel listed but unregistered
 * would typecheck in a `channels` array and then resolve to nothing at runtime,
 * which is the silent-`undefined` failure the typed vocabulary exists to
 * remove. Neither is visible from the other file.
 */
describe("the published-processor union matches what is registered", () => {
  const registered = CORE_PUBLISHED_PROCESSORS.map((c) => c.topic).sort();
  const declared = [...PUBLISHED_TOPIC_IDS].sort();

  it("lists every registered production published processor", () => {
    expect(declared).toEqual(registered);
  });

  it("found a non-trivial number of channels (scan sanity check)", () => {
    // An empty array on both sides would satisfy the assertion above while checking nothing, which is how a set-equality gate passes vacuously.
    expect(registered.length).toBeGreaterThan(4);
  });

  it("declares no duplicates", () => {
    expect(new Set(declared).size).toBe(declared.length);
  });
});
