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
 * never touch `CommcastLog`'s message ledger even though they ride the same
 * wire it does.
 *
 * The wire is `CommcastMesh`, not a WebRTC media track, and the reason is
 * topology rather than preference. PeerJS is a star: a station holds the host's
 * peer id and nobody else's, so `peer.call()` cannot reach another station at
 * all, and the host has no way to forward a received track onward without
 * becoming a mixing SFU. The data channel already relays N ways, and it already
 * carries a `Uint8Array` through BinaryPack untouched, so the chunks travel as
 * bytes rather than paying base64's third.
 */

/**
 * One keying of the microphone, described once at key-down.
 *
 * Sent ahead of the chunks rather than repeated on each of them: at 20 ms per
 * chunk the envelope would be 50 copies a second of five strings that never
 * change, which is more wire than the audio. The cost is that a screen which
 * joins mid-transmission cannot place the chunks it is hearing, and drops them;
 * it hears the next transmission whole. That is the honest failure for a live
 * medium and the same one a real radio has.
 */
export interface RadioTransmission {
  /** Minted at key-down. Groups every chunk of one keying. */
  id: string;
  /**
   * Who it is for. A LIST holding exactly one entry in this pass, the same
   * shape and for the same reason `CommsMessage.to` is one: groups are then an
   * additive change to the reveal rather than a wire change.
   */
  to: readonly RecipientId[];
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
   * The transmitter-to-recipient separation, frozen ONCE at key-down, or `null`
   * for NO PATH.
   *
   * Frozen per TRANSMISSION rather than per chunk, and that is load-bearing
   * rather than an optimisation. A separation re-read every 20 ms would move
   * each chunk's release instant independently across the grid, so the playout
   * would jitter and, on a shrinking separation, reorder syllables inside a
   * word. `CommsMessage.separationSeconds` freezes at send for the same reason.
   *
   * The RECEIVER still resolves its own separation from the published matrix
   * where it can and falls back to this, which is `separationFor`'s existing
   * behaviour unchanged.
   */
  separationSeconds: number | null;
}

/** Fields every frame of a transmission carries, whatever its kind. */
interface RadioFrameBase {
  transmissionId: string;
  /**
   * Repeated on every frame, unlike the rest of the envelope, because it is
   * what the relay drops its own echo on. The host repeats each frame to the
   * other peers and then offers it to this screen, exactly as it does for a
   * text message, and it must not offer a screen its own voice back.
   *
   * The STATION key rather than the vantage: a host and a station at one centre
   * share a vantage and still have to hear each other.
   */
  authorStationKey: string;
}

/**
 * One frame of the radio channel.
 *
 * Three kinds rather than one self-describing chunk, so the envelope is paid
 * for once per keying. `end` exists because a listener otherwise cannot tell a
 * finished transmission from one whose next chunk is merely late, and the two
 * read differently on the bar.
 */
export type RadioFrame =
  | (RadioFrameBase & { kind: "start"; transmission: RadioTransmission })
  | (RadioFrameBase & {
      kind: "chunk";
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
 * Chunks this screen puts on or takes off the radio channel, per second.
 *
 * One talker at the 20 ms grid is 50/s. The cap is five times that, which
 * leaves room for a relay hearing two or three at once and fails a runaway
 * capture loop, the failure mode a stuck transmit key produces.
 *
 * Sized against the host budgets these frames pass straight through:
 * `PEER_BROADCAST_COUNT_BUDGET` is 1500/s against a stated ~600/s baseline, so
 * one talker relayed to three stations is 150/s, a tenth of that cap but a
 * quarter of the headroom left in it. If it ever bites, 40 ms chunks halve the
 * count for 20 ms of added latency, which is nothing beside a light-minute.
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
export function recordRadioFrame(frame: RadioFrame): void {
  if (frame.kind !== "chunk") return;
  RADIO_CHUNK_BUDGET.record();
  RADIO_BYTES_BUDGET.record(frame.bytes.byteLength);
}
