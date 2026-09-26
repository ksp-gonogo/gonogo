import { describe, expect, it } from "vitest";
import { groupBaseLayersByUplink } from "./orderBaseLayers";

describe("groupBaseLayersByUplink", () => {
  it("returns an empty list unchanged", () => {
    expect(groupBaseLayersByUplink([])).toEqual([]);
  });

  it("returns a single augment unchanged", () => {
    const solo = [{ id: "only" }];
    expect(groupBaseLayersByUplink(solo)).toEqual(solo);
  });

  it("keeps two augments from the same Uplink in their given (priority) order", () => {
    const input = [
      { id: "layer-a", requires: "uplink-1" },
      { id: "layer-b", requires: "uplink-1" },
    ];
    expect(groupBaseLayersByUplink(input)).toEqual(input);
  });

  it("clusters an interleaved priority-sorted list by Uplink, preserving each cluster's relative order", () => {
    // A global priority sort interleaves uplink-1's two layers around uplink-2's one.
    const a1 = { id: "a1", requires: "uplink-1" };
    const b1 = { id: "b1", requires: "uplink-2" };
    const a2 = { id: "a2", requires: "uplink-1" };
    const input = [a1, b1, a2];

    // uplink-1's cluster keeps its order at its first member's position; b1 follows.
    expect(groupBaseLayersByUplink(input)).toEqual([a1, a2, b1]);
  });

  it("groups an augment with no `requires` into its own singleton group, keyed by its own id", () => {
    const noDomain1 = { id: "solo-1" };
    const grouped = { id: "grouped", requires: "uplink-1" };
    const noDomain2 = { id: "solo-2" };
    const input = [noDomain1, grouped, noDomain2];

    // Each ungated augment is its own group, so this input is unchanged, through the fallback key path.
    expect(groupBaseLayersByUplink(input)).toEqual(input);
  });

  it("preserves first-occurrence group order across three Uplinks", () => {
    const c1 = { id: "c1", requires: "uplink-c" };
    const a1 = { id: "a1", requires: "uplink-a" };
    const b1 = { id: "b1", requires: "uplink-b" };
    const a2 = { id: "a2", requires: "uplink-a" };
    const c2 = { id: "c2", requires: "uplink-c" };
    const input = [c1, a1, b1, a2, c2];

    expect(groupBaseLayersByUplink(input)).toEqual([c1, c2, a1, a2, b1]);
  });
});
