/**
 * One keying, end to end, on a recorded clip instead of a microphone.
 *
 * `RadioTransmitter` and `RadioSession` each have their own suite, and both are
 * driven by hand-built frames. What neither can show is the whole crossing: the
 * transmitter chunking a real utterance, those exact bytes reaching the far end
 * over the wire, and the audio a listener actually got compared against the
 * audio that was spoken. That is what a deterministic clip buys, and it is the
 * only way to assert delivery as an EQUALITY rather than as a count of frames.
 *
 * Everything here is arithmetic on two clocks the test moves itself: a UT clock
 * both ends read, and a wall clock the pacer is ticked against. No timers, no
 * device, no codec, so a run on a loaded machine says the same thing as a run on
 * a quiet one.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import type { SeparationMatrix, Vantage } from "../reveal";
import {
  CLIP_CHUNK_SECONDS,
  ClipDecoder,
  clipMic,
  clipPcm,
  clipSamples,
  DRIFT_CLIP,
  LONG_CLIP,
  type RadioClip,
  REPLY_CLIP,
  RecordingRadioSink,
  SHORT_CLIP,
} from "./clips";
import { RadioSession } from "./RadioSession";
import { RadioTransmitter } from "./RadioTransmitter";
import type { RadioFrame } from "./wire";

const ARES = "vessel:ares";
const KSC = "ksc";
const LIGHT_TIME = 240;
const START_UT = 1000;

/**
 * How often the listener's clock steps, in UT seconds.
 *
 * The release edge is sample-clamped to telemetry cadence rather than to audio
 * cadence, so it does not creep, it jumps, and each jump releases every chunk
 * that fell inside it in one pass, five or so. That is the regime the pacer exists
 * for and the only one a delivery rate can honestly be measured across, so the
 * drift scenes step the clock this way instead of smoothly.
 */
const SAMPLE_SECONDS = 0.1;

const GROUND: Vantage = { seat: "mission-control", vantageId: KSC };

afterEach(() => {
  for (const budget of PerfBudget.getAll()) budget.reset();
});

function matrix(seconds: number): SeparationMatrix {
  return new Map([
    [ARES, new Map([[KSC, seconds]])],
    [KSC, new Map([[ARES, seconds]])],
  ]);
}

/**
 * A craft talking to the ground, with the wire between them and nothing else.
 *
 * The two ends share ONE ut clock, which is what a pair of screens in one solar
 * system have: the light-time is not a disagreement about the time, it is how
 * long the words take to cross it.
 */
