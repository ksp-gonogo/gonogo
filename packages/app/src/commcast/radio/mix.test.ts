/**
 * What several talkers sound like once they are summed, asserted against the
 * SHIPPED worklet rather than against a re-description of it.
 *
 * The audio thread cannot import a module, so `webaudio.ts` builds the playout
 * processor as a source string. A test written against a copy of that source
 * would agree with itself forever, so this evaluates the real string in a
 * stubbed worklet global and drives the real `process`. Everything asserted
 * here is therefore the code a browser runs.
 *
 * The limiter is checked twice over: as a function, where the knee and the
 * asymptote are arithmetic, and through the processor, where what matters is
 * that a lane which has run dry contributes silence and does not fall behind.
 */
import { describe, expect, it } from "vitest";
import { MIX_KNEE, mixSample } from "./mix";
import { PLAYOUT_WORKLET } from "./webaudio";

/** One quantum, the size Web Audio always renders in. */
const QUANTUM = 128;

interface LaneMessage {
  lane: number;
  samples?: Float32Array;
  close?: true;
}

interface PlayoutProcessor {
  port: { onmessage: (event: { data: LaneMessage }) => void };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}

/**
 * The shipped worklet, loaded into this process.
 *
 * `AudioWorkletProcessor` and `registerProcessor` are the two globals the
 * module expects and the only two it uses, so a base class holding a
 * `MessagePort`-shaped object is the whole environment it needs. The source is
 * evaluated rather than parsed, so a syntax error in the string, which is the
 * failure a template-built module is most prone to, fails here rather than in a
 * browser.
 */
function loadPlayout(): PlayoutProcessor {
  let registered: (new () => PlayoutProcessor) | null = null;
  class StubProcessor {
    port = { onmessage: (_event: { data: LaneMessage }) => {} };
  }
  const load = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    PLAYOUT_WORKLET,
  ) as (
    base: typeof StubProcessor,
    register: (name: string, ctor: new () => PlayoutProcessor) => void,
  ) => void;
  load(StubProcessor, (_name, ctor) => {
    registered = ctor;
  });
  if (registered === null) throw new Error("the worklet registered nothing");
  return new (registered as new () => PlayoutProcessor)();
}

function write(processor: PlayoutProcessor, message: LaneMessage): void {
  processor.port.onmessage({ data: message });
}

/** Render one quantum and hand back what came out. */
function render(processor: PlayoutProcessor): Float32Array {
  const out = new Float32Array(QUANTUM);
  processor.process([], [[out]]);
  return out;
}

/** A block of `length` samples all holding `level`. */
function flat(level: number, length = QUANTUM): Float32Array {
  return new Float32Array(length).fill(level);
}

describe("the mix limiter", () => {
  it("passes a single talker through untouched below the knee", () => {
    // The overwhelmingly common case, and it must not be reshaped by machinery
    // that exists for the rare one.
    for (const level of [0, 0.1, 0.5, MIX_KNEE, -MIX_KNEE, -0.5]) {
      expect(mixSample(level)).toBe(level);
    }
  });

  it("keeps the constant and the arithmetic saying the same thing", () => {
    /*
     * `mixSample` inlines its knee, because it is stringified into a worklet
     * where a free identifier would not resolve. That is exactly the shape a
     * constant drifts out of, so the two are compared rather than trusted:
     * just below the knee is identity, just above it is not.
     */
    expect(mixSample(MIX_KNEE - 1e-6)).toBe(MIX_KNEE - 1e-6);
    expect(mixSample(MIX_KNEE + 0.1)).toBeLessThan(MIX_KNEE + 0.1);
  });

  it("never leaves the output's range, however loud the room gets", () => {
    for (const level of [1, 2, 5, 100, -2, -100]) {
      expect(Math.abs(mixSample(level))).toBeLessThan(1);
      expect(Math.abs(mixSample(level))).toBeGreaterThan(MIX_KNEE);
    }
    // Odd, so the two halves of a waveform are shaped the same and the sum
    // does not acquire a DC offset that a speaker would hear as a thump.
    expect(mixSample(-1.7)).toBe(-mixSample(1.7));
  });

  it("compresses rather than clipping: louder in is still louder out", () => {
    /*
     * The property that separates this from a hard clip, and the reason two
     * people talking over each other stays legible instead of turning to
     * buzzing: past the knee a hard clip maps every level to the same number.
     */
    let previous = mixSample(MIX_KNEE);
    for (const level of [0.9, 1.0, 1.2, 1.6, 2.4]) {
      const shaped = mixSample(level);
      expect(shaped).toBeGreaterThan(previous);
      previous = shaped;
    }
  });
});

