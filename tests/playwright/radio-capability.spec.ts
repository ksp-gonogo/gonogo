import { expect, test } from "@playwright/test";
import {
  RADIO_CHUNK_FRAMES,
  RADIO_DECODER_CONFIG,
  RADIO_ENCODER_CONFIG,
  RADIO_REQUIRED_GLOBALS,
} from "../../mod/sitrep-sdk/src/media/radio-support";

/**
 * The cross-engine capability ratchet under `isRadioSupported()`: does
 * WebCodecs Opus actually encode and decode here, on every engine the
 * matrix runs, and does the encoded stream have the properties the radio
 * design is sized against.
 *
 * The design's numbers were measured by hand once. This spec is what makes
 * them hold: a codec that silently stops emitting, an engine that ignores
 * the bitrate hint and falls back to something PCM-sized, or an encoder
 * that starts producing delta chunks would each break the transport
 * budget or the drop-oldest eviction the design relies on, and each shows
 * up here rather than in a live mission.
 *
 * The constants come from `radio-support.ts` rather than being restated,
 * so the probe measures the configuration the radio will actually
 * transmit at.
 *
 * ## Why the secure-context test is first
 *
 * The very first hand run of this probe was a FALSE NEGATIVE. On
 * `about:blank` chromium and firefox both report `AudioEncoder` absent, so
 * a presence-only check calls them unsupported: the two engines whose
 * codec is in fact fine. WebKit gets it wrong the other way, exposing the
 * constructors on an insecure origin where the microphone will be refused
 * anyway. The first test below holds the insecure origin's observable
 * facts in place so that misreading cannot come back.
 */

/**
 * Encoded bytes per second of audio, the band `RADIO_ENCODER_CONFIG`'s
 * measured output must stay inside.
 *
 * Measured 2026-09-05 on this repo's cached browsers: chromium 3331,
 * firefox 4338, webkit 3946. `bitrate: 24000` nominally asks for 3000, and
 * firefox overshoots it; the band is deliberately wide enough that normal
 * per-version codec drift does not go red, and narrow enough to catch the
 * two failures that matter: an encoder emitting nothing, and an engine
 * falling back to something PCM-sized (int16 mono at 16 kHz is 32000).
 */
const BYTE_RATE_BAND = { min: 2_000, max: 6_000 } as const;

/** 1 s of tone, at 20 ms per chunk. */
const CHUNKS_TO_ENCODE = 50;

interface ContextFacts {
  isSecureContext: unknown;
  present: string[];
  absent: string[];
}

const readContextFacts = (names: string[]): ContextFacts => ({
  isSecureContext:
    "isSecureContext" in globalThis ? globalThis.isSecureContext : undefined,
  present: names.filter((n) => n in globalThis),
  absent: names.filter((n) => !(n in globalThis)),
});