function crossing(
  clips: readonly RadioClip[],
  options: { separationSeconds?: number | null; pairs?: SeparationMatrix } = {},
) {
  let ut = START_UT;
  const frames: RadioFrame[] = [];
  const sink = new RecordingRadioSink();
  const decoder = new ClipDecoder(sink);
  const session = new RadioSession({
    // The reader's OWN present, which is the adapter `useRadio` hands it.
    view: { confirmedEdgeUt: () => ut, onFrame: () => () => {} },
    decoder,
    chunkSeconds: CLIP_CHUNK_SECONDS,
  });
  session.setVantage(GROUND);
  if (options.pairs) session.setPairs(options.pairs);

  const mics = clips.map((clip) => clipMic(clip));
  let keying = 0;
  const transmitter = new RadioTransmitter({
    send: (frame) => {
      frames.push(frame);
      // The wire is the mesh, which delivers at the speed of the internet. All
      // the delay is at the far end, held by the session.
      session.receive(frame);
    },
    utNow: () => ut,
    startCapture: (onChunk) => mics[keying++].start(onChunk),
  });

  return {
    session,
    transmitter,
    sink,
    decoder,
    frames,
    get ut() {
      return ut;
    },
    advance(seconds: number) {
      ut += seconds;
    },
    /** Key, say the whole clip on the 20 ms grid, unkey. */
    async say(index: number) {
      await transmitter.keyDown({
        to: [KSC],
        from: ARES,
        authorStationKey: "pilot-1",
        authorName: "Jeb",
        authorSeat: "pilot",
        separationSeconds:
          options.separationSeconds === undefined
            ? LIGHT_TIME
            : options.separationSeconds,
      });
      const mic = mics[index];
      while (mic.speak()) ut += CLIP_CHUNK_SECONDS;
      transmitter.keyUp();
    },
    /** Drain the pacer on the 20 ms grid from `fromWall`, and say where it got
     *  to, so a caller can carry on from there. */
    play(fromWall: number, chunks: number): number {
      let wall = fromWall;
      for (let i = 0; i < chunks; i++) {
        session.pump(wall);
        wall += CLIP_CHUNK_SECONDS;
      }
      return wall;
    },
    /**
     * Pump on the 20 ms wall grid while the listener's own clock advances
     * `rate` UT seconds per wall second, and say where it got to.
     *
     * That ratio is what a CHANGING separation does to a stream at the listener,
     * and it is the only thing it does: words spoken on a 20 ms grid cross a gap
     * that is shrinking and become audible closer together than they were
     * spoken, or further apart if it is growing. Above 1 is closing, below 1 is
     * opening. The frozen transit is untouched by any of it, which is the point:
     * the offset each word crosses is settled once, and how fast they land is a
     * separate quantity that lands here.
     */
    listen(fromWall: number, wallSeconds: number, rate: number): number {
      const steps = Math.round(wallSeconds / CLIP_CHUNK_SECONDS);
      const perSample = Math.round(SAMPLE_SECONDS / CLIP_CHUNK_SECONDS);
      let wall = fromWall;
      for (let i = 0; i < steps; i++) {
        session.pump(wall);
        wall += CLIP_CHUNK_SECONDS;
        if ((i + 1) % perSample === 0) ut += SAMPLE_SECONDS * rate;
      }
      return wall;
    },
  };
}

describe("a keying, spoken and heard", () => {
  it("delivers the audio that was spoken, sample for sample", async () => {
    const scene = crossing([SHORT_CLIP]);
    await scene.say(0);

    // Past every reveal instant, so the buffer lets the whole utterance
    // through in one pass and only the pacer is left deciding when.
    scene.advance(LIGHT_TIME + 1);
    scene.play(0, SHORT_CLIP.chunks.length);

    expect(scene.sink.played).toHaveLength(SHORT_CLIP.chunks.length);
    expect([...scene.sink.pcm()]).toEqual([...clipPcm(SHORT_CLIP)]);
  });

  it("holds every word until the light has had time to cross", async () => {
    const scene = crossing([SHORT_CLIP]);
    await scene.say(0);

    // The whole utterance is on the wire and the far end has all of it. It has
    // still heard nothing, which is the only thing the delay model asserts.
    scene.play(0, 10);
    expect(scene.sink.played).toHaveLength(0);
    expect(scene.frames.filter((f) => f.kind === "chunk")).toHaveLength(
      SHORT_CLIP.chunks.length,
    );

    // One light-time on from the first chunk, and the first chunk only: the
    // rest is still crossing, spaced by the 20 ms it was spoken on.
    scene.advance(LIGHT_TIME);
    scene.play(0, 1);
    expect(scene.sink.played).toHaveLength(1);
    expect([...scene.sink.played[0].samples]).toEqual([
      ...clipSamples({ ...SHORT_CLIP.chunks[0], index: 0 }),
    ]);
  });

  it("resolves the separation once, at the start frame", async () => {
    /*
     * The reader's own published pair beats the frozen envelope figure, and it
     * is read ONCE. Halving the matrix mid-utterance must not pull the rest of
     * the words forward: a separation that moved between chunks would move
     * their release instants independently and reorder syllables inside a word.
     */
    const scene = crossing([SHORT_CLIP], { pairs: matrix(120) });
    await scene.say(0);
    scene.session.setPairs(matrix(10));

    scene.advance(119);
    scene.play(0, 5);
    expect(scene.sink.played).toHaveLength(0);

    scene.advance(2);
    scene.play(0, 1);
    expect(scene.sink.played).toHaveLength(1);
  });

  it("reports the backlog when the release edge outruns playback", async () => {
    /*
     * The warp caveat, made visible. `PresentationPacer` spaces frames by UT
     * deltas read as WALL deltas, so a clock that jumps releases a second of
     * audio at once and playback is left a second behind. The reading counts
     * released-but-unplayed audio only, never the light-time still crossing.
     */
    const scene = crossing([LONG_CLIP]);
    await scene.say(0);

    expect(scene.session.snapshot().backlogSeconds).toBe(0);

    scene.advance(LIGHT_TIME + 1);
    scene.session.pump(0);

    const backlog = scene.session.snapshot().backlogSeconds;
    expect(backlog).toBeGreaterThan(0.9);
    expect(backlog).toBeLessThanOrEqual(LONG_CLIP.seconds);
    expect(scene.sink.played).toHaveLength(1);
  });

  it("says who is being played, at the instant they are heard", async () => {
    const scene = crossing([SHORT_CLIP]);
    await scene.say(0);
    expect(scene.session.snapshot().playing).toBeNull();

    scene.advance(LIGHT_TIME);
    scene.play(0, 1);
    expect(scene.session.snapshot().playing).toMatchObject({
      from: ARES,
      authorName: "Jeb",
    });
  });
});

