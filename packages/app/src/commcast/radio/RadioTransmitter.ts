import { PerfBudget, safeRandomUuid } from "@ksp-gonogo/core";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { RecipientId } from "../types";
import type { RadioFrame, RadioTransmission } from "./wire";
import { recordRadioFrame } from "./wire";

/**
 * The talking half of the radio: one keying of the microphone, turned into a
 * numbered stream of Opus chunks on the mesh.
 *
 * Everything here is sequencing and envelope. The microphone and the codec sit
 * behind {@link StartRadioCapture}, injected rather than reached for, so this
 * class is exercisable without a secure context, a device or WebCodecs, and so
 * the browser half stays the one piece with no logic in it.
 *
 * **Loss of path stops DELIVERY, never transmission.** With no route to the
 * chosen recipient the composer bar turns and flags `NO PATH`, and the operator
 * keeps talking: the separation is frozen as `null` and every chunk still goes
 * on the wire, where a listener who does have a path to this vantage can hear
 * it. Refusing the press would make this widget decide, from one end, something
 * only the other end can answer.
 */

/** A live capture, running. */
export interface RadioCapture {
  stop(): void;
}

/**
 * Open the microphone and encode it, calling back once per 20 ms chunk.
 *
 * Rejects rather than resolving on a refused microphone or an absent codec: the
 * transmitter turns that into a stated reason on the bar, which is the whole
 * value of the slice-0 probe's `insecure-context` / `no-codec` split.
 *
 * `amplitude` is how loud that chunk was, 0..1, measured off the PCM the
 * encoder was already handed (`chunkAmplitude`). It rides alongside the bytes
 * rather than on the wire, and is LOCAL ONLY: it is the operator's own voice,
 * drawn on their own rail. Publishing it so a listener could draw somebody
 * else's transmission crossing the gap would be a contract change, and is
 * deliberately not made.
 */
export type StartRadioCapture = (
  onChunk: (bytes: Uint8Array, amplitude: number) => void,
  options?: RadioCaptureOptions,
) => Promise<RadioCapture>;

/** Which input to key, where the operator has said. */
export interface RadioCaptureOptions {
  /**
   * The device the operator chose, or `null`/absent for whichever one the
   * browser considers default.
   *
   * Read at KEY-DOWN rather than held, so a choice made between two
   * transmissions takes effect on the next one without anything being rebuilt,
   * and a choice made mid-transmission does not swap the microphone out from
   * under a sentence already going out.
   */
  deviceId?: string | null;
}

/** What the operator is transmitting, and to whom, decided once at key-down. */
export interface RadioKeyDown {
  to: readonly RecipientId[];
  from: RecipientId;
  authorStationKey: string;
  authorName: string;
  authorSeat: Seat;
  /**
   * The separation to the recipient, read ONCE here and frozen into the
   * envelope. See `RadioTransmission.separationSeconds`: re-reading it per
   * chunk jitters the far end's playout across the 20 ms grid.
   */
  separationSeconds: number | null;
}

/** What the PTT control can honestly say about itself. */
export interface RadioTransmitState {
  /** Keyed: the microphone is open and chunks are going out. */
  live: boolean;
  /** Keyed, and still opening the microphone. */
  opening: boolean;
  /** Chunks sent in the current or most recent transmission. */
  chunks: number;
  /**
   * How loud each of the last {@link AMPLITUDE_HISTORY} chunks was, 0..1,
   * NEWEST LAST. What the delay rail draws as the waveform ribbon of this
   * transmission crossing the gap.
   *
   * Cleared at key-down, and bounded by {@link amplitudeHistoryFor} against the
   * separation this transmission was keyed at, so it holds the audio that is
   * still in flight rather than a fixed couple of seconds of it.
   *
   * **How many of these there are is what the rail's trace MEASURES.** The rail
   * draws a sample at its own age, so the trace reaches as far as the oldest
   * sample held and no further. A short ring therefore does not make the
   * drawing coarse, it makes it claim less of the gap than the transmission
   * occupies: 128 samples against a minute of light-time drew a 16 px corner
   * mark for a rail that was full of voice end to end. The ring is the fix,
   * because the drawing may not spread what was kept over the whole rail
   * without putting recent audio where older audio actually is.
   *
   * Optional, so a state built by something other than the transmitter (a
   * hook's idle constant, a test fixture) is not obliged to invent a waveform
   * it never measured. The transmitter itself always carries one.
   */
  amplitudes?: readonly number[];
  /**
   * Why the last attempt to key failed, in the operator's terms, or `null`.
   * A stated fact beats a control that silently does nothing.
   */
  fault: string | null;
}

