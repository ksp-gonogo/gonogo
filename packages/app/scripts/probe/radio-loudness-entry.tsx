import { railTagsForControlAxis } from "@ksp-gonogo/sitrep-sdk";
import {
  ControlDelayStream,
  WAVE_HALF_H,
  WAVE_MID_Y,
  type WaveBlock,
  waveformBand,
} from "@ksp-gonogo/ui-kit";
import { createRoot } from "react-dom/client";
import { withLoudness } from "../../src/commcast/radio/loudness";
import {
  startWebAudioCapture,
  WebCodecsRadioDecoder,
} from "../../src/commcast/radio/webaudio";

/**
 * Browser half of the loudness check: the shipped capture path (getUserMedia into
 * the worklet, per-chunk RMS, Opus encode) and the shipped decode path (WebCodecs
 * Opus decode into a sink that reads each block's loudness), run against
 * whatever audio the browser's fake microphone is playing. Returns the
 * loudness each stage reported per 20 ms chunk.
 */
(
  window as unknown as { __run: (s: number, raw?: boolean) => Promise<unknown> }
).__run = async (seconds, raw) => {
  if (raw) {
    // For a proof only: the browser's own processing off, so a tone's steps are not reshaped by it.
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (c) =>
      original({
        audio: {
          ...(typeof c?.audio === "object" ? c.audio : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const outgoing: number[] = [];
  const outgoingWave: WaveBlock[] = [];
  const encoded: Uint8Array[] = [];
  const capture = await startWebAudioCapture((bytes, amplitude, wave) => {
    outgoing.push(amplitude);
    outgoingWave.push(wave ?? { lo: 0, hi: 0 });
    encoded.push(bytes);
  }, {});
  await sleep(seconds * 1000);
  capture.stop();
  const incoming: number[] = [];
  const incomingWave: WaveBlock[] = [];
  const decoder = new WebCodecsRadioDecoder(
    withLoudness({ play: () => {}, close: () => {} }, (a, w) => {
      incoming.push(a);
      incomingWave.push(w);
    }),
  );
  for (const [i, bytes] of encoded.entries()) decoder.decode(bytes, i * 20_000);
  await sleep(1_000);
  decoder.close();
  return { outgoing, incoming, outgoingWave, incomingWave };
};

/** The rail's own band for a set of blocks, drawn by the shipped function. */
(
  window as unknown as {
    __ribbon: (
      blocks: WaveBlock[],
      span: number,
      boundary: number,
    ) => { d: string; half: number; mid: number };
  }
).__ribbon = (blocks, span, boundary) => ({
  d: waveformBand(blocks, span, boundary),
  half: WAVE_HALF_H,
  mid: WAVE_MID_Y,
});

/**
 * Draws the shipped rail strip for a set of readings, the loudness trace above
 * and the wave below, so a page can put them next to the clip's own plot.
 */
(
  window as unknown as {
    __drawRails: (spec: {
      amplitudes: number[];
      waves: WaveBlock[];
      oneWaySeconds: number;
    }) => void;
  }
).__drawRails = ({ amplitudes, waves, oneWaySeconds }) => {
  const tags = railTagsForControlAxis("commcast.radio.transmit");
  const span = Math.max(oneWaySeconds, 5) / 0.02;
  const base = {
    id: "radio.voice",
    label: "Your transmission",
    oneWaySeconds,
    amplitudes,
    spanSamples: span,
    tags,
  };
  for (const [id, wave] of [
    ["rail-before", undefined],
    ["rail-after", waves],
  ] as const) {
    const host = document.getElementById(id);
    if (!host) continue;
    createRoot(host).render(
      <ControlDelayStream
        streams={[]}
        ribbons={[wave === undefined ? base : { ...base, wave }]}
        variant="rail"
      />,
    );
  }
};
