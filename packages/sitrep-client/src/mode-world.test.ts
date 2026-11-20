import { isWorldTopic, readDeclaredDelayRoles } from "@ksp-gonogo/sitrep-sdk";
import { overlayCovers } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { buildModeLayer, type ModeLayer } from "./mode-layer";

const frame = (topic: string, validAt: number, payload: unknown): string =>
  JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "system",
      validAt,
      deliveredAt: validAt,
      seq: validAt,
      vantage: "meta",
      active: true,
      staleness: 0,
      timelineEpoch: 4,
      mode: "test.flight",
    },
  });

const orbit = { sma: 700_000, ecc: 0, referenceBodyIndex: 1 };

describe("which Topics are the world's", () => {
  it("takes it from the delay role the contract gives each Topic", () => {
    // Read with no signal delay, or held at the home command: not a craft's.
    expect(isWorldTopic("trackingStation.bodies")).toBe(true);
    expect(isWorldTopic("time.calendar")).toBe(true);
    expect(isWorldTopic("career.status")).toBe(true);
    expect(isWorldTopic("time.warp.warpRate")).toBe(true);
    // Delayed, the default: a craft's telemetry.
    expect(isWorldTopic("vessel.orbit")).toBe(false);
    expect(isWorldTopic("vessel.flight.altitudeAsl")).toBe(false);
    // Addressed to a command centre: the craft's link as that centre had it.
    expect(isWorldTopic("comms.delay")).toBe(false);
    expect(isWorldTopic("commandCentre.roster")).toBe(false);
    // Read with no delay, but it names the craft: never the world's.
    expect(isWorldTopic("ksp.activeVessel")).toBe(false);
  });

  it("covers an Uplink's Topics once the mod has stated their roles", () => {
    const roles = readDeclaredDelayRoles({
      delayRoles: {
        trueNow: ["weather.forecast"],
        heldAtHome: [],
        trueNowPrefixes: ["weather.site."],
        addressed: [],
      },
    });
    expect(isWorldTopic("weather.forecast")).toBe(false);
    expect(isWorldTopic("weather.forecast", roles)).toBe(true);
    expect(isWorldTopic("weather.site.ksc", roles)).toBe(true);
    expect(isWorldTopic("weather.craft", roles)).toBe(false);
  });
});

describe("a mode's layer and the world", () => {
  const layer: ModeLayer = {
    mode: "test.flight",
    entry: 1,
    modelled: true,
    frames: [
      frame("vessel.orbit", 1000, orbit),
      frame("spaceCenter.scene", 1000, { scene: "Flight" }),
    ],
  };

  it("leaves a world Topic to the live game unless the mode holds it, and answers every craft Topic", () => {
    const overlay = buildModeLayer(layer);
    if (!overlay) throw new Error("no layer");
    // A craft's: the mode's, whether or not it holds a value.
    expect(overlayCovers(overlay, "vessel.orbit")).toBe(true);
    expect(overlayCovers(overlay, "vessel.flight")).toBe(true);
    expect(overlayCovers(overlay, "comms.delay")).toBe(true);
    // The world's: the live game's.
    expect(overlayCovers(overlay, "trackingStation.bodies")).toBe(false);
    expect(overlayCovers(overlay, "career.status")).toBe(false);
    // The world's, and the mode states it: the scene the flight was in.
    expect(overlayCovers(overlay, "spaceCenter.scene")).toBe(true);
    // The dashboard's own, as before.
    expect(overlayCovers(overlay, "mode.state")).toBe(false);
  });

  it("hands its own store the live world it lacks, in force from its first moment, and still leaves reads of it to the live game", () => {
    const overlay = buildModeLayer(layer, {
      isWorld: (topic) => isWorldTopic(topic),
      held: [
        {
          topic: "trackingStation.bodies",
          payload: { bodies: [] },
          // The live game's own time and timeline, long after the layer's.
          meta: {
            validAt: 9_000_000,
            deliveredAt: 9_000_000,
            timelineEpoch: 9,
          },
        },
        {
          topic: "spaceCenter.scene",
          payload: { scene: "SpaceCenter" },
          meta: {
            validAt: 9_000_000,
            deliveredAt: 9_000_000,
            timelineEpoch: 9,
          },
        },
        {
          topic: "ksp.activeVessel",
          payload: { vesselId: "the-live-craft", name: "Live" },
          meta: {
            validAt: 9_000_000,
            deliveredAt: 9_000_000,
            timelineEpoch: 9,
          },
        },
        {
          topic: "vessel.flight",
          payload: { altitudeAsl: 5 },
          meta: {
            validAt: 9_000_000,
            deliveredAt: 9_000_000,
            timelineEpoch: 9,
          },
        },
      ],
    });
    if (!overlay) throw new Error("no layer");
    overlay.store.clock.scrubTo(1000);
    overlay.store.beginFrame();
    expect(overlay.store.sampleReading("trackingStation.bodies").state).toBe(
      "observed",
    );
    // The scene is the mode's own, and the live craft's telemetry is never taken.
    const scene = overlay.store.sampleReading("spaceCenter.scene");
    expect(scene.state === "observed" ? scene.value : undefined).toMatchObject({
      scene: "Flight",
    });
    expect(overlay.store.sampleReading("vessel.flight").state).toBe("pending");
    // Nor the live game's word on which craft is active, which the store would judge the mode's own craft against.
    expect(overlay.store.sampleReading("ksp.activeVessel").state).toBe(
      "pending",
    );
    expect(overlayCovers(overlay, "trackingStation.bodies")).toBe(false);
  });
});