/** One captured chunk is 20 ms, so a light-time converts to that many samples. */
const CHUNK_SECONDS = 0.02;

/**
 * The ring's FLOOR: what to keep when there is no separation to size against,
 * 128 chunks or 2.56 seconds.
 *
 * It was the whole rule until 2026-09-10, and as a rule it was a defect. The
 * rail draws each sample at its own age, so the trace reaches only as far as the
 * oldest sample held: against the operator's common ten to sixty seconds of
 * light-time this drew 4% to 25% of the rail and read as barely having started
 * talking, when the gap was in fact full of voice the transmitter had thrown
 * away.
 */
export const AMPLITUDE_HISTORY = 128;

/**
 * The ring's CEILING: 3001 chunks, which is 60 seconds of light-time plus the
 * one sample the rail's reach measurement needs on top of it. Sixty seconds is
 * the top of the separation the operator described working at, so a gap that
 * wide is covered exactly rather than one sample short.
 *
 * A bound is needed because nothing here knows how far the far end can get. It
 * is chosen against the SPEND, per chunk: the ring is rebuilt on every 20 ms
 * chunk to change its identity (see `emitChunk`), so at the cap that is a
 * 3000-element copy fifty times a second, ~24 kB an allocation and ~150 k
 * elements a second. Generous, measurable, and an order below anything that
 * would show on a frame budget. The 24 kB the ring itself occupies is not the
 * consideration; the copy rate is.
 *
 * **Past the cap the trace is TRUNCATED, and stops short of the boundary.** The
 * far part of the rail is then audio in flight that the transmitter did not
 * keep, which is exactly what a trace ending early says. The alternative,
 * spreading 60 seconds of samples over a wider gap, would put recent audio
 * where older audio is, and a drawing whose job is position may not do that.
 */
export const AMPLITUDE_HISTORY_MAX = 3001;

/**
 * How many chunk amplitudes to keep for a transmission keyed at this
 * separation: enough that the oldest sample held is the oldest still in flight,
 * so the rail's trace reaches the boundary rather than stopping short of it.
 *
 * One sample past the light-time, because the rail measures the extent off the
 * OLDEST sample's age (`length - 1` of them behind the newest), so covering a
 * span of `n` takes `n + 1` samples.
 *
 * The separation is the one frozen into the envelope at key-down, which is
 * where every other use of it in this file comes from as well: re-reading it
 * per chunk jitters the far end's playout across the 20 ms grid. A separation
 * that MOVES during one transmission therefore does not resize the ring, and
 * the arithmetic says it need not: light-time changes at closing speed over c,
 * so a minute of talking at 10 km/s of relative motion moves the far end 600 km,
 * two milliseconds of light-time, a tenth of one chunk. Should a separation ever
 * jump mid-transmission the ring under-covers and the trace stops short, which
 * is the honest direction for it to fail in.
 */
