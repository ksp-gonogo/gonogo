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
    // Simulates getAugmentsForSlot's global priority sort interleaving two
    // Uplinks' layers: uplink-1's two layers (a1, a2) straddle uplink-2's
    // single layer (b1) because their priority numbers happen to interleave.
    const a1 = { id: "a1", requires: "uplink-1" };
    const b1 = { id: "b1", requires: "uplink-2" };
    const a2 = { id: "a2", requires: "uplink-1" };
    const input = [a1, b1, a2];

    // uplink-1's cluster (a1, a2) keeps its relative order and occupies the
    // position of its first member (index 0); uplink-2's b1 follows.
    expect(groupBaseLayersByUplink(input)).toEqual([a1, a2, b1]);
  });

  it("groups an augment with no `requires` into its own singleton group, keyed by its own id", () => {
    const noDomain1 = { id: "solo-1" };
    const grouped = { id: "grouped", requires: "uplink-1" };
    const noDomain2 = { id: "solo-2" };
    const input = [noDomain1, grouped, noDomain2];

    // No two ungated augments share an id, so each stays its own group —
    // net effect on this input is a no-op, but proves the fallback key path.
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
