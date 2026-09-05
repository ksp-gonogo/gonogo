/**
 * What the speakers do when they are closed before they finish opening.
 *
 * The rest of `webaudio.ts` is the one file in this folder that cannot be
 * exercised without a browser, which is why the clip backend exists. This much
 * can: the sink's failure mode is a PROMISE, and a promise nobody catches is
 * an uncaught error whatever it was built on.
 */
import { describe, expect, it } from "vitest";
import { WebAudioRadioSink } from "./webaudio";

/** A context that opens its worklet a turn late, the way a real one does. */
class StubAudioContext {
  closed = false;
  destination = {};
  audioWorklet = {
    addModule: async () => {
      await Promise.resolve();
    },
  };
  resume = async () => {};
  close = async () => {
    this.closed = true;
  };
}

function install(): void {
  const holder = globalThis as unknown as Record<string, unknown>;
  holder.AudioContext = StubAudioContext;
  /*
   * Throws on a closed context, which is what the browser does and what the
   * whole test is about. A stub that constructed happily would pass with the
   * defect in place, so the throw is the plant.
   */
  holder.AudioWorkletNode = class {
    port = { postMessage: () => {} };
    connect = () => {};
    constructor(ctx: unknown) {
      if ((ctx as StubAudioContext).closed) {
        throw new Error(
          "AudioWorkletNode cannot be created: No execution context available.",
        );
      }
    }
  };
  holder.URL = Object.assign(holder.URL as object, {
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => {},
  });
}

/** Every rejection nobody handled, for the length of one test. */
function watchUnhandled(): { rejections: unknown[]; stop: () => void } {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  return {
    rejections,
    stop: () => void process.off("unhandledRejection", onRejection),
  };
}

describe("the web-audio sink", () => {
  it("closes quietly when it is shut before its worklet is up", async () => {
    /*
     * The listener who muted, changed conversation or shut the tab before
     * anybody spoke. Node is two turns from having a playout node and the sink
     * is gone in one, so the node is built against a context that has already
     * closed; before this, the rejection that produced had nothing attached to
     * it, because the only `catch` lived in a `play` this sink never saw.
     */
    install();
    const watch = watchUnhandled();
    try {
      const sink = new WebAudioRadioSink(48_000);
      sink.close();
      // Long enough for the worklet turn, the node turn, and Node's own check.
      await new Promise((r) => setTimeout(r, 20));
      expect(watch.rejections).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it("still plays when it is left open", async () => {
    // The other direction: a sink that swallowed everything would pass the test
    // above by never working at all.
    install();
    const sent: Float32Array[] = [];
    const holder = globalThis as unknown as Record<string, unknown>;
    holder.AudioWorkletNode = class {
      port = { postMessage: (s: Float32Array) => sent.push(s) };
      connect = () => {};
    };
    const sink = new WebAudioRadioSink(48_000);
    sink.play(new Float32Array([0.5, -0.5]));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });
});