/**
 * Elements copied a second rebuilding the amplitude ring, which is the one cost
 * that now SCALES with the separation: the ring is rebuilt per chunk to change
 * its identity, so its length is a per-chunk spend rather than a one-off 24 kB.
 *
 * Measured rather than reasoned about, because neither existing radio budget can
 * see it. `RADIO_CHUNK_BUDGET` counts chunks and `RADIO_BYTES_BUDGET` counts
 * encoded audio, and both are indifferent to how long the ring is; a ring sized
 * from a separation nobody bounded would have grown under a green board.
 *
 * The cap is ~3x the steady state at {@link AMPLITUDE_HISTORY_MAX}: 3000
 * elements fifty times a second is 150 k, so 500 k leaves room for a burst and
 * for a second talker on one screen while still failing if the ceiling is ever
 * raised without this being revisited.
 */
const AMPLITUDE_RING_BUDGET = new PerfBudget({
  name: "CommcastRadio amplitude ring elements/sec",
  threshold: 500_000,
  windowMs: 1000,
  unit: "samples",
});

export function amplitudeHistoryFor(
  separationSeconds: number | null | undefined,
): number {
  if (
    separationSeconds == null ||
    !Number.isFinite(separationSeconds) ||
    separationSeconds <= 0
  ) {
    return AMPLITUDE_HISTORY;
  }
  const cover = Math.ceil(separationSeconds / CHUNK_SECONDS) + 1;
  return Math.min(AMPLITUDE_HISTORY_MAX, Math.max(AMPLITUDE_HISTORY, cover));
}

const NO_AMPLITUDES: readonly number[] = [];

const IDLE: RadioTransmitState = {
  live: false,
  opening: false,
  chunks: 0,
  amplitudes: NO_AMPLITUDES,
  fault: null,
};

export interface RadioTransmitterOptions {
  send(frame: RadioFrame): void;
  /** The transmitter's own present. `undefined` before a clock exists. */
  utNow(): number | undefined;
  startCapture: StartRadioCapture;
}

export class RadioTransmitter {
  private readonly listeners = new Set<(s: RadioTransmitState) => void>();
  private state: RadioTransmitState = IDLE;
  private capture: RadioCapture | null = null;
  private current: RadioTransmission | null = null;
  private seq = 0;
  /** This transmission's per-chunk loudness, newest last, capped at `historyLimit`. */
  private amplitudes: number[] = [];
  /** What this transmission's separation entitles the ring to hold. */
  private historyLimit = AMPLITUDE_HISTORY;
  /** Bumped on every key-down and key-up, so a capture that finishes opening
   *  after the operator let go is stopped instead of going live behind them. */
  private generation = 0;

  constructor(private readonly opts: RadioTransmitterOptions) {}

  snapshot(): RadioTransmitState {
    return this.state;
  }

