import {
  FLIGHT_FIXTURE_FORMAT,
  type FlightChapter,
  type FlightFixture,
} from "./FlightFixture";

export interface ClipFixtureOptions {
  /**
   * Re-anchor the clipped fixture so its `flight.launchedAt` lines up with
   * the chapter's `startMs`. Default `true` — most callers want the clip
   * to play back as a self-contained fixture starting at t=0. Set `false`
   * to keep absolute timestamps (useful when comparing samples across
   * sibling chapters of the same recording).
   */
  rebaseToStart?: boolean;
}

/**
 * Slice a fixture to a single chapter's window. Returns a new fixture
 * containing only the samples whose absolute t falls within
 * `[launchedAt + chapter.startMs, launchedAt + chapter.endMs]`. The
 * original fixture is not mutated.
 *
 * By default the resulting fixture is **rebased** so its `launchedAt`
 * lines up with the chapter's start — meaning the clip plays back as a
 * standalone flight starting at t=0 (elapsed). Pass
 * `{ rebaseToStart: false }` to preserve absolute timestamps.
 *
 * Throws when the chapter id isn't found rather than silently returning
 * an empty fixture — that's almost always a typo, not intent.
 */
export function clipFixture(
  fixture: FlightFixture,
  chapterId: string,
  opts: ClipFixtureOptions = {},
): FlightFixture {
  const chapter = fixture.chapters?.find((c) => c.id === chapterId);
  if (!chapter) {
    throw new Error(
      `Chapter "${chapterId}" not found in fixture "${fixture.flight.id}"`,
    );
  }
  const rebase = opts.rebaseToStart ?? true;
  const absStart = fixture.flight.launchedAt + chapter.startMs;
  const absEnd = fixture.flight.launchedAt + chapter.endMs;
  const offset = rebase ? absStart : 0;

  let lastSampleAt = rebase ? 0 : absStart;
  let sampleCount = 0;
  const samples: Record<string, [number, unknown][]> = {};

  for (const [key, series] of Object.entries(fixture.samples)) {
    const slice: [number, unknown][] = [];
    for (const [t, v] of series) {
      if (t < absStart) continue;
      if (t > absEnd) break;
      const newT = t - offset;
      slice.push([newT, v]);
      if (newT > lastSampleAt) lastSampleAt = newT;
    }
    if (slice.length > 0) {
      samples[key] = slice;
      sampleCount += slice.length;
    }
  }

  // Adjust chapter windows for the rebased frame so they remain meaningful
  // when the caller wants to know "where the original clip sat". The clipped
  // chapter itself collapses to [0, endMs - startMs] (rebased) or its
  // original window (absolute).
  const clippedChapter: FlightChapter = rebase
    ? { ...chapter, startMs: 0, endMs: chapter.endMs - chapter.startMs }
    : chapter;

  return {
    format: FLIGHT_FIXTURE_FORMAT,
    flight: {
      ...fixture.flight,
      id: `${fixture.flight.id}#${chapterId}`,
      launchedAt: rebase ? absStart : fixture.flight.launchedAt,
      lastSampleAt: rebase ? absStart + lastSampleAt : lastSampleAt,
      sampleCount,
    },
    schema: fixture.schema,
    samples,
    chapters: [clippedChapter],
  };
}
