/** A controllable wall clock — advanced explicitly by a test/driver instead of racing real time. */
export interface FakeWallClock {
  now: () => number;
  advanceBy: (seconds: number) => void;
}

/**
 * Promotes the `fakeWall` idiom duplicated across several sitrep-client
 * tests (`reference-wire-fixture.test.ts`, `timeline-store-status.test.ts`,
 * `timeline-store.test.ts`) to a reusable, EXPORTED helper — the
 * `m3-migration-plan.md` §4-test test-adapter's "FixedViewClock" pattern
 * (`new ViewClock({ nowWall: wall.now, warpRate: () => 1, delaySeconds: ()
 * => 0 })`, then `clock.scrubTo(fixtureUt)`) needs a `nowWall` function from
 * OUTSIDE this package (`@gonogo/components`' `setupStreamFixture`), and
 * there was no exported version to reuse before this.
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
