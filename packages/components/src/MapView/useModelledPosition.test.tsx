import { useTelemetry } from "@ksp-gonogo/core";
import {
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  useViewUt,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { useMemo } from "react";
import { describe, expect, it } from "vitest";
import { bodyNamed } from "../shared/streamBody";
import fixture from "./__fixtures__/kerbin-lko-equator.json";
import { useModelledPosition } from "./useModelledPosition";

const U0 = 1_234_567;
const DELAY = 40;
/** How far the ground point moves in a second on this orbit, in degrees of longitude. */
const GROUND_RATE = 0.173;

const emits = fixture._stream.emits;
const payloadOf = (channel: string) =>
  emits.find((e) => e.channel === channel)?.value;

/**
 * The orbit as KSP sends it for the active craft. `PatchedConicSolver` sets the
 * current patch's `StartUT` to the game clock on every update, so the patch
 * starts at the sample's own instant and runs one period from there.
 */
function orbitSampledAt(validAt: number) {
  const orbit = payloadOf("vessel.orbit") as {
    patches: { startUt: number; endUt: number; period: number }[];
  };
  return {
    ...orbit,
    patches: orbit.patches.map((patch) => ({
      ...patch,
      startUt: validAt,
      endUt: validAt + patch.period,
    })),
  };
}

interface Drawn {
  held: number | undefined;
  modelled: number | undefined;
}
let drawn: Drawn = { held: undefined, modelled: undefined };

/** Reads what MapView reads to place the two marks, and nothing else. */
function Probe() {
  const flight = useTelemetry("vessel.flight");
  const bodies = useTelemetry("system.bodies");
  const view = useViewUt();
  const position = flight.state === "observed" ? flight.value : undefined;
  const roster = bodies.state === "observed" ? bodies.value : undefined;
  const body = useMemo(() => bodyNamed(roster, "Kerbin"), [roster]);
  const modelled = useModelledPosition({
    targetBodyId: "Kerbin",
    body,
    lat: position?.latitude,
    lon: position?.longitude,
    receivedUt: view?.magnitude,
  });
  drawn = { held: position?.longitude?.magnitude, modelled: modelled?.lon };
  return null;
}

/**
 * Lets the frame the provider schedules land inside `act`. On every clock frame
 * and every delivery the provider books a `store.beginFrame()` for the next
 * animation frame, on top of the frame a test mints by hand, and that one is a
 * React update like any other: left to fire between two steps it lands outside
 * `act` on any machine slow enough for a step to outlast it.
 */
function scheduledFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("useModelledPosition", () => {
  it("keeps the modelled place a light-time ahead of the held one on every frame, for an orbit whose patch starts at each sample's own instant", async () => {
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
    const frame = () => {
      clock.emitFrame();
      store.beginFrame();
    };
    await act(async () => {
      const at = { validAt: U0, deliveredAt: U0 };
      transport.emit("system.bodies", payloadOf("system.bodies"), at);
      transport.emit("vessel.identity", payloadOf("vessel.identity"), at);
      frame();
      await scheduledFrame();
    });

    // One sample every 1.02 s, taken at a fraction of a second as the mod's are, each arriving a light-time later.
    const samples: number[] = [];
    for (let taken = 0.137; taken < 6; taken += 1.02) samples.push(taken);
    const separations: number[] = [];
    for (let now = DELAY; now <= DELAY + 6; now += 0.25) {
      await act(async () => {
        while (samples.length > 0 && samples[0] + DELAY <= now) {
          const taken = samples.shift() as number;
          const meta = { validAt: U0 + taken, deliveredAt: U0 + taken + DELAY };
          transport.emit("vessel.orbit", orbitSampledAt(U0 + taken), meta);
          transport.emit(
            "vessel.flight",
            {
              ...(payloadOf("vessel.flight") as object),
              longitude: 75 + GROUND_RATE * taken,
            },
            meta,
          );
        }
        frame();
        await scheduledFrame();
      });
      if (drawn.held !== undefined && drawn.modelled !== undefined) {
        separations.push(drawn.modelled - drawn.held);
      }
      act(() => wall.advanceBy(0.25));
    }

    expect(separations.length).toBeGreaterThan(15);
    // A light-time of ground travel, give or take the second the held mark waits for its next sample.
    for (const separation of separations) {
      expect(separation).toBeGreaterThan(GROUND_RATE * (DELAY - 1));
      expect(separation).toBeLessThan(GROUND_RATE * (DELAY + 2));
    }
  });
});
