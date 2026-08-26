/** A controllable wall clock: advanced explicitly by a test/driver instead of racing real time. */
export interface FakeWallClock {
  now: () => number;
  advanceBy: (seconds: number) => void;
}

/**
 * The `fakeWall` idiom several sitrep-client tests need
 * (`reference-wire-fixture.test.ts`, `timeline-store-status.test.ts`,
 * `timeline-store.test.ts`), as one EXPORTED helper rather than a copy per
 * file. Exported because the fixed-clock test pattern (`new ViewClock({
 * nowWall: wall.now, warpRate: () => 1, delaySeconds: () => 0 })`, then
 * `clock.scrubTo(fixtureUt)`) needs a `nowWall` function from OUTSIDE this
 * package, e.g. `@ksp-gonogo/components`' `setupStreamFixture`.
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
