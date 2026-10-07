/**
 * A wall clock a test moves forward itself, rather than waiting on real time.
 *
 * @category Test doubles
 */
export interface FakeWallClock {
  /** The clock's reading, in seconds. */
  now: () => number;
  /** Moves the clock forward by `seconds`. Zero or a negative number is ignored: the clock never goes back. */
  advanceBy: (seconds: number) => void;
}

/**
 * A {@link FakeWallClock} that reads `start` seconds, 0 when omitted, until it
 * is advanced. Pass its `now` wherever a clock takes `nowWall`, the real time
 * in seconds: the view clock's options and a media pipeline's
 * `tickPacing(nowWall)` take one.
 *
 * @category Test doubles
 * @categoryDescription Test doubles
 * Stand-ins for the wall clock, storage, the logger, data sources and alarm
 * requests, so a test decides what a widget sees and can read back what it
 * asked for.
 */
export function createFakeWallClock(start = 0): FakeWallClock {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      if (seconds > 0) now += seconds;
    },
  };
}
