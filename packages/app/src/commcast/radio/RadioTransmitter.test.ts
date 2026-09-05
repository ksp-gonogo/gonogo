/**
 * The talking end: what goes on the wire when the key latches, and what the
 * operator is told when it cannot.
 *
 * The microphone is injected, so this exercises the sequencing and the envelope
 * without a secure context, a device or WebCodecs, all three of which jsdom
 * lacks and none of which decide anything tested here.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import type { RadioCapture, StartRadioCapture } from "./RadioTransmitter";
import { AMPLITUDE_HISTORY, RadioTransmitter } from "./RadioTransmitter";
import type { RadioFrame } from "./wire";

const ARES = "vessel:ares";
const KSC = "ksc";

const JEB = {
  to: [KSC],
  from: ARES,
  authorStationKey: "pilot-1",
  authorName: "Jeb",
  authorSeat: "pilot" as const,
  separationSeconds: 240,
};

afterEach(() => {
  for (const budget of PerfBudget.getAll()) budget.reset();
});

/** A microphone under the test's control: it opens when told and speaks when
 *  told, so nothing here depends on a device or a timer. */
function fakeMic() {
  let emit: ((bytes: Uint8Array, amplitude: number) => void) | null = null;
  let stops = 0;
  let openings = 0;
  let resolve: ((capture: RadioCapture) => void) | null = null;
  let reject: ((err: unknown) => void) | null = null;
  const capture: RadioCapture = {
    stop: () => {
      stops += 1;
      emit = null;
    },
  };
  const start: StartRadioCapture = (onChunk) => {
    openings += 1;
    emit = onChunk;
    return new Promise<RadioCapture>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    start,
    open: () => resolve?.(capture),
    fail: (err: unknown) => reject?.(err),
    speak: (bytes = new Uint8Array([1, 2, 3]), amplitude = 0.5) =>
      emit?.(bytes, amplitude),
    get stops() {
      return stops;
    },
    get openings() {
      return openings;
    },
  };
}

function scene(utNow: () => number | undefined = () => 1000) {
  const sent: RadioFrame[] = [];
  const mic = fakeMic();
  const transmitter = new RadioTransmitter({
    send: (frame) => sent.push(frame),
    utNow,
    startCapture: mic.start,
  });
  return { sent, mic, transmitter };
}

describe("radio transmit, one keying", () => {
  it("opens with the envelope and then streams numbered chunks", async () => {
    let ut = 1000;
    const { sent, mic, transmitter } = scene(() => ut);
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;

    const opening = sent[0];
    expect(opening?.kind).toBe("start");
    if (opening?.kind !== "start") throw new Error("no start frame");
    expect(opening.transmission.from).toBe(ARES);
    expect(opening.transmission.to).toEqual([KSC]);
    expect(opening.transmission.separationSeconds).toBe(240);
    expect(opening.transmission.startedUt).toBe(1000);

    ut = 1000.02;
    mic.speak(new Uint8Array([9]));
    ut = 1000.04;
    mic.speak(new Uint8Array([8]));
    transmitter.keyUp();

    const kinds = sent.map((f) => f.kind);
    expect(kinds).toEqual(["start", "chunk", "chunk", "end"]);
    const chunks = sent.filter((f) => f.kind === "chunk");
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    /*
     * Each chunk carries the transmitter's OWN present at capture, not the
     * frozen start plus an offset: a warp or a revert moves the clock, and a
     * stream timed off a stale anchor would land at instants the far end has
     * already passed.
     */
    expect(chunks.map((c) => c.ut)).toEqual([1000.02, 1000.04]);
    // Every frame carries the station key, because that is what the relay drops
    // its own echo on. A host and a station at one centre share a vantage and
    // must still hear each other.
    expect(sent.every((f) => f.authorStationKey === "pilot-1")).toBe(true);
    expect(mic.stops).toBe(1);
  });

  it("keeps transmitting with NO PATH, because loss of path stops delivery", async () => {
    // Refusing the press would make this end decide something only the other
    // end can answer. The bar turns and flags NO PATH; the operator keeps
    // talking, and anyone who does have a path to this vantage hears it.
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown({ ...JEB, separationSeconds: null });
    mic.open();
    await keying;
    mic.speak();

    const opening = sent[0];
    if (opening?.kind !== "start") throw new Error("no start frame");
    expect(opening.transmission.separationSeconds).toBeNull();
    expect(sent.filter((f) => f.kind === "chunk")).toHaveLength(1);
    expect(transmitter.snapshot().live).toBe(true);
  });

  it("ends the keying once, however many times it is unkeyed", async () => {
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    transmitter.keyUp();
    transmitter.keyUp();
    expect(sent.filter((f) => f.kind === "end")).toHaveLength(1);
  });

  it("sends nothing once unkeyed, whatever the microphone does next", async () => {
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    transmitter.keyUp();
    mic.speak();
    expect(sent.filter((f) => f.kind === "chunk")).toHaveLength(0);
  });
});

