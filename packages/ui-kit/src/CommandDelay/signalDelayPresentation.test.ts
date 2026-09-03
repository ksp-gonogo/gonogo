import { currentMode, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  SIGNAL_DELAY_STRIP_THRESHOLD_SECONDS,
  signalDelayPresentation,
} from "./signalDelayPresentation";

describe("signalDelayPresentation", () => {
  it("shows nothing when there is no measurable path", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: null, canQueue: true }),
    ).toBe("none");
  });

  it("shows nothing on a link with no delay to report", () => {
    // 0 is a real reading, not an absence: a dashboard at the pad. A chip
    // saying "one-way ~0 s" is noise, and neither is there anything to count.
    expect(signalDelayPresentation({ oneWaySeconds: 0, canQueue: true })).toBe(
      "none",
    );
  });

  it("badges a delay too short to count down", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: 0.4, canQueue: true }),
    ).toBe("badge");
  });

  it("hands a long delay to the strip", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: 240, canQueue: true }),
    ).toBe("strip");
  });

  it("never asks for both", () => {
    // The property the whole function exists for: one reading of the delay,
    // never two shapes of the same number on one console.
    for (const oneWaySeconds of [0.01, 0.5, 1, 1.001, 12, 240, 4000]) {
      for (const canQueue of [true, false]) {
        for (const alwaysBadge of [true, false]) {
          const got = signalDelayPresentation({
            oneWaySeconds,
            canQueue,
            alwaysBadge,
          });
          expect(["badge", "strip", "none"]).toContain(got);
        }
      }
    }
  });

  it("gives a read-only viewer neither reading at a long delay", () => {
    // It dispatches nothing, so there is no queue to draw, and a standing badge
    // would quote a cost it never pays.
    expect(
      signalDelayPresentation({ oneWaySeconds: 240, canQueue: false }),
    ).toBe("none");
  });

  it("badges at any magnitude when the console cannot queue at all", () => {
    // Character-mode terminal: every keystroke goes on its own, so there is no
    // composed line for a strip to list however far away the craft is.
    expect(
      signalDelayPresentation({
        oneWaySeconds: 240,
        canQueue: true,
        alwaysBadge: true,
      }),
    ).toBe("badge");
  });

  it("switches on the same boundary the engine stages a dispatch at", () => {
    /*
     * The threshold is a local literal (the sdk does not export its own), so
     * this is what stops the two drifting apart: a badge shown while the engine
     * has already staged the dispatch would sit beside a strip drawing the same
     * number.
     */
    const below = SIGNAL_DELAY_STRIP_THRESHOLD_SECONDS;
    const above = SIGNAL_DELAY_STRIP_THRESHOLD_SECONDS + 0.001;
    expect(currentMode({ oneWaySeconds: value("s", below) })).toBe("live");
    expect(currentMode({ oneWaySeconds: value("s", above) })).toBe("staged");
    expect(
      signalDelayPresentation({ oneWaySeconds: below, canQueue: true }),
    ).toBe("badge");
    expect(
      signalDelayPresentation({ oneWaySeconds: above, canQueue: true }),
    ).toBe("strip");
  });
});
