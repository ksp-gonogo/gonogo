import { PerfBudget } from "@ksp-gonogo/core";
import {
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import launchpad from "./__fixtures__/kerbin-launchpad.json";
import orbiting from "./__fixtures__/kerbin-lko-equator.json";
import { useGroundTrackPrediction } from "./useGroundTrackPrediction";
import { useMapTelemetry } from "./useMapTelemetry";

/** The rig's light-time, so the modelled position is asked for as well as the track. */
const DELAY = 40;

interface Scene {
  _stream: { emits: { channel: string; value: unknown }[]; pinnedUt?: number };
}

/**
 * The launchpad scene with the patch KSP sends for an active craft even on the
 * ground: its elements as they stand, starting at the sample and running one
 * period. The conic falls through the surface at once, so there is a patch
 * chain and no track.
 */
function onTheGroundWithItsPatch(): Scene {
  const emits = launchpad._stream.emits.map((emit) => {
    if (emit.channel !== "vessel.orbit") return emit;
    const orbit = emit.value as {
      sma: number;
      ecc: number;
      mu: number;
      epoch: number;
    };
    const period = 2 * Math.PI * Math.sqrt(orbit.sma ** 3 / orbit.mu);
    return {
      ...emit,
      value: {
        ...orbit,
        patches: [
          {
            ...orbit,
            period,
            startUt: orbit.epoch,
            endUt: orbit.epoch + period,
            patchStartTransition: 0,
            patchEndTransition: 1,
            peA: orbit.sma * (1 - orbit.ecc) - 600_000,
            apA: orbit.sma * (1 + orbit.ecc) - 600_000,
            semiLatusRectum: orbit.sma * (1 - orbit.ecc ** 2),
            semiMinorAxis: orbit.sma * Math.sqrt(1 - orbit.ecc ** 2),
            referenceBody: "Kerbin",
            referenceBodyIndex: 1,
          },
        ],
      },
    };
  });
  return { _stream: { ...launchpad._stream, emits } };
}

let segments = 0;

/** The map's own reads and its prediction, wired as `MapView` wires them. */
function Probe() {
  const telemetry = useMapTelemetry(undefined);
  const { predictionSegments } = useGroundTrackPrediction({
    enabled: telemetry.predictable,
    trajectory: telemetry.trajectory,
    orbitPatches: telemetry.orbitPatches,
    maneuverNodes: telemetry.maneuverNodes,
    targetBodyId: telemetry.targetBodyId,
    body: telemetry.body,
    lat: telemetry.lat,
    lon: telemetry.lon,
    universalTime: telemetry.universalTime,
  });
  segments = predictionSegments.length;
  return null;
}

/** See `useModelledPosition.test.tsx`: the provider books a store frame on the next animation frame, which has to land inside `act`. */
function scheduledFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Mounts the map's reads over a scene delivered once, then renders `frames`
 * more frames a sixtieth of a second apart with nothing new arriving, and
 * answers how many times the ground track was predicted across those frames.
 */
async function predictionsOverIdleFrames(
  scene: Scene,
  frames: number,
): Promise<number> {
  const budget = PerfBudget.getAll().find((b) =>
    b.name.startsWith("predictGroundTrack"),
  );
  if (!budget)
    throw new Error("the predictGroundTrack budget is not registered");
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => DELAY,
  });
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES,
  });
  clock.suspendFrames();
  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );
  const taken = scene._stream.pinnedUt ?? 100;
  const frame = async () => {
    clock.emitFrame();
    store.beginFrame();
    await scheduledFrame();
  };
  await act(async () => {
    for (const emit of scene._stream.emits) {
      transport.emit(emit.channel, emit.value, {
        validAt: taken,
        deliveredAt: taken + DELAY,
      });
    }
    await frame();
  });
  // One more frame to let the first solve settle, then count from a clean window.
  await act(async () => {
    wall.advanceBy(1 / 60);
    await frame();
  });
  budget.reset();
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      wall.advanceBy(1 / 60);
      await frame();
    });
  }
  return budget.rate();
}

describe("MapView's ground track prediction", () => {
  it("is not solved again on a frame whose inputs have not changed", async () => {
    // Thirty frames is half a second: the one-second bucket can turn over once, and nothing else has moved.
    const calls = await predictionsOverIdleFrames(orbiting, 30);
    expect(segments).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("is not asked for at all while the craft is on the ground, where there is no track to lay", async () => {
    const calls = await predictionsOverIdleFrames(
      onTheGroundWithItsPatch(),
      30,
    );
    expect(segments).toBe(0);
    expect(calls).toBe(0);
  });
});
