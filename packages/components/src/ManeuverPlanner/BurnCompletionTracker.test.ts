import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import {
  COMPLETED_THRESHOLD_DV,
  type CompletedEntry,
  computeCompletionUpdate,
} from "./BurnCompletionTracker";

function node(
  partial: Partial<ParsedManeuverNode> & {
    UT: number;
    deltaVMagnitude: number;
  },
): ParsedManeuverNode {
  return {
    id: 0,
    UT: partial.UT,
    deltaV: [partial.deltaVMagnitude, 0, 0],
    deltaVMagnitude: partial.deltaVMagnitude,
    ...partial,
  } as ParsedManeuverNode;
}

describe("computeCompletionUpdate", () => {
  it("does nothing when no node has crossed below the threshold", () => {
    const current = new Map<number, CompletedEntry>();
    const max = new Map<number, number>();
    const result = computeCompletionUpdate(
      current,
      [node({ UT: 100, deltaVMagnitude: 30 })],
      max,
      1000,
    );
    // Same reference back — no transitions.
    expect(result).toBe(current);
    expect(max.get(100)).toBe(30);
  });

  it("marks a node complete the first time its ΔV crosses below threshold", () => {
    const current = new Map<number, CompletedEntry>();
    const max = new Map<number, number>();
    // Tick 1: 30 m/s — establishes max above threshold.
    computeCompletionUpdate(
      current,
      [node({ UT: 100, deltaVMagnitude: 30 })],
      max,
      1000,
    );
    // Tick 2: drops to 0.1 — should mark complete.
    const completed = node({ UT: 100, deltaVMagnitude: 0.1 });
    const result = computeCompletionUpdate(current, [completed], max, 2000);
    expect(result).not.toBe(current);
    expect(result.get(100)).toEqual({
      snapshot: completed,
      completedAt: 2000,
    });
  });

  it("does not mark a freshly-planned tiny correction burn as complete", () => {
    // Node arrives below the threshold from the start — never observed above.
    // Should not be treated as a completion.
    const current = new Map<number, CompletedEntry>();
    const max = new Map<number, number>();
    const result = computeCompletionUpdate(
      current,
      [node({ UT: 100, deltaVMagnitude: 0.1 })],
      max,
      1000,
    );
    expect(result).toBe(current);
  });

  it("uses UT as the stable key across KSP renumbering", () => {
    const current = new Map<number, CompletedEntry>();
    const max = new Map<number, number>();
    // First tick: node at UT=100 with id=0.
    computeCompletionUpdate(
      current,
      [node({ id: 0, UT: 100, deltaVMagnitude: 30 })],
      max,
      1000,
    );
    // Second tick: same UT, but KSP renumbered id to 1 after another removal.
    const renumbered = node({ id: 1, UT: 100, deltaVMagnitude: 0.1 });
    const result = computeCompletionUpdate(current, [renumbered], max, 2000);
    expect(result.get(100)?.snapshot.id).toBe(1);
  });

  it("respects the threshold parameter", () => {
    const current = new Map<number, CompletedEntry>();
    const max = new Map<number, number>();
    computeCompletionUpdate(
      current,
      [node({ UT: 100, deltaVMagnitude: 5 })],
      max,
      1000,
      2,
    );
    const result = computeCompletionUpdate(
      current,
      [node({ UT: 100, deltaVMagnitude: 1 })],
      max,
      2000,
      2,
    );
    expect(result.get(100)).toBeDefined();
  });

  it("exports the expected default threshold", () => {
    expect(COMPLETED_THRESHOLD_DV).toBe(0.5);
  });
});
