/**
 * A wall clock a test moves forward itself, rather than waiting on real time.
 *
 * @category Test doubles
 */
export interface FakeWallClock {
  now: () => number;
  advanceBy: (seconds: number) => void;
}

/**
 * A {@link FakeWallClock} starting at `start` milliseconds. Pass its `now` as a
 * clock's `nowWall`.
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
