import strong from "../../components/src/CommSignal/__fixtures__/strong-direct-ksc.json";
import { linkUp, PLAYBACK_SECONDS, signalQuality } from "./commsPlaybackModel";
import type { PlaybackEmit, PlaybackScenario } from "./playbackTypes";

const FULL_STRENGTH = 0.87;
const ONE_WAY_SECONDS = 1.3;
const SAMPLE_SECONDS = 0.5;
/** Below this strength the craft keeps only part of its control. */
const PARTIAL_CONTROL_BELOW = 0.35;

export function controlStateAt(t: number): number {
  if (!linkUp(t)) return 0;
  return signalQuality(t) * FULL_STRENGTH < PARTIAL_CONTROL_BELOW ? 3 : 4;
}

function frameAt(t: number) {
  const up = linkUp(t);
  const strength = up ? signalQuality(t) * FULL_STRENGTH : 0;
  const emits: PlaybackEmit[] = [
    { channel: "comms.link", value: { connected: up } },
    {
      channel: "comms.delay",
      value: { oneWaySeconds: up ? ONE_WAY_SECONDS : null },
    },
    {
      channel: "vessel.comms",
      value: {
        connected: up,
        signalStrength: strength,
        signalQuantity: 1,
        controlState: controlStateAt(t),
      },
    },
    {
      channel: "comms.signal",
      value: { strength, quantity: 1, modelled: false, otherPath: false },
    },
  ];
  return {
    emits,
    caption: up
      ? `Link up, signal ${Math.round(strength * 100)} of 100`
      : "No link",
  };
}

export function commSignalScenario(): PlaybackScenario {
  const steps = Math.round(PLAYBACK_SECONDS / SAMPLE_SECONDS);
  const dynamic = new Set([
    "comms.link",
    "comms.delay",
    "vessel.comms",
    "comms.signal",
  ]);
  return {
    widgetId: "comm-signal",
    scenario: "blackout-playback",
    notes: "SYNTHETIC (model-generated, NOT captured).",
    staticEmits: strong._stream.emits.filter((e) => !dynamic.has(e.channel)),
    frames: Array.from({ length: steps + 1 }, (_, i) =>
      frameAt(i * SAMPLE_SECONDS),
    ),
    stepMs: 500,
    defaultSize: { w: 8, h: 8 },
  };
}
