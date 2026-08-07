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
  it("returns only contributions bound to the requested slot, ordered by ascending priority then registration order", () => {
    registerContribution({
      id: "b",
      contributes: "test.slot",
      priority: 5,
      compute: () => [{ id: "row-b" }],
    });
    registerContribution({
      id: "a",
      contributes: "test.slot",
      priority: 1,
      compute: () => [{ id: "row-a" }],
    });
    registerContribution({
      id: "other",
      contributes: "test.other-slot",
      compute: () => [{ id: "row-other" }],
    });

    const result = getContributionsForSlot("test.slot");
    expect(result.map((d) => d.id)).toEqual(["a", "b"]);
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
