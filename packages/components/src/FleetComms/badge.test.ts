import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { commsLinkBadge } from "./badge";

/** The label/tone table of the comms link badge; `panel-badge.test.tsx` proves it reaches the header. */
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

  // `undefined` is an unevaluated Processor dep: "nothing known", never a LINK claim.
  it("treats a not-yet-evaluated processor as unknown, not as a link", () => {
    expect(commsLinkBadge(undefined)).toEqual([
      { id: "fleet-comms-link", label: NULL_DISPLAY, tone: "neutral" },
    ]);
  });
});
