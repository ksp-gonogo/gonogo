import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach } from "vitest";

/** A game clock a test moves by hand, as the host's view clock reports it. */
export interface TestGameClock {
  /** Let `seconds` of game time pass. */
  advance(seconds: number): void;
}

/**
 * Gives every test in the file a host whose view clock is a game clock the
 * test advances itself, starting at UT 0. Game time passes only when the test
 * says so, whatever the wall clock or fake timers do.
 */
export function installTestGameClock(): TestGameClock {
  let ut = 0;
  let remove: (() => void) | undefined;
  beforeEach(() => {
    ut = 0;
    remove = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => ut,
        confirmedEdgeUt: () => ut,
        onFrame: () => () => {},
      }),
    });
  });
  afterEach(() => {
    remove?.();
    remove = undefined;
  });
  return {
    advance(seconds: number) {
      ut += seconds;
    },
  };
}