  subscribe(cb: (s: RadioTransmitState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Key the microphone. Resolves once it is open, or once it has failed. */
  async keyDown(envelope: RadioKeyDown): Promise<void> {
    if (this.state.live || this.state.opening) return;
    const startedUt = this.opts.utNow();
    if (startedUt === undefined) {
      this.set({ ...IDLE, fault: "NO CLOCK" });
      return;
    }
    const generation = ++this.generation;
    this.amplitudes = [];
    /*
     * Sized here, from the same frozen separation the envelope carries, so the
     * ring covers the gap this transmission is actually crossing. Before the
     * microphone opens rather than after: a capture that goes live early would
     * otherwise fill a ring sized for the previous transmission.
     */
    this.historyLimit = amplitudeHistoryFor(envelope.separationSeconds);
    this.set({
      live: false,
      opening: true,
      chunks: 0,
      amplitudes: NO_AMPLITUDES,
      fault: null,
    });

    const transmission: RadioTransmission = {
      id: safeRandomUuid(),
      to: envelope.to,
      from: envelope.from,
      authorStationKey: envelope.authorStationKey,
      authorName: envelope.authorName,
      authorSeat: envelope.authorSeat,
      startedUt,
      separationSeconds: envelope.separationSeconds,
    };

    let capture: RadioCapture;
    try {
      capture = await this.opts.startCapture((bytes, amplitude) =>
        this.emitChunk(generation, bytes, amplitude),
      );
    } catch (err) {
      if (generation !== this.generation) return;
      this.set({ ...IDLE, fault: faultOf(err) });
      return;
    }
    // Let go while the microphone was still opening. Stop it rather than going
    // live behind an operator who is no longer pressing anything.
    if (generation !== this.generation) {
      capture.stop();
      return;
    }
    this.capture = capture;
    this.current = transmission;
    this.seq = 0;
    this.send({
      kind: "start",
      transmissionId: transmission.id,
      authorStationKey: transmission.authorStationKey,
      transmission,
    });
    this.set({
      live: true,
      opening: false,
      chunks: 0,
      amplitudes: NO_AMPLITUDES,
      fault: null,
    });
  }

  /** Unkey. Safe at any point, including while the microphone is still opening. */
  keyUp(): void {
    this.generation += 1;
    const transmission = this.current;
    this.capture?.stop();
    this.capture = null;
    this.current = null;
    if (transmission) {
      this.send({
        kind: "end",
        transmissionId: transmission.id,
        authorStationKey: transmission.authorStationKey,
        ut: this.opts.utNow() ?? transmission.startedUt,
      });
    }
    this.set({ ...this.state, live: false, opening: false });
  }

  dispose(): void {
    this.keyUp();
    this.listeners.clear();
  }

  private emitChunk(
    generation: number,
    bytes: Uint8Array,
    amplitude: number,
  ): void {
    if (generation !== this.generation) return;
    const transmission = this.current;
    if (!transmission) return;
    this.send({
      kind: "chunk",
      transmissionId: transmission.id,
      authorStationKey: transmission.authorStationKey,
      /*
       * The transmitter's own present, per chunk. NOT the frozen `startedUt`
       * plus an offset: a warp or a revert moves the clock, and a stream timed
       * off a stale anchor would land at instants the far end's clock has
       * already passed.
       */
      ut: this.opts.utNow() ?? transmission.startedUt,
      seq: this.seq++,
      bytes,
    });
    /*
     * A fresh array per chunk rather than a mutated one: the state is read
     * through `useSyncExternalStore`, which compares snapshots by identity, so
     * a ring mutated in place would never re-render the ribbon drawing it.
     *
     * One allocation and an in-place shift rather than a copy and a `slice`,
     * because the ring is now as long as the separation is wide: at
     * `AMPLITUDE_HISTORY_MAX` that is the difference between two 3000-element
     * copies per chunk and one, fifty times a second.
     */
    const next = [...this.amplitudes, clampAmplitude(amplitude)];
    if (next.length > this.historyLimit) {
      next.splice(0, next.length - this.historyLimit);
    }
    AMPLITUDE_RING_BUDGET.record(next.length);
    this.amplitudes = next;
    this.set({
      ...this.state,
      chunks: this.seq,
      amplitudes: this.amplitudes,
    });
  }

  private send(frame: RadioFrame): void {
    recordRadioFrame(frame);
    this.opts.send(frame);
  }

  private set(next: RadioTransmitState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

/**
 * A capture reporting nonsense gets a flat zero rather than a ribbon of NaN
 * geometry. The transmitter cannot fix a broken capture and does not try; it
 * refuses to pass the breakage on to whatever is drawing.
 */
function clampAmplitude(a: number): number {
  if (!Number.isFinite(a)) return 0;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * What went wrong, as the operator would say it.
 *
 * `NotAllowedError` is a refused permission prompt and is the operator's own to
 * fix; `NotFoundError` is a machine with no input device. Anything else is
 * reported as a bare fault rather than dressed up, because a wrong specific
 * cause is worse than an admitted unknown one.
 */
function faultOf(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "MIC DENIED";
  if (name === "NotFoundError") return "NO MIC";
  return "MIC FAILED";
}
