import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { commsLinkBadge, commsLinkState } from "./badge";

/** The label/tone table of the comms link badge; `panel-badge.test.tsx` proves it reaches the header. */
describe("commsLinkBadge", () => {
  it("labels a live link GO-toned", () => {
    expect(commsLinkBadge(true)).toEqual([
      { id: "fleet-comms-link", label: "COMMS LINKED", tone: "go" },
    ]);
  });

  it("labels a positively-reported outage NOGO-toned", () => {
    expect(commsLinkBadge(false)).toEqual([
      { id: "fleet-comms-link", label: "NO COMMS LINK", tone: "nogo" },
    ]);
  });

  it("still shows a badge for an unknown link, carrying the null glyph", () => {
    expect(commsLinkBadge(null)).toEqual([
      {
        id: "fleet-comms-link",
        label: `COMMS ${NULL_DISPLAY}`,
        tone: "neutral",
      },
    ]);
  });

  it("says a link not yet heard from is awaited, which is neither a link nor an outage", () => {
    expect(commsLinkBadge("awaiting")).toEqual([
      {
        id: "fleet-comms-link",
        label: "Awaiting first signal",
        tone: "neutral",
      },
    ]);
  });

  // `undefined` is an unevaluated Processor dep: "nothing known", never a LINK claim.
  it("treats a not-yet-evaluated processor as unknown, not as a link", () => {
    expect(commsLinkBadge(undefined)).toEqual([
      {
        id: "fleet-comms-link",
        label: `COMMS ${NULL_DISPLAY}`,
        tone: "neutral",
      },
    ]);
  });
});

describe("commsLinkState", () => {
  it("awaits a link not yet heard from at a centre that has a route", () => {
    expect(commsLinkState({ state: "pending" } as never)).toBe("awaiting");
  });

  it("reads a link not heard from at a centre with no route as down", () => {
    expect(commsLinkState({ state: "pending" } as never, true)).toBe(false);
  });
});
