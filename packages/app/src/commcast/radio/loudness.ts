import { chunkAmplitude, chunkWave, type WaveBlock } from "./amplitude";
import type { RadioAudioSink } from "./RadioSession";

/**
 * A sink that reports how loud each block it is handed is, and its lowest and
 * highest sample, before passing it on. The reading is taken from the decoded audio on the listening screen, so
 * nothing about loudness is carried on the wire. Used by both the real
 * receiver and the recording one, so what the rail draws of an arriving voice
 * is read the same way in a browser and in a test.
 */
export function withLoudness(
  sink: RadioAudioSink,
  onLoudness: ((amplitude: number, wave: WaveBlock) => void) | undefined,
): RadioAudioSink {
  if (onLoudness === undefined) return sink;
  return {
    play: (samples, sampleRate) => {
      // Read before the block is handed on: the real sink transfers its buffer away.
      onLoudness(chunkAmplitude(samples), chunkWave(samples));
      sink.play(samples, sampleRate);
    },
    close: () => sink.close(),
  };
}
