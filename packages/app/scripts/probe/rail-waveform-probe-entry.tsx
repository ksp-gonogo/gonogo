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
  /** Chunks spoken before the shot, at 20 ms each. */
  chunkCount: number;
  /** One-way light-time to the far end, exactly as `RadioPtt` is handed it. */
  separationSeconds: number;
  panelTitle: string;
  pxW: number;
  pxH: number;
}

/** What the page measured, so a picture is never the only evidence. */
export interface RailWaveformProbeReading {
  /** Samples the transmitter actually accumulated (capped at `AMPLITUDE_HISTORY`). */
  sampleCount: number;
  spanSamples: number;
  /** Fraction of the rail's full journey the drawn trace covers, 0..1. */
  extentFraction: number;
  /** Turning points in the drawn path: what the reader has to see a wave in. */
  turningPoints: number;
  /** The fixture's own spread. A flat ribbon is the failure this guards. */
  minAmplitude: number;
  maxAmplitude: number;
  distinctAmplitudes: number;
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

/**
 * Key a real transmitter with the clip and let it say everything, then take the
 * ring it built. No timers: `speakAll` runs the clip through in one go, which
 * is what makes the shot the same picture every run.
 */
async function amplitudesOf(clip: RadioClip): Promise<readonly number[]> {
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
    separationSeconds: null,
  });
  mic.speakAll();
  const amplitudes = transmitter.snapshot().amplitudes ?? [];
  /*
   * Read BEFORE unkeying, and kept: `keyUp` ends the transmission, and the
   * ribbon is a picture of a key that is still down.
   */
  transmitter.dispose();
  return amplitudes;
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

/** What the component's own geometry function makes of this scene. */
function measure(
  amplitudes: readonly number[],
  spanSamples: number,
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
  return {
    sampleCount: amplitudes.length,
    spanSamples,
    extentFraction: lastX / boundaryX,
    turningPoints: points.length,
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
  const amplitudes = await amplitudesOf(
    clipFor(payload.voice, payload.chunkCount),
  );
  const spanSamples = crossingSpanSamples(payload.separationSeconds);

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
    ...measure(amplitudes, spanSamples),
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
