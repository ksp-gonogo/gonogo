import { PerfBudget } from "@ksp-gonogo/core";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { RecipientId } from "../types";

/**
 * Live push-to-talk radio: what one operator says, streamed as Opus chunks and
 * played at the far end one light-time later.
 *
 * It is not an audio MESSAGE. Nothing is recorded, nothing is stored, and there
 * is no transcript: chunks play as they arrive and a listener who was not there
 * missed it, the same way they would have on a radio. That is why these frames
 * never touch `CommcastLog`'s message ledger.
 *
 * The wire is the mod. Chunks go up in batches as `commcast.radio.transmit`
 * commands and come down on the binary lane as `commcast.radio`, addressed to
 * the group's members and delivered to each one light-time after they were
 * spoken. See `CommcastModLink`.
 */

/**
 * One keying of the microphone, described once at key-down and carried on every
 * chunk of it.
 *
 * On every chunk rather than once ahead of them, so each chunk is placeable on
 * its own: a listener that starts receiving partway through a keying (a screen
 * that joined the mesh late, a vantage a path has just reached) decodes from
 * wherever the stream is when it gets there, one light-time later at its own
 * vantage, with nothing replayed and nothing asked for. The cost is the envelope
 * repeated fifty times a second, a few hundred bytes a chunk against a data
 * channel that carries megabytes.
 */
export interface RadioTransmission {
  /** Minted at key-down. Groups every chunk of one keying. */
  id: string;
  /**
   * The group it is spoken to, which is the thread it belongs to. Who in that
   * group each chunk is for is on the chunk, because the group can grow while
   * somebody is talking.
   */
  groupId: string;
  /** The vantage it is spoken from, which is one half of its separation. */
  from: RecipientId;
  /** Stable device identity of the transmitter, as `station-info.stationKey`. */
  authorStationKey: string;
  /** Display name resolved from `station-info`, never a bare peer id. */
  authorName: string;
  /** Which end of the light-path it is spoken from. */
  authorSeat: Seat;
  /**
   * The transmitter's own present at key-down, `utNowEstimate()`. Not
   * `confirmedEdgeUt()`: a human speaks at their own present, and releasing
   * against the confirmed edge would hold every word for a round trip.
   */
  startedUt: number;
  /**
   * The longest separation from the transmitter to a member it has a path to,
   * frozen ONCE at key-down, or `null` for NO PATH to any of them.
   *
   * Frozen per TRANSMISSION rather than per chunk, and that is load-bearing
   * rather than an optimisation. A separation re-read every 20 ms would move
   * each chunk's release instant independently across the grid, so the playout
   * would jitter and, on a shrinking separation, reorder syllables inside a
   * word. `CommsMessage.separationSeconds` freezes at send for the same reason.
   *
   * The RECEIVER still resolves its own separation from the published matrix
   * where it can and falls back to this.
   */
  separationSeconds: number | null;
}

/** Fields every frame of a transmission carries, whatever its kind. */
interface RadioFrameBase {
  transmissionId: string;
  /**
   * On every frame, `end` included, because it is what a screen drops its own
   * voice on when the mod hands it back. The STATION key rather than the
   * vantage: a host and a station at one centre share a vantage and still have
   * to hear each other.
   */
  authorStationKey: string;
}

/**
 * One frame of the radio channel.
 *
 * `end` exists because a listener otherwise cannot tell a finished transmission
 * from one whose next chunk is merely late, and the two read differently on the
 * bar.
 */
export type RadioFrame =
  | (RadioFrameBase & {
      kind: "chunk";
      /** The keying this chunk belongs to, whole. See {@link RadioTransmission}. */
      transmission: RadioTransmission;
      /**
       * Who this chunk is for: the group's members as the transmitter could
       * see them when it was spoken, its own vantage included. A vantage not
       * named here never hears it.
       *
       * Per chunk rather than per keying, so a member added mid-transmission
       * is addressed from the first chunk spoken after the change reached the
       * transmitter, and hears the stream from there, one light-time later.
       */
      to: readonly RecipientId[];
      /** 0-based within the transmission, monotonic. */
      seq: number;
      /** The transmitter's own present when this chunk was captured. */
      ut: number;
      /**
       * Opus bytes, raw. Every encoded audio chunk is a key frame (there is no
       * GOP and no inter-frame dependency in an Opus stream), so a dropped one
       * costs 20 ms of audio and nothing downstream.
       */
      bytes: Uint8Array;
    })
  | (RadioFrameBase & {
      kind: "end";
      /** The transmitter's own present at key-up. */
      ut: number;
    });

/**
 * A frame as it reached this screen. A chunk carries the instant the mod
 * delivered it here, which is when it may be played.
 */
export type HeardRadioFrame =
  | (Extract<RadioFrame, { kind: "chunk" }> & { arrivedUt: number })
  | Extract<RadioFrame, { kind: "end" }>;

/**
 * Chunks this screen puts on or takes off the radio channel, per second.
 *
 * One talker at the 20 ms grid is 50/s. The cap is five times that, which
 * leaves room for hearing two or three at once and fails a runaway capture
 * loop, the failure mode a stuck transmit key produces.
 */
export const RADIO_CHUNK_BUDGET = new PerfBudget({
  name: "CommcastRadio chunks/sec",
  threshold: 250,
  windowMs: 1000,
  unit: "messages",
});

/**
 * Encoded audio bytes this screen puts on or takes off the radio channel, per
 * second.
 *
 * Measured, not guessed: the slice-0 probe put the worst engine at 4338 B/s at
 * `bitrate: 24000`, so the realistic single-talker figure is ~4.3 kB/s and this
 * cap is roughly nine times it. It is deliberately loose enough to survive a
 * codec that overshoots its bitrate hint (firefox does) and tight enough that
 * raw PCM cannot hide behind it: int16 at 16 kHz is 32 kB/s and would trip this
 * on the first second.
 */
export const RADIO_BYTES_BUDGET = new PerfBudget({
  name: "CommcastRadio encoded bytes/sec",
  threshold: 40_000,
  windowMs: 1000,
  unit: "bytes",
});

/** Record one frame against both budgets, whichever direction it crossed in. */
export function recordRadioFrame(frame: RadioFrame | HeardRadioFrame): void {
  if (frame.kind !== "chunk") return;
  RADIO_CHUNK_BUDGET.record();
  RADIO_BYTES_BUDGET.record(frame.bytes.byteLength);
}
