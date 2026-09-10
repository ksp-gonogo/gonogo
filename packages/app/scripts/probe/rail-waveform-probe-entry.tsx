/**
 * Standalone probe for the delay rail's voice ribbon (`RailCrossing`, the
 * `mark === "ribbon"` half).
 *
 * The ribbon has exactly one production caller, `RadioPtt`, and it registers
 * its crossing only while the operator is holding the key in a radio session
 * with a peer. Nothing else in the tree draws one, so outside a live two-party
 * transmission the waveform is unphotographable, and it has never been
 * photographed. This probe is the instrument for it.
 *
 * It reproduces that caller rather than standing in for it: a real
 * `RadioTransmitter` is keyed with a `clipMic`, every chunk is spoken, and the
 * amplitude ring the transmitter accumulates (`RadioTransmitState.amplitudes`,
 * measured chunk by chunk through `chunkAmplitude` over real PCM) is handed to
 * `usePanelCrossing` with `VOICE_RAIL_TAGS` and the span `RadioPtt` would have
 * computed. What the rail draws here is what the rail draws on air.
 *
 * The measurement the driver prints beside each shot comes from `waveformPath`
 * itself, not from a description of it: how far along the rail the trace
 * actually reaches is the number in question, so it is read off the geometry
 * the component draws.
 */
import { safeRandomUuid } from "@ksp-gonogo/core";
import {
  crossingBoundaryX,
  DelayRailProvider,
  Panel,
  usePanelCrossing,
  VOICE_RAIL_TAGS,
  waveformPath,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  clipMic,
  makeClip,
  type RadioClip,
} from "../../src/commcast/radio/clips";
import { crossingSpanSamples } from "../../src/commcast/radio/RadioPtt";
import { RadioTransmitter } from "../../src/commcast/radio/RadioTransmitter";
import {
  makeCurveClip,
  SILENCE_CURVE,
  SPEECH_CURVE,
} from "./railWaveformClips";

/** Which utterance a scene keys. */
export type RailWaveformVoice = "speech" | "silence" | "stock";

export interface RailWaveformProbePayload {
  voice: RailWaveformVoice;
  /**
   * Chunks spoken before the shot, at 20 ms each, i.e. how long the operator
   * has been keyed. Past the ring's length the transmitter starts discarding
   * its oldest, and the trace stops short of the boundary by exactly the audio
   * it dropped, which is the whole subject.
   */
  chunkCount: number;
  /** One-way light-time to the far end, exactly as `RadioPtt` is handed it. */
  separationSeconds: number;
  panelTitle: string;
  pxW: number;
  pxH: number;
}

/** What the page measured, so a picture is never the only evidence. */
export interface RailWaveformProbeReading {
  /** Samples the transmitter retained, i.e. how long `amplitudeHistoryFor` made the ring. */
  sampleCount: number;
  /** Chunks the transmitter reports having SENT, uncapped. */
  emittedSamples: number;
  spanSamples: number;
  /**
   * Fraction of the rail's full journey the drawn trace covers, 0..1: how much
   * of the gap the transmitter can still account for. `x` is age, so this is a
   * measurement of held history and not a length the drawing chose.
   */
  extentFraction: number;
  /** Turning points in the drawn path: what the reader has to see a wave in. */
  turningPoints: number;
  /** The fixture's own spread. A flat ribbon is the failure this guards. */
  minAmplitude: number;
  maxAmplitude: number;
  distinctAmplitudes: number;
  /**
   * How high the DRAWN turning points reached, as a fraction of full scale, and
   * how many distinct heights are among them.
   *
   * Separate from the fixture's own spread on purpose. A stretched trace reads
   * ~49 turning points out of a 128-sample ring, so it DECIMATES, and a fixture
   * with plenty of spread could in principle be sampled at one phase of its own
   * period and come out flat. The question "can a sentence still be told from
   * an open dead key" is a question about the path, so it is asked of the path.
   *
   * **The range and the count, not a single spread figure.** A spread alone is
   * blind exactly where the resolution cap bites: below a chunk of light-time
   * the trace is three points at one amplitude, and a chevron of voice and a
   * flat dead key both have a spread of zero. What separates them there is the
   * HEIGHT, so the height is reported.
   */
  drawnPeakMin: number;
  drawnPeakMax: number;
  drawnDistinctHeights: number;
}

let activeRoot: Root | null = null;

function clipFor(voice: RailWaveformVoice, chunkCount: number): RadioClip {
  switch (voice) {
    case "speech":
      return makeCurveClip("go for the burn", chunkCount, SPEECH_CURVE);
    case "silence":
      return makeCurveClip(
        "open key, nobody talking",
        chunkCount,
        SILENCE_CURVE,
      );
    /*
     * The library clip, unaltered, so the render says what a fixture built the
     * obvious way looks like on the rail rather than only what a considered one
     * does. Its single raised cosine spans the whole utterance, which puts most
     * of its chunks over full scale.
     */
    case "stock":
      return makeClip("stock library clip", chunkCount);
  }
}

/** The ring the transmitter retained, and the chunk count it actually sent. */
interface SpokenTransmission {
  amplitudes: readonly number[];
  emittedSamples: number;
}

/**
 * Key a real transmitter with the clip and let it say everything, then take
 * both halves of what it reports: the ring it retained and how many chunks it
 * sent. No timers: `speakAll` runs the clip through in one go, which is what
 * makes the shot the same picture every run.
 *
 * **Keyed at the scene's own separation**, because the transmitter now sizes its
 * ring from it (`amplitudeHistoryFor`), so a probe that keyed at `null` would
 * photograph the 128-sample floor at every separation and see none of the fix.
 *
 * That burst does put `RADIO_CHUNK_BUDGET` over its 250/s cap for a long clip,
 * which is a property of saying a minute of audio in one synchronous loop and
 * not of the transmitter. The budget's own warning is throttled to one a
 * window; nothing here is measuring a rate.
 */
