import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { commsLinkBadge } from "./badge";

/**
 * The pure half of the comms link badge. `panel-badge.test.tsx` proves the
 * contribution actually reaches SystemView's header; this file only pins the
 * label/tone table, including the tone folding that has to match what the
 * augment's `Badge severity=` used to ask for (`go` -> nominal,
 * `nogo` -> critical, `neutral` -> no severity at all).
 */
describe("commsLinkBadge", () => {
  it("labels a live link GO-toned", () => {
    expect(commsLinkBadge(true)).toEqual([
      { id: "fleet-comms-link", label: "LINK", tone: "go" },
    ]);
  });

  it("labels a positively-reported outage NOGO-toned", () => {
    expect(commsLinkBadge(false)).toEqual([
      { id: "fleet-comms-link", label: "NO LINK", tone: "nogo" },
    ]);
  });

  it("still shows a badge for an unknown link, carrying the null glyph", () => {
    expect(commsLinkBadge(null)).toEqual([
      { id: "fleet-comms-link", label: NULL_DISPLAY, tone: "neutral" },
    ]);
  });

  // The aggregation hands `undefined` for a Processor dep it has not evaluated
  // yet, which is the same "nothing known" the null arm covers: it must not
  // fall through to a LINK claim.
  it("treats a not-yet-evaluated processor as unknown, not as a link", () => {
    expect(commsLinkBadge(undefined)).toEqual([
      { id: "fleet-comms-link", label: NULL_DISPLAY, tone: "neutral" },
    ]);
  });
});
