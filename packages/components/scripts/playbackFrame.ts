/** One sample a playback puts on a scene's stream. */
export interface PlaybackEmit {
  channel: string;
  value: unknown;
  meta?: Record<string, unknown>;
}

/**
 * One instant of a played story: the universal time the view clock moves to and
 * the samples the craft would have sent by then, each stamped with that instant.
 */
export interface PlaybackFrame {
  /** Seconds into the story, at its playback rate. */
  seconds: number;
  ut: number;
  emits: PlaybackEmit[];
  /** What the story's clock line reads at this instant. */
  clock: string;
}

/** A sample stamped as received at `ut`, so the view clock sitting there reads it as current. */
export function stampedAt(
  channel: string,
  value: unknown,
  ut: number,
  extra: Record<string, unknown> = {},
): PlaybackEmit {
  return { channel, value, meta: { validAt: ut, deliveredAt: ut, ...extra } };
}

/** The fixture's own emits as the first frame, with `replace` swapping the channels a model drives. */
export function firstScene(
  fixture: { _meta: unknown; _stream: { emits: PlaybackEmit[] } },
  replace: Record<string, unknown>,
  scenario: string,
  pinnedUt: number,
): Record<string, unknown> {
  const emits = fixture._stream.emits.map((e) =>
    e.channel in replace ? { ...e, value: replace[e.channel] } : e,
  );
  return {
    _meta: {
      scenario,
      synthetic: true,
      notes: "SYNTHETIC. The first frame of a model-driven playback.",
    },
    _stream: { pinnedUt, emits },
  };
}
