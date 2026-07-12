import type { LogEntry } from "@ksp-gonogo/logger";
import { describe, expect, it } from "vitest";
import { recentLogsWindow } from "./recentLogsWindow";

function entry(timestamp: string): LogEntry {
  return { level: "info", message: "x", timestamp };
}

describe("recentLogsWindow", () => {
  const now = Date.parse("2026-05-12T12:00:00.000Z");

  it("returns the full buffer when windowMinutes is null", () => {
    const buf = [
      entry("2026-05-12T11:00:00.000Z"),
      entry("2026-05-12T11:30:00.000Z"),
    ];
    expect(recentLogsWindow(buf, null, now)).toBe(buf);
  });

  it("returns an empty array for an empty buffer", () => {
    expect(recentLogsWindow([], 5, now)).toEqual([]);
  });

  it("filters out entries older than the window", () => {
    const inside = entry("2026-05-12T11:58:00.000Z");
    const outside = entry("2026-05-12T11:50:00.000Z");
    const out = recentLogsWindow([outside, inside], 5, now);
    expect(out).toEqual([inside]);
  });

  it("treats the cutoff timestamp as inside the window", () => {
    const onCutoff = entry("2026-05-12T11:55:00.000Z");
    expect(recentLogsWindow([onCutoff], 5, now)).toEqual([onCutoff]);
  });

  it("drops entries with unparseable timestamps", () => {
    const good = entry("2026-05-12T11:59:00.000Z");
    const bad = entry("not-a-date");
    expect(recentLogsWindow([good, bad], 5, now)).toEqual([good]);
  });

  it("returns nothing when every entry is outside the window", () => {
    const buf = [
      entry("2026-05-12T10:00:00.000Z"),
      entry("2026-05-12T10:30:00.000Z"),
    ];
    expect(recentLogsWindow(buf, 15, now)).toEqual([]);
  });
});
