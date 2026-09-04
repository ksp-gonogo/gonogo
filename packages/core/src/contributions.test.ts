import { clearProcessors, defineProcessor } from "@ksp-gonogo/sitrep-client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ContributionDefinition,
  clearContributions,
  getContributionSettings,
  getContributionsForSlot,
  onContributionsChange,
  registerContribution,
} from "./contributions";

beforeEach(() => clearContributions());

describe("registerContribution / getContributionsForSlot", () => {
  it("returns only contributions bound to the requested slot", () => {
    registerContribution({
      id: "b",
      contributes: "test.slot",
      compute: () => [{ id: "row-b" }],
    });
    registerContribution({
      id: "a",
      contributes: "test.slot",
      compute: () => [{ id: "row-a" }],
    });
    registerContribution({
      id: "other",
      contributes: "test.other-slot",
      compute: () => [{ id: "row-other" }],
    });

    const result = getContributionsForSlot("test.slot");
    expect(result.map((d) => d.id)).toEqual(["b", "a"]);
  });

  /**
   * The whole point of the band. A host widget contributes its own stock answer
   * at 0, so anything registered without a priority takes the slot over rather
   * than appearing beside it as a second copy of the same list.
   */
  it("gives the slot to the highest band present and drops the rest", () => {
    registerContribution({
      id: "host",
      contributes: "test.slot",
      priority: 0,
      compute: () => [{ id: "stock" }],
    });
    registerContribution({
      id: "guest",
      contributes: "test.slot",
      compute: () => [{ id: "guest" }],
    });

    expect(getContributionsForSlot("test.slot").map((d) => d.id)).toEqual([
      "guest",
    ]);
  });

  /**
   * An equal priority is not a tie to break. Two mutually-unaware mods at the
   * default both draw, and neither can silence the other.
   */
  it("keeps every contribution sharing the winning band, in registration order", () => {
    registerContribution({
      id: "second",
      contributes: "test.slot",
      priority: 3,
      compute: () => [{ id: "second" }],
    });
    registerContribution({
      id: "first",
      contributes: "test.slot",
      priority: 3,
      compute: () => [{ id: "first" }],
    });
    registerContribution({
      id: "outranked",
      contributes: "test.slot",
      priority: 2,
      compute: () => [{ id: "outranked" }],
    });

    expect(getContributionsForSlot("test.slot").map((d) => d.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("throws on a genuine id collision (a different def re-using an id), but is a no-op for the exact same def re-registering", () => {
    const def: ContributionDefinition<"test.slot"> = {
      id: "dup",
      contributes: "test.slot",
      compute: () => null,
    };
    registerContribution(def);
    expect(() => registerContribution(def)).not.toThrow();
    expect(() =>
      registerContribution({
        id: "dup",
        contributes: "test.slot",
        compute: () => null,
      }),
    ).toThrow(/already registered/);
  });

  it("notifies onContributionsChange listeners on register and on clear", () => {
    let calls = 0;
    const unsubscribe = onContributionsChange(() => {
      calls++;
    });
    registerContribution({
      id: "x",
      contributes: "test.slot",
      compute: () => null,
    });
    expect(calls).toBe(1);
    clearContributions();
    expect(calls).toBe(2);
    unsubscribe();
  });
});

describe("getContributionSettings", () => {
  it("returns one namespaced block per contribution that declares settings, skipping those that don't", () => {
    registerContribution({
      id: "with-settings",
      contributes: "test.slot",
      settings: [{ key: "showExtra", type: "boolean", default: false }],
      compute: () => null,
    });
    registerContribution({
      id: "no-settings",
      contributes: "test.slot",
      compute: () => null,
    });

    const settings = getContributionSettings("test.slot");
    expect(settings).toEqual([
      {
        augmentId: "with-settings",
        namespace: "with-settings",
        fields: [{ key: "showExtra", type: "boolean", default: false }],
      },
    ]);
  });
});

describe("ContributionDefinition.deps accepting a ProcessorHandle", () => {
  beforeEach(() => clearProcessors());

  it("type-checks and registers a contribution whose deps mixes a TopicId and a ProcessorHandle", () => {
    const processor = defineProcessor({
      id: "fixture-processor",
      owner: "core",
      deps: [] as const,
      compute: () => 1,
    });

    // Compile-time proof: registering must not error at the type level now
    // that `deps` accepts `Dep`, not just `TopicId`.
    registerContribution({
      id: "mixed-deps",
      contributes: "test.slot",
      deps: ["vessel.orbit", processor],
      compute: () => null,
    });

    expect(getContributionsForSlot("test.slot")[0].id).toBe("mixed-deps");
  });
});
