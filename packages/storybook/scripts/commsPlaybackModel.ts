/** One keying heard at the ground station, in seconds from Play. */
export interface Keying {
  id: string;
  from: "ares" | "woomera";
  authorName: string;
  /** What the speaker says, for the caption. */
  says: string;
  startAt: number;
  seconds: number;
  /** The signal goes before the keying finishes: nothing after this reaches the ground. */
  cutAt?: number;
}

export interface LinkEdge {
  at: number;
  connected: boolean;
}

/** A link that is down, comes up, is lost in a blackout and returns. */
export const LINK_EDGES: readonly LinkEdge[] = [
  { at: 0, connected: false },
  { at: 1.5, connected: true },
  { at: 9.5, connected: false },
  { at: 14, connected: true },
];

export const KEYINGS: readonly Keying[] = [
  {
    id: "tx-1",
    from: "ares",
    authorName: "Jeb",
    says: "Kennedy, Ares 4. Signal is good, coming up on the burn",
    startAt: 2.4,
    seconds: 2.6,
  },
  {
    id: "tx-2",
    from: "woomera",
    authorName: "Woomera Range",
    says: "Ares, Woomera. We have you, Go for the burn",
    startAt: 5.4,
    seconds: 1.8,
  },
  {
    id: "tx-3",
    from: "ares",
    authorName: "Jeb",
    says: "Copy, ignition in ten, we are losing you behind the",
    startAt: 7.4,
    seconds: 3.4,
    cutAt: 9.5,
  },
  {
    id: "tx-4",
    from: "ares",
    authorName: "Jeb",
    says: "Kennedy, Ares 4, we are back, burn nominal",
    startAt: 14.8,
    seconds: 2.4,
  },
];

/** Playback ends this long after the last keying finishes. */
export const PLAYBACK_SECONDS = 18;

const FADE_START = 7.6;
const ACQUIRE_SECONDS = 1;
const REACQUIRE_SECONDS = 0.8;

export function linkUp(t: number): boolean {
  return LINK_EDGES.filter((e) => e.at <= t).at(-1)?.connected ?? false;
}

/**
 * How well the ground hears the craft: 0 with the link down, rising as it is
 * acquired, falling away across the approach to the blackout.
 */
export function signalQuality(t: number): number {
  if (!linkUp(t)) return 0;
  const up = LINK_EDGES.filter((e) => e.at <= t && e.connected).at(-1)?.at ?? 0;
  const settle = up < 1 ? ACQUIRE_SECONDS : REACQUIRE_SECONDS;
  const rise = Math.min(1, 0.25 + (0.75 * (t - up)) / settle);
  const fade = t < FADE_START ? 1 : Math.max(0.12, 1 - (t - FADE_START) / 2.2);
  return up < 5 ? Math.min(rise, fade) : rise;
}

/** Hiss the receiver puts out, 0 to 1, louder as the signal goes. */
export function staticLevel(t: number): number {
  return 0.05 + 0.5 * (1 - signalQuality(t));
}

/** Where the keying has reached by `t`: nothing before it starts, nothing after its cut. */
export function spokenSeconds(k: Keying, t: number): number {
  const end = Math.min(
    k.startAt + k.seconds,
    k.cutAt ?? Number.POSITIVE_INFINITY,
  );
  return Math.max(0, Math.min(t, end) - k.startAt);
}

export interface SpeechChunk {
  frequencyHz: number;
  amplitudeByte: number;
}

const CHUNK_SECONDS = 0.02;

/**
 * Speech-shaped audio: syllables that swell and fall with a pitch of their
 * own, grouped into words with a short gap between. Built from its index and
 * nothing else, so every run says the same thing.
 */
export function speechChunks(seconds: number, baseHz: number): SpeechChunk[] {
  const total = Math.round(seconds / CHUNK_SECONDS);
  const chunks: SpeechChunk[] = [];
  let syllable = 0;
  while (chunks.length < total) {
    const length = 7 + ((syllable * 5) % 6);
    const pitch = baseHz + 28 * ((syllable * 3) % 7);
    for (let i = 0; i < length && chunks.length < total; i++) {
      const swell = Math.sin((Math.PI * (i + 0.5)) / length);
      chunks.push({
        frequencyHz: Math.round(pitch + 14 * Math.sin(i / 2)),
        amplitudeByte: Math.round(230 * swell),
      });
    }
    syllable += 1;
    const gap = syllable % 4 === 0 ? 8 : 1;
    for (let i = 0; i < gap && chunks.length < total; i++) {
      chunks.push({ frequencyHz: pitch, amplitudeByte: 0 });
    }
  }
  return chunks;
}
