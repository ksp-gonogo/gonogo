import {
  DEFAULT_MAX_BUFFERED_BYTES,
  type DelayClockLike,
  DelayedPlayoutBuffer,
  PresentationPacer,
} from "@ksp-gonogo/sitrep-sdk/media";
import {
  type SeparationMatrix,
  separationBetween,
  transitSecondsOf,
  type Vantage,
} from "../reveal";
import type { RecipientId } from "../types";
import type { RadioFrame, RadioTransmission } from "./wire";
import { recordRadioFrame } from "./wire";

/**
 * The listening half of the radio: chunks off the wire, held until the light
 * has had time to cross, then decoded and played at natural rate.
 *
 * ONE delay mechanism at every distance, and a `DelayNode` is not it. The 180 s
 * cap is real and is not the reason: a `DelayNode` delays in WALL seconds while
 * the mission delay is a UT quantity that moves under warp, quickload and
 * revert. `DelayedPlayoutBuffer` releases on a clock COMPARISON instead, so a
 * revert moves the clock and every held chunk with it. Sub-180 s and
 * twenty-two minutes are therefore the same code path, with nothing to choose
 * between and nothing to get wrong at the boundary.
 *
 * The clock this is handed is the reader's OWN present (`utNowEstimate()`), not
 * their `confirmedEdgeUt()`, the same choice `useCommcastFeed` documents at
 * length: a video frame carries a capture UT from the craft's past and is
 * rightly released against the delayed edge, while a human speaking carries a
 * UT minted at their own present, and releasing that against the confirmed edge
 * would hold every word for `spokenUt + 2S`, a round trip for a one-way
 * crossing.
 *
 * **A cut is silence and nothing else.** No path from the transmitter's vantage
 * to this one means the chunks are dropped and NOTHING is drawn, announced or
 * counted here. A listener told "somebody is transmitting and you cannot hear
 * them" would be reading a faster-than-light channel, which is precisely what
 * the delay model exists to prevent; the transmitter learns through the absence
 * of acknowledgement, which is their own surface. That is why this class has no
 * cut reading, and why adding one later would be a defect rather than a
 * feature.
 */

/** Where decoded audio goes. Injected, so the delay logic is testable without an
 *  `AudioContext`, a worklet or a real output device. */
export interface RadioAudioSink {
  /** Queue mono PCM for playback at natural rate, in arrival order. */
  play(samples: Float32Array, sampleRate: number): void;
  close(): void;
}

/** The decode step, already wired to whatever sink it writes into. */
export interface RadioDecoderLike {
  decode(bytes: Uint8Array, timestampMicros: number): void;
  /**
   * Start a fresh stream. A new keying is not a continuation of the last one,
   * and feeding one decoder two transmissions back to back makes it interpret
   * the second against the first's state.
   */
  reset(): void;
  close(): void;
}

/** What a screen can honestly say about what it is hearing. */
export interface RadioReception {
  /** Who is being played here right now, or `null` for silence. */
  playing: {
    transmissionId: string;
    from: RecipientId;
    authorName: string;
  } | null;
  /**
   * Seconds of audio the delay clock has released and playback has not yet
   * reached.
   *
   * This is the warp caveat made visible. The pacer measures the rate chunks
   * are arriving at and follows it, but only inside a band that a separation
   * rate lives in and a time warp does not, so above 1x the release edge
   * outruns natural playback and this number climbs. Radio is a warp-1 medium:
   * two people cannot hold a conversation at 100,000x, and the design plays at
   * natural rate and reports the backlog rather than pretending otherwise.
   *
   * Under a CHANGING separation it stays near zero, which is the whole point of
   * the pacer's rate term: a listener closing on the transmitter is handed
   * chunks faster than the 20 ms grid they were spoken on, and a feed that
   * ignored that would climb here for the length of the transmission and never
   * come back down.
   */
  backlogSeconds: number;
  /** Chunks discarded without being played: the buffer cap, or the pacer
   *  snapping past a backlog. Each one costs 20 ms and nothing downstream. */
  droppedChunks: number;
}

const EMPTY_RECEPTION: RadioReception = {
  playing: null,
  backlogSeconds: 0,
  droppedChunks: 0,
};