describe("the playout worklet", () => {
  it("plays one lane at its own level", () => {
    const processor = loadPlayout();
    write(processor, { lane: 0, samples: flat(0.4) });
    expect([...render(processor)]).toEqual([...flat(0.4)]);
  });

  it("sums two lanes rather than playing them one after the other", () => {
    /*
     * The defect this whole change exists for. A single queue would have
     * emitted lane 0's quantum and then lane 1's, so both talkers would be
     * heard, sequentially, at twice the wall time they were spoken over, each
     * drifting further behind the moment they said it.
     */
    const processor = loadPlayout();
    write(processor, { lane: 0, samples: flat(0.3) });
    write(processor, { lane: 1, samples: flat(0.2) });

    expect([...render(processor)]).toEqual([...flat(0.5)]);
    // And nothing is left over: the second quantum is silence, not lane 1's
    // audio arriving late.
    expect([...render(processor)]).toEqual([...flat(0)]);
  });

  it("limits the sum instead of clipping it", () => {
    const processor = loadPlayout();
    write(processor, { lane: 0, samples: flat(0.9) });
    write(processor, { lane: 1, samples: flat(0.9) });

    const heard = render(processor);
    expect(heard[0]).toBeCloseTo(mixSample(1.8), 6);
    expect(heard[0]).toBeLessThan(1);
    // Louder than either talker alone, which is what "they are both there"
    // has to sound like. A 1/N normaliser would have made it quieter.
    expect(heard[0]).toBeGreaterThan(0.9);
  });

  it("does not let a lane that has run dry hold anybody else back", () => {
    /*
     * A talker who pauses, or whose next chunk is late, must contribute silence
     * and stay where it is. A shared queue could not express that at all: it
     * would advance whatever was at the front and put the pause into the other
     * speaker's audio.
     */
    const processor = loadPlayout();
    write(processor, { lane: 0, samples: flat(0.5, QUANTUM * 2) });
    write(processor, { lane: 1, samples: flat(0.25) });

    expect(render(processor)[0]).toBeCloseTo(0.75, 6);
    // Lane 1 is empty for this quantum; lane 0 carries on from where it was.
    expect(render(processor)[0]).toBeCloseTo(0.5, 6);

    // And lane 1's next chunk resumes into the sum, undamaged by the gap.
    write(processor, { lane: 1, samples: flat(0.25) });
    write(processor, { lane: 0, samples: flat(0.5) });
    expect(render(processor)[0]).toBeCloseTo(0.75, 6);
  });

  it("forgets a lane once it is closed and drained, and ignores a late write", () => {
    const processor = loadPlayout();
    write(processor, { lane: 0, samples: flat(0.5) });
    write(processor, { lane: 0, close: true });
    // The close does not truncate what the lane still holds: the sum has been
    // handed those samples and cutting them would clip the last word.
    expect(render(processor)[0]).toBeCloseTo(0.5, 6);
    expect(render(processor)[0]).toBe(0);

    // A write arriving after the lane is gone must not resurrect a finished
    // transmission on somebody else's lane number.
    write(processor, { lane: 0, samples: flat(0.5) });
    expect(render(processor)[0]).toBe(0);
  });

  it("is silence when nobody is talking", () => {
    expect([...render(loadPlayout())]).toEqual([...flat(0)]);
  });
});
