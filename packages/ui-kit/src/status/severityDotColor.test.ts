import { describe, expect, it } from "vitest";
import type { Severity } from "./severity";
import { severityDotColor } from "./severityDotColor";

/**
 * The single saturated fill each `Severity` reads as on a panel surface: the
 * title ghost's dot and (for the severities where it is the same colour)
 * Badge's chip both read off this one function, so the two stop being two
 * hand-kept-in-step maps that can silently drift apart.
 */
describe("severityDotColor", () => {
  it("returns the exact token each severity mapped to before the extraction", () => {
    const expected: Record<Severity, string> = {
      nominal: "var(--color-status-go-bg)",
      info: "var(--color-status-info-fg)",
      caution: "var(--color-status-warning-fg-muted)",
      warning: "var(--color-status-warning-bg)",
      critical: "var(--color-status-nogo-bg)",
      offline: "var(--color-text-dim)",
    };
    for (const severity of Object.keys(expected) as Severity[]) {
      expect(severityDotColor(severity)).toBe(expected[severity]);
    }
  });

  it("returns a css var() reference for every severity, never a bare literal", () => {
    const severities: Severity[] = [
      "nominal",
      "info",
      "caution",
      "warning",
      "critical",
      "offline",
    ];
    for (const severity of severities) {
      expect(severityDotColor(severity)).toMatch(/^var\(--color-/);
    }
  });
});