/** One chunk on its way to the speakers, once the clock has let it through. */
interface HeldChunk {
  transmissionId: string;
  seq: number;
  bytes: Uint8Array;
}

/** A transmission this screen is placing chunks against. */
interface HeardTransmission {
  transmission: RadioTransmission;
  /**
   * The separation resolved ONCE, at the `start` frame, and never re-read.
   *
   * Frozen for the same reason the transmitter froze its own: a separation that
   * moved between chunks would move their release instants independently across
   * the 20 ms grid, jittering the playout and, on a shrinking separation,
   * reordering syllables inside a word.
   *
   * A separation that is CHANGING is still answered for, and not here. That is
   * a RATE, a different quantity from this offset, and it is measured downstream
   * by the pacer from the cadence chunks actually arrive at. Unfreezing this
   * would buy the same honesty back at the price the freeze was paid to avoid.
   */
  transitSeconds: number;
  /**
   * This keying's own release pacer.
   *
   * ONE PER TRANSMISSION, not one for the channel, and the reason is how the
   * pacer spaces: by the UT deltas between the frames it holds. Within one
   * keying that is exactly right, the deltas being the 20 ms grid. ACROSS two
   * keyings it is not: a gap of a minute between two things somebody said would
   * make the second wait a minute of wall time before its first word, which is
   * silence nobody asked for. A keying is one continuous stream and pacing
   * belongs to it.
   *
   * It is also the scope the playout RATE is measured over, and the same
   * boundary is right for that: the rate is a property of one crossing, and a
   * conversational gap carries no information about it at all.
   */
  pacer: PresentationPacer<HeldChunk>;
  /** Chunks accepted here and not yet played, dropped or skipped. */
  inflight: number;
  /**
   * Key-up has been heard. The envelope is kept anyway until the audio it
   * describes has finished playing: `end` travels at the speed of the internet
   * while the words it ends are still crossing the light-time, so forgetting
   * the transmission on arrival would silence the name of whoever is still
   * mid-sentence in the operator's ear.
   */
  ended: boolean;
}

export interface RadioSessionOptions {
  /**
   * The delay clock, whose `confirmedEdgeUt()` MUST return the reader's own
   * `utNowEstimate()`. See the class doc: the confirmed edge would hold a
   * spoken word for a round trip.
   */
  view: DelayClockLike;
  decoder: RadioDecoderLike;
  /** Wall-clock seconds, for pacing. Injected so a test can drive it. */
  nowWall?: () => number;
  /**
   * Beyond this much wall backlog the pacer stops draining in slow motion and
   * snaps to the newest chunk it holds. A quarter second is roughly a syllable:
   * long enough that ordinary jitter never trips it, short enough that a
   * listener never accrues a growing lag behind the person speaking.
   */
  maxBacklogSeconds?: number;
  /**
   * The cap, in bytes of held audio. 8 MB is over half an hour at the measured
   * 4.3 kB/s, longer than any light-time in the stock or RSS systems, and it is
   * the same figure the encoded video path already uses.
   *
   * Commcast's text buffer is uncapped on the argument that words must never be
   * dropped for bytes. Audio cannot follow it: a stuck transmit key is
   * unbounded, and a tab that grows without limit stops playing anybody at all.
   */
  maxBufferedBytes?: number;
  /** Seconds of audio one chunk carries: the 20 ms Opus grid. */
  chunkSeconds?: number;
}