async function amplitudesOf(
  clip: RadioClip,
  separationSeconds: number,
): Promise<SpokenTransmission> {
  const mic = clipMic(clip);
  const transmitter = new RadioTransmitter({
    send: () => {},
    utNow: () => 0,
    startCapture: mic.start,
  });
  await transmitter.keyDown({
    to: ["vessel:ares-4"],
    from: "ksc",
    authorStationKey: safeRandomUuid(),
    authorName: "CAPCOM",
    authorSeat: "mission-control",
    separationSeconds,
  });
  mic.speakAll();
  /*
   * Read BEFORE unkeying, and kept: `keyUp` ends the transmission, and the
   * ribbon is a picture of a key that is still down.
   */
  const state = transmitter.snapshot();
  const spoken: SpokenTransmission = {
    amplitudes: state.amplitudes ?? [],
    emittedSamples: state.chunks,
  };
  transmitter.dispose();
  return spoken;
}

function CrossingRegistrar({
  amplitudes,
  spanSamples,
}: {
  amplitudes: readonly number[];
  spanSamples: number;
}) {
  /* Memoised so the crossing the rail holds is one stable value: `RadioPtt`'s
     is a fresh literal per render only because a live ring changes every 20 ms,
     and here nothing changes at all. */
  const crossing = useMemo(
    () => ({
      tags: VOICE_RAIL_TAGS,
      label: "Your transmission crossing to Ares 4",
      amplitudes,
      spanSamples,
    }),
    [amplitudes, spanSamples],
  );
  usePanelCrossing(crossing);
  return null;
}

function Harness({
  amplitudes,
  spanSamples,
  panelTitle,
}: {
  amplitudes: readonly number[];
  spanSamples: number;
  panelTitle: string;
}) {
  return (
    <DelayRailProvider>
      <Panel panelTitle={panelTitle}>
        <CrossingRegistrar amplitudes={amplitudes} spanSamples={spanSamples} />
        <div
          style={{
            padding: "var(--space-8, 8px)",
            minHeight: 120,
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          widget body
        </div>
      </Panel>
    </DelayRailProvider>
  );
}

/** Half the band, in viewBox units: `RailCrossing`'s own `WAVE_HALF_H`. */
const BAND_HALF_H = 5.5;
/** The band's centre line, `RailCrossing`'s `MID_Y`. */
const BAND_MID_Y = 8;

/** What the component's own geometry function makes of this scene. */
function measure(
  amplitudes: readonly number[],
  spanSamples: number,
  emittedSamples: number,
): Omit<
  RailWaveformProbeReading,
  "minAmplitude" | "maxAmplitude" | "distinctAmplitudes"
> {
  // Voice is fire-and-forget, so the journey ends at the boundary rather than
  // running out and back.
  const boundaryX = crossingBoundaryX(false);
  const path = waveformPath(amplitudes, spanSamples, boundaryX);
  const points = path === "" ? [] : path.slice(1).split(" L");
  const lastX =
    points.length === 0 ? 0 : Number(points[points.length - 1].split(",")[0]);
  /*
   * How high each turning point actually reached, as a fraction of full scale.
   * A dead key draws every one of them on the centre line, so the spread across
   * them is the reading that separates voice from silence.
   */
  const peaks = points.map(
    (pt) => Math.abs(Number(pt.split(",")[1]) - BAND_MID_Y) / BAND_HALF_H,
  );
  return {
    sampleCount: amplitudes.length,
    emittedSamples,
    spanSamples,
    extentFraction: lastX / boundaryX,
    turningPoints: points.length,
    drawnPeakMin: peaks.length === 0 ? 0 : Math.min(...peaks),
    drawnPeakMax: peaks.length === 0 ? 0 : Math.max(...peaks),
    drawnDistinctHeights: new Set(peaks.map((p) => p.toFixed(3))).size,
  };
}

async function renderRailWaveform(
  payload: RailWaveformProbePayload,
): Promise<RailWaveformProbeReading> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Rail-waveform probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  const { amplitudes, emittedSamples } = await amplitudesOf(
    clipFor(payload.voice, payload.chunkCount),
    payload.separationSeconds,
  );
  /*
   * The prop's documented fallback when there is no separation to scale
   * against, which is what `RailCrossing` would apply for itself. Spelt out
   * here so the printed reading names the number the drawing actually used.
   */
  const spanSamples =
    crossingSpanSamples(payload.separationSeconds) ?? amplitudes.length;

  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.background = "var(--color-surface-panel)";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(
    <Harness
      amplitudes={amplitudes}
      spanSamples={spanSamples}
      panelTitle={payload.panelTitle}
    />,
  );
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 300));

  return {
    ...measure(amplitudes, spanSamples, emittedSamples),
    minAmplitude: amplitudes.length === 0 ? 0 : Math.min(...amplitudes),
    maxAmplitude: amplitudes.length === 0 ? 0 : Math.max(...amplitudes),
    distinctAmplitudes: new Set(amplitudes.map((a) => a.toFixed(3))).size,
  };
}

declare global {
  interface Window {
    __renderRailWaveform: (
      payload: RailWaveformProbePayload,
    ) => Promise<RailWaveformProbeReading>;
  }
}

window.__renderRailWaveform = renderRailWaveform;
