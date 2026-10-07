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
 * A {@link FakeWallClock} that reads `start` seconds until it is advanced.
 * Pass its `now` wherever a clock takes `nowWall`, which is in seconds too.
 *
 * @category Test doubles
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