describe("a keying across a separation that is changing", () => {
  /*
   * The rates here are absurd as orbital mechanics and deliberate as arithmetic:
   * a real closing rate is parts per hundred thousand and would take an hour of
   * transmission to show what these show in two seconds. The code path is the
   * same one either way, and the thing being asserted is that the feed follows
   * the delivery rather than the grid the words were spoken on.
   */
  const CLOSING = 1.13;
  const OPENING = 0.87;

  it("keeps the feed with the words when the separation is closing", async () => {
    /*
     * Closing, chunks land closer together than the 20 ms they were spoken on.
     * A feed pinned to that grid takes longer to play them than they took to
     * arrive, so audio piles up behind it for the whole transmission and the
     * listener finishes hearing a quarter second after they could have. Nothing
     * is dropped and nothing is distorted, which is exactly why it goes unseen.
     */
    const scene = crossing([DRIFT_CLIP]);
    await scene.say(0);

    // Up to the first chunk's release instant and no further, so the whole
    // utterance arrives through the closing crossing rather than in one pass.
    scene.advance(LIGHT_TIME - DRIFT_CLIP.seconds);

    /*
     * Read twice, at the same point in the release cycle, because the reading
     * is a TREND and not a level: a burst lands, the feed drains it, and what
     * is queued at any instant depends on where in that cycle the instant fell.
     * Both halves are 45 pumps, nine release bursts, so the two samples are
     * phase-aligned and the only thing between them is growth.
     */
    const half = scene.listen(0, 0.9, CLOSING);
    const midBacklog = scene.session.snapshot().backlogSeconds;
    const arrivalsEnd = scene.listen(half, 0.9, CLOSING);
    const endBacklog = scene.session.snapshot().backlogSeconds;

    // Paced on the 20 ms grid the words were spoken on this reads 0.12 then
    // 0.24, an exact doubling that goes on for as long as somebody keeps
    // talking. Following the arrival rate it reads 0.06 at both samples.
    expect(endBacklog).toBeLessThanOrEqual(midBacklog + CLIP_CHUNK_SECONDS);
    expect(endBacklog).toBeLessThanOrEqual(6 * CLIP_CHUNK_SECONDS);
    expect(scene.session.snapshot().droppedChunks).toBe(0);

    scene.listen(arrivalsEnd, 0.4, CLOSING);
    expect([...scene.sink.pcm()]).toEqual([...clipPcm(DRIFT_CLIP)]);
  });

  it("hears every word when the separation is opening, instead of snapping past some", async () => {
    /*
     * Opening, chunks land further apart than they were spoken. A feed pinned to
     * the 20 ms grid is ready before each one exists, so its idea of when the
     * next is due falls further behind real time with every chunk until the
     * backlog guard reads a quarter second of lag that was never audio, snaps to
     * the newest chunk it holds, and takes the rest of that release burst with
     * it. Words are lost to bookkeeping, on a crossing that delivered all of
     * them.
     */
    const scene = crossing([DRIFT_CLIP]);
    await scene.say(0);

    scene.advance(LIGHT_TIME - DRIFT_CLIP.seconds);
    scene.listen(0, DRIFT_CLIP.seconds / OPENING + 0.2, OPENING);

    expect(scene.session.snapshot().droppedChunks).toBe(0);
    expect(scene.sink.played).toHaveLength(DRIFT_CLIP.chunks.length);
    expect([...scene.sink.pcm()]).toEqual([...clipPcm(DRIFT_CLIP)]);
  });
});

