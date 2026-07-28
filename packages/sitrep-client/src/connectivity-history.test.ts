import { describe, expect, it } from "vitest";
import { ConnectivityHistory } from "./connectivity-history";

describe("ConnectivityHistory", () => {
  it("no observation reads as connected (unknown = connected)", () => {
    const h = new ConnectivityHistory();
    expect(h.connectedDuring(0, 10)).toBe(true);
  });

  it("stays connected across a window with no disconnect", () => {
    const h = new ConnectivityHistory();
    h.record(0, true);
    h.record(10, true); // no-op, state unchanged
    expect(h.connectedDuring(0, 10)).toBe(true);
  });

  it("a disconnect INSIDE the window fails connectedDuring", () => {
    const h = new ConnectivityHistory();
    h.record(0, true);
    h.record(5, false);
    expect(h.connectedDuring(0, 10)).toBe(false);
  });

  it("a disconnect BEFORE the window that recovers before it starts does not fail", () => {
    const h = new ConnectivityHistory();
    h.record(0, false);
    h.record(2, true);
    expect(h.connectedDuring(4, 10)).toBe(true);
  });

  it("a disconnect AFTER the window does not fail it", () => {
    const h = new ConnectivityHistory();
    h.record(0, true);
    h.record(20, false);
    expect(h.connectedDuring(0, 10)).toBe(true);
  });

  it("disconnected AT the window's start fails it", () => {
    const h = new ConnectivityHistory();
    h.record(0, false);
    expect(h.connectedDuring(0, 10)).toBe(false);
  });

  it("prune drops transitions strictly before the cutoff, keeping the state answer stable", () => {
    const h = new ConnectivityHistory();
    h.record(0, true);
    h.record(5, false);
    h.record(8, true);
    h.prune(6);
    // The window [7,10] no longer has direct visibility into the [0,5]
    // segment, but the state AT 6 (disconnected until 8) must still answer
    // correctly off what prune retained.
    expect(h.connectedDuring(7, 10)).toBe(false);
  });
});