describe("radio transmit, when it cannot", () => {
  it("names a refused microphone rather than doing nothing", async () => {
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.fail(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await keying;
    expect(transmitter.snapshot()).toMatchObject({
      live: false,
      fault: "MIC DENIED",
    });
    expect(sent).toHaveLength(0);
  });

  it("refuses to key with no clock, and says so", async () => {
    const { sent, transmitter } = scene(() => undefined);
    await transmitter.keyDown(JEB);
    expect(transmitter.snapshot().fault).toBe("NO CLOCK");
    expect(sent).toHaveLength(0);
  });

  it("does not go live behind an operator who let go while it was opening", async () => {
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    transmitter.keyUp();
    mic.open();
    await keying;
    expect(transmitter.snapshot().live).toBe(false);
    // Nothing was ever announced on the wire, so there is nothing to end.
    expect(sent).toHaveLength(0);
    expect(mic.stops).toBe(1);
  });

  it("ignores a second key-down while already live", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    await transmitter.keyDown(JEB);
    expect(mic.openings).toBe(1);
  });
});

/**
 * The waveform the delay rail draws. It rides alongside the bytes and never
 * touches the wire: it is the operator's own voice, on the operator's own rail.
 */
describe("radio transmit, the waveform it keeps for its own rail", () => {
  it("keeps one reading per chunk, newest last", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    mic.speak(new Uint8Array([1]), 0.2);
    mic.speak(new Uint8Array([2]), 0.9);
    expect(transmitter.snapshot().amplitudes).toEqual([0.2, 0.9]);
  });

  it("publishes a fresh array, so a snapshot reader can see it move", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    mic.speak(new Uint8Array([1]), 0.2);
    const first = transmitter.snapshot().amplitudes;
    mic.speak(new Uint8Array([2]), 0.4);
    expect(transmitter.snapshot().amplitudes).not.toBe(first);
  });

  it("puts nothing on the wire", async () => {
    const { sent, mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    mic.speak(new Uint8Array([1]), 0.7);
    expect(JSON.stringify(sent)).not.toContain("amplitude");
  });

  it("starts the next transmission empty rather than carrying the last one's tail", async () => {
    const { mic, transmitter } = scene();
    const first = transmitter.keyDown(JEB);
    mic.open();
    await first;
    mic.speak(new Uint8Array([1]), 0.8);
    transmitter.keyUp();

    const second = transmitter.keyDown(JEB);
    mic.open();
    await second;
    expect(transmitter.snapshot().amplitudes).toEqual([]);
  });

  it("stays bounded however long the operator leans on the key", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    for (let i = 0; i < AMPLITUDE_HISTORY * 2; i++) {
      mic.speak(new Uint8Array([1]), 0.5);
    }
    expect(transmitter.snapshot().amplitudes).toHaveLength(AMPLITUDE_HISTORY);
  });

  it("refuses to pass on a broken reading as geometry", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    mic.speak(new Uint8Array([1]), Number.NaN);
    mic.speak(new Uint8Array([2]), 4);
    expect(transmitter.snapshot().amplitudes).toEqual([0, 1]);
  });
});

describe("radio transmit, inside its budgets", () => {
  it("records every chunk it sends, and a talker stays well under the cap", async () => {
    const { mic, transmitter } = scene();
    const keying = transmitter.keyDown(JEB);
    mic.open();
    await keying;
    for (let i = 0; i < 50; i++) mic.speak(new Uint8Array(86));

    const chunks = PerfBudget.getAll().find(
      (b) => b.name === "CommcastRadio chunks/sec",
    );
    const bytes = PerfBudget.getAll().find(
      (b) => b.name === "CommcastRadio encoded bytes/sec",
    );
    expect(chunks?.rate()).toBe(50);
    expect(bytes?.rate()).toBe(50 * 86);
    expect(chunks?.getExceedanceCount()).toBe(0);
    expect(bytes?.getExceedanceCount()).toBe(0);
  });
});
