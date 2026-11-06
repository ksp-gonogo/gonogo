import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONTEXT_KEYS,
  collapseContext,
  EXTRA_CONTEXT_KEY,
} from "./collapseContext.js";
import type { LogEntry } from "./types.js";

function entryWith(context: Record<string, unknown>): LogEntry {
  return {
    level: "info",
    message: "m",
    timestamp: "2026-05-07T00:00:00.000Z",
    context,
  };
}

describe("collapseContext allowlist", () => {
  it("keeps the allowed keys as real fields", () => {
    const out = collapseContext(entryWith({ topic: "vessel.flight", code: 4 }));
    expect(out.context).toEqual({ topic: "vessel.flight", code: 4 });
  });

  it("moves every other key into one extra JSON string", () => {
    const out = collapseContext(
      entryWith({ topic: "t", keyframeWaitMsLongest: 12, pacerCatchUps: 3 }),
    );
    expect(out.context).toEqual({
      topic: "t",
      [EXTRA_CONTEXT_KEY]: JSON.stringify({
        keyframeWaitMsLongest: 12,
        pacerCatchUps: 3,
      }),
    });
  });

  it("adds no extra field when every key is allowed", () => {
    const out = collapseContext(entryWith({ id: "x" }));
    expect(out.context).not.toHaveProperty(EXTRA_CONTEXT_KEY);
  });

  it("keeps the bug_report object whole", () => {
    const bug = { kind: "bug", recentLogs: [{ a: 1 }], screenshot: null };
    const out = collapseContext(entryWith({ bug_report: bug }));
    expect(out.context).toEqual({ bug_report: bug });
  });

  it("survives a value that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = collapseContext(entryWith({ oddity: circular }));
    expect(out.context?.[EXTRA_CONTEXT_KEY]).toBe("[unserialisable]");
  });

  it("holds the allowlist to its set size", () => {
    expect(ALLOWED_CONTEXT_KEYS.size).toBeLessThanOrEqual(25);
  });
});