export class RadioSession {
  private readonly buffer: DelayedPlayoutBuffer<HeldChunk>;
  private readonly heard = new Map<string, HeardTransmission>();
  private readonly listeners = new Set<(r: RadioReception) => void>();
  private readonly unsubscribeFrame: () => void;
  private readonly nowWall: () => number;
  private readonly chunkSeconds: number;
  private readonly maxBacklogSeconds: number;
  private me: Vantage = { seat: "mission-control" };
  private pairs: SeparationMatrix | undefined;
  /** Chunks still crossing: accepted, and not yet let through by the clock. */
  private crossing = 0;
  /** Chunks the clock has released and playback has not reached: the BACKLOG. */
  private paced = 0;
  private droppedChunks = 0;
  /**
   * The wall instant the most recent release pass ran at, which is the instant
   * everything it releases arrived at.
   *
   * `DelayedPlayoutBuffer` releases from its own frame subscription and from
   * `push()` as well as from `pump()`, so the wall clock cannot be read off
   * `pump()`'s argument at the release site. `null` until the first pump, where
   * falling back to `nowWall()` beats stamping an arrival with a wall instant
   * this session has never been driven at.
   */
  private releaseWall: number | null = null;
  private playingId: string | null = null;
  private decodingId: string | null = null;
  private published: RadioReception = EMPTY_RECEPTION;
  private disposed = false;

  constructor(private readonly opts: RadioSessionOptions) {
    this.nowWall = opts.nowWall ?? (() => performance.now() / 1000);
    this.chunkSeconds = opts.chunkSeconds ?? 0.02;
    this.maxBacklogSeconds = opts.maxBacklogSeconds ?? 0.25;
    this.buffer = new DelayedPlayoutBuffer<HeldChunk>({
      view: opts.view,
      maxBufferedBytes: opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
      /*
       * Drop-oldest, one chunk at a time, which is what `keyframe: false` on
       * every push buys. An Opus stream has no GOP and no inter-frame
       * dependency, so `gopSafeEviction` is not wanted here: a single dropped
       * chunk costs 20 ms of audio and nothing downstream, where the encoded
       * VIDEO path it exists for would corrupt every frame to the next keyframe.
       */
      onRelease: (frame) => {
        const chunk = frame.data;
        if (!chunk) return;
        this.crossing = Math.max(0, this.crossing - 1);
        const held = this.heard.get(chunk.transmissionId);
        if (!held) {
          this.discard(chunk);
          return;
        }
        this.paced += 1;
        held.pacer.submit(
          { ut: frame.ut, data: chunk },
          this.releaseWall ?? this.nowWall(),
        );
      },
      onDrop: (frame) => {
        this.crossing = Math.max(0, this.crossing - 1);
        this.discard(frame.data);
      },
    });
    this.unsubscribeFrame = opts.view.onFrame(() => this.pump());
  }

  /** Where this screen is reading from. Only ever consulted at a `start`. */
  setVantage(me: Vantage): void {
    this.me = me;
  }

  /** The published separation matrix, likewise consulted only at a `start`. */
  setPairs(pairs: SeparationMatrix | undefined): void {
    this.pairs = pairs;
  }

  /**
   * One frame off the wire. The caller has already dropped this screen's own
   * echo, on `authorStationKey`, exactly as the text relay does.
   */
  receive(frame: RadioFrame): void {
    if (this.disposed) return;
    recordRadioFrame(frame);
    switch (frame.kind) {
      case "start":
        this.begin(frame.transmission);
        break;
      case "chunk": {
        const held = this.heard.get(frame.transmissionId);
        // Either no path (a cut: silence, and nothing said about it) or a
        // transmission whose opening frame this screen never saw, which is what
        // joining mid-keying looks like. Both are dropped without a reading.
        if (!held) return;
        held.inflight += 1;
        this.crossing += 1;
        this.buffer.push({
          ut: frame.ut + held.transitSeconds,
          data: {
            transmissionId: frame.transmissionId,
            seq: frame.seq,
            bytes: frame.bytes,
          },
          keyframe: false,
          bytes: frame.bytes.byteLength,
        });
        break;
      }
      case "end": {
        /*
         * The envelope is retired, not the audio: whatever is already held
         * keeps its release instants and plays out across the crossing it was
         * given. Keying up at the far end does not silence what is still in
         * flight, any more than it recalls a spoken word.
         */
        const held = this.heard.get(frame.transmissionId);
        if (!held) return;
        held.ended = true;
        this.retire(held);
        break;
      }
    }
    this.publish();
  }

  /** Release whatever the clock has let through, then play whatever is due. */
  pump(nowWall = this.nowWall()): void {
    if (this.disposed) return;
    this.releaseWall = nowWall;
    this.buffer.pump();
    // A copy, because presenting the last chunk of a finished keying retires
    // its entry and mutates the map underneath the walk.
    for (const held of [...this.heard.values()]) held.pacer.tick(nowWall);
    this.publish();
  }