describe("a keying with no path", () => {
  it("is silence at the listener, and nothing else at all", async () => {
    /*
     * The settled ruling. Announcing "somebody is transmitting and you cannot
     * hear them" would be the faster-than-light channel the whole delay model
     * exists to prevent, so the listener gets no reading of any kind: not a
     * name, not a drop count, not a backlog.
     */
    const scene = crossing([SHORT_CLIP], { separationSeconds: null });
    await scene.say(0);
    scene.advance(LIGHT_TIME + 1);
    scene.play(0, SHORT_CLIP.chunks.length);

    expect(scene.sink.played).toHaveLength(0);
    expect(scene.session.snapshot()).toEqual({
      playing: null,
      // Not a light either. A cut is silence and says nothing about itself:
      // an indicator naming somebody this vantage cannot hear would be the
      // faster-than-light channel the whole delay model exists to prevent.
      live: [],
      backlogSeconds: 0,
      droppedChunks: 0,
    });
  });

  it("keeps talking anyway, every chunk on the wire", async () => {
    // Loss of path stops DELIVERY, never transmission: a listener elsewhere
    // who does have a path to this vantage is entitled to the words.
    const scene = crossing([SHORT_CLIP], { separationSeconds: null });
    await scene.say(0);

    expect(scene.frames.filter((f) => f.kind === "chunk")).toHaveLength(
      SHORT_CLIP.chunks.length,
    );
    const start = scene.frames[0];
    expect(start.kind).toBe("start");
    if (start.kind === "start") {
      expect(start.transmission.separationSeconds).toBeNull();
    }
  });
});

describe("two keyings a conversational gap apart", () => {
  it("starts the second one speaking at once, not after the gap", async () => {
    /*
     * ONE PACER PER TRANSMISSION, and this is the failure a channel-wide one
     * produces. The pacer spaces frames by their UT deltas read as wall deltas,
     * which is exactly right inside one keying and wrong between two: anchored
     * on the last frame of the first utterance, the second would sit silent for
     * the whole minute of the gap before its first word.
     */
    const scene = crossing([SHORT_CLIP, REPLY_CLIP]);
    await scene.say(0);
    scene.advance(60);
    await scene.say(1);

    // The first utterance, heard whole.
    scene.advance(LIGHT_TIME - 60 - SHORT_CLIP.seconds + 1);
    const wall = scene.play(0, SHORT_CLIP.chunks.length);
    expect(scene.sink.played).toHaveLength(SHORT_CLIP.chunks.length);

    // The second one's light-time is up. One pump, at the wall instant the
    // first one finished on, and the reply is already speaking.
    scene.advance(61);
    scene.session.pump(wall);
    expect(scene.sink.played).toHaveLength(SHORT_CLIP.chunks.length + 1);
    expect([...scene.sink.played[SHORT_CLIP.chunks.length].samples]).toEqual([
      ...clipSamples({ ...REPLY_CLIP.chunks[0], index: 0 }),
    ]);
  });

  it("starts a fresh decode for the second one", async () => {
    // A new keying is not a continuation: one decoder fed two utterances back
    // to back interprets the second against the first's state.
    const scene = crossing([SHORT_CLIP, REPLY_CLIP]);
    await scene.say(0);
    scene.advance(60);
    await scene.say(1);

    scene.advance(LIGHT_TIME - 60 - SHORT_CLIP.seconds + 1);
    const wall = scene.play(0, SHORT_CLIP.chunks.length);
    expect(scene.decoder.resets).toBe(1);

    scene.advance(61);
    scene.session.pump(wall);
    expect(scene.decoder.resets).toBe(2);
  });
});