test.describe("radio capability: WebCodecs Opus", () => {
  test("an insecure origin is refused, and presence alone would not refuse it", async ({
    page,
  }) => {
    // A fresh page sits on about:blank, which is an insecure context in
    // all three engines.
    const facts = await page.evaluate(readContextFacts, [
      ...RADIO_REQUIRED_GLOBALS,
    ]);

    // The fact `radioSupportStatus()` reads first, and the one that makes
    // its verdict differ from a bare feature detect.
    expect(facts.isSecureContext).toBe(false);

    // The planted failure, standing: a presence-only probe does NOT refuse
    // here. `AudioData` and `EncodedAudioChunk` exist on an insecure origin
    // in every engine, and webkit exposes the encoder and decoder too, so
    // dropping the secure-context question would let this origin through
    // on at least one engine and would blame the codec on the others.
    expect(facts.present).not.toEqual([]);

    console.info(
      `[radio] insecure origin (${test.info().project.name}): present=${facts.present.join(",") || "none"} absent=${facts.absent.join(",") || "none"}`,
    );
  });

  test("a secure origin exposes every constructor the radio needs", async ({
    page,
  }) => {
    await page.goto("/");
    const facts = await page.evaluate(readContextFacts, [
      ...RADIO_REQUIRED_GLOBALS,
    ]);

    // localhost is a potentially-trustworthy origin, so the dev server is
    // secure without https. A station reaching the same server at
    // http://<lan-ip>:5173 is NOT, which is the documented LAN limitation.
    expect(facts.isSecureContext).toBe(true);
    expect(facts.absent).toEqual([]);
  });

  test("Opus encodes and decodes, all-key, inside the measured byte-rate band", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(
      async ({ encoderConfig, decoderConfig, chunkFrames, chunkCount }) => {
        const encoderSupported = (
          await AudioEncoder.isConfigSupported(encoderConfig)
        ).supported;
        const decoderSupported = (
          await AudioDecoder.isConfigSupported(decoderConfig)
        ).supported;

        const encoded: { type: EncodedAudioChunkType; bytes: Uint8Array }[] =
          [];
        let encodeError: string | null = null;
        const encoder = new AudioEncoder({
          output: (chunk) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            encoded.push({ type: chunk.type, bytes });
          },
          error: (e) => {
            encodeError = String(e);
          },
        });
        encoder.configure(encoderConfig);

        const sampleRate = encoderConfig.sampleRate;
        for (let i = 0; i < chunkCount; i++) {
          const samples = new Float32Array(chunkFrames);
          for (let n = 0; n < chunkFrames; n++) {
            const t = (i * chunkFrames + n) / sampleRate;
            samples[n] = Math.sin(2 * Math.PI * 440 * t) * 0.5;
          }
          const audio = new AudioData({
            format: "f32-planar",
            sampleRate,
            numberOfFrames: chunkFrames,
            numberOfChannels: encoderConfig.numberOfChannels,
            timestamp: Math.round((i * chunkFrames * 1e6) / sampleRate),
            data: samples,
          });
          encoder.encode(audio);
          audio.close();
        }
        await encoder.flush();
        encoder.close();

        let decodedFrames = 0;
        let decodeError: string | null = null;
        const decoder = new AudioDecoder({
          output: (audio) => {
            decodedFrames += audio.numberOfFrames;
            audio.close();
          },
          error: (e) => {
            decodeError = String(e);
          },
        });
        decoder.configure(decoderConfig);
        for (const [i, chunk] of encoded.entries()) {
          decoder.decode(
            new EncodedAudioChunk({
              type: chunk.type,
              timestamp: Math.round((i * chunkFrames * 1e6) / sampleRate),
              duration: Math.round((chunkFrames * 1e6) / sampleRate),
              data: chunk.bytes,
            }),
          );
        }
        await decoder.flush();
        decoder.close();

        return {
          encoderSupported,
          decoderSupported,
          encodeError,
          decodeError,
          chunkCount: encoded.length,
          keyChunks: encoded.filter((c) => c.type === "key").length,
          totalBytes: encoded.reduce((sum, c) => sum + c.bytes.byteLength, 0),
          encodedSeconds: (chunkCount * chunkFrames) / sampleRate,
          decodedSeconds: decodedFrames / sampleRate,
        };
      },
      {
        encoderConfig: RADIO_ENCODER_CONFIG,
        decoderConfig: RADIO_DECODER_CONFIG,
        chunkFrames: RADIO_CHUNK_FRAMES,
        chunkCount: CHUNKS_TO_ENCODE,
      },
    );

    expect(result.encodeError).toBeNull();
    expect(result.decodeError).toBeNull();
    expect(result.encoderSupported).toBe(true);
    expect(result.decoderSupported).toBe(true);

    // One chunk per 20 ms grid slot, plus at most a few the encoder adds
    // for Opus pre-skip / lookahead.
    expect(result.chunkCount).toBeGreaterThanOrEqual(CHUNKS_TO_ENCODE);
    expect(result.chunkCount).toBeLessThanOrEqual(CHUNKS_TO_ENCODE + 5);

    // Every audio chunk is a keyframe: no GOP, no inter-frame dependency.
    // This is what lets the playout buffer evict oldest-first for 20 ms of
    // damage instead of falling back to the oldest-keyframe path, and it is
    // an assumption the design leans on rather than a curiosity.
    expect(result.keyChunks).toBe(result.chunkCount);

    // Round trip: what comes out is the second of audio that went in.
    // Opus pre-skip means slightly more, never less.
    expect(result.decodedSeconds).toBeGreaterThanOrEqual(
      result.encodedSeconds * 0.98,
    );
    expect(result.decodedSeconds).toBeLessThanOrEqual(
      result.encodedSeconds * 1.1,
    );

    const byteRate = result.totalBytes / result.encodedSeconds;
    console.info(
      `[radio] ${test.info().project.name}: ${byteRate.toFixed(0)} bytes/sec over ${result.chunkCount} chunks, decoded ${result.decodedSeconds.toFixed(3)}s from ${result.encodedSeconds.toFixed(3)}s`,
    );
    expect(byteRate).toBeGreaterThan(BYTE_RATE_BAND.min);
    expect(byteRate).toBeLessThan(BYTE_RATE_BAND.max);
  });
});