  snapshot(): RadioReception {
    return this.disposed ? EMPTY_RECEPTION : this.snapshotValue();
  }

  subscribe(cb: (r: RadioReception) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFrame();
    this.buffer.dispose();
    for (const held of this.heard.values()) held.pacer.dispose();
    this.opts.decoder.close();
    this.heard.clear();
    this.listeners.clear();
  }

  /**
   * A new keying, placed against this vantage once and for all.
   *
   * `no-path` is the whole cut expression on this side: the transmission is not
   * registered, so its chunks find nothing and are dropped. Deliberately not
   * recorded, not counted and not surfaced, see the class doc.
   */
  private begin(transmission: RadioTransmission): void {
    const seconds = transitSecondsOf(
      separationBetween(
        transmission.from,
        this.me.vantageId,
        transmission.separationSeconds,
        this.pairs,
      ),
    );
    if (seconds === null) return;
    this.heard.set(transmission.id, {
      transmission,
      transitSeconds: seconds,
      pacer: new PresentationPacer<HeldChunk>({
        maxBacklogSeconds: this.maxBacklogSeconds,
        onPresent: (frame) => {
          this.paced = Math.max(0, this.paced - 1);
          this.present(frame.data);
        },
        onSkip: (frame) => {
          this.paced = Math.max(0, this.paced - 1);
          this.discard(frame.data);
        },
      }),
      inflight: 0,
      ended: false,
    });
  }

  private present(chunk: HeldChunk): void {
    this.settle(chunk);
    if (this.decodingId !== chunk.transmissionId) {
      this.opts.decoder.reset();
      this.decodingId = chunk.transmissionId;
    }
    this.playingId = chunk.transmissionId;
    /*
     * Microseconds, the unit `EncodedAudioChunk` takes, and counted off the
     * SEQUENCE rather than off the UT. A decoder is timing a stream of its own,
     * and a UT that jumped under a revert or a quickload would hand it a
     * discontinuity it has no way to read.
     */
    this.opts.decoder.decode(
      chunk.bytes,
      Math.round(chunk.seq * this.chunkSeconds * 1e6),
    );
    // Retire only AFTER the decode, so the last chunk of a finished
    // transmission is still attributed to it while it plays.
    const held = this.heard.get(chunk.transmissionId);
    if (held) this.retire(held);
  }

  private discard(chunk: HeldChunk | undefined): void {
    this.droppedChunks += 1;
    this.settle(chunk);
    if (!chunk) return;
    const held = this.heard.get(chunk.transmissionId);
    if (held) this.retire(held);
  }

  /** One chunk has left the pipeline, played or dropped. */
  private settle(chunk: HeldChunk | undefined): void {
    if (!chunk) return;
    const held = this.heard.get(chunk.transmissionId);
    if (held) held.inflight = Math.max(0, held.inflight - 1);
  }

  /** Forget a transmission once it has both ended and finished playing. */
  private retire(held: HeardTransmission): void {
    if (!held.ended || held.inflight > 0) return;
    held.pacer.dispose();
    this.heard.delete(held.transmission.id);
    if (this.playingId === held.transmission.id) this.playingId = null;
  }

  private publish(): void {
    const next = this.snapshotValue();
    if (
      next.playing?.transmissionId === this.published.playing?.transmissionId &&
      next.droppedChunks === this.published.droppedChunks &&
      next.backlogSeconds === this.published.backlogSeconds
    ) {
      return;
    }
    this.published = next;
    for (const listener of this.listeners) listener(next);
  }

  private snapshotValue(): RadioReception {
    const held =
      this.playingId === null ? undefined : this.heard.get(this.playingId);
    return {
      playing:
        held === undefined
          ? null
          : {
              transmissionId: held.transmission.id,
              from: held.transmission.from,
              authorName: held.transmission.authorName,
            },
      backlogSeconds: this.paced * this.chunkSeconds,
      droppedChunks: this.droppedChunks,
    };
  }
}
