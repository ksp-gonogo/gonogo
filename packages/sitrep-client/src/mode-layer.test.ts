import { overlayCovers } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { buildModeLayer, missingTopicField, modeFrames } from "./mode-layer";

const orbit = (sma: number) => ({
  referenceBodyIndex: 1,
  sma,
  ecc: 0.1,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 1000,
  mu: 3.5316e12,
  timeToAp: null,
  timeToPe: null,
  encounter: null,
  patches: [],
  horizon: { kind: 1, trajectoryKind: 1, untilUt: null, departure: null },
  meta: { source: "vessel:a", quality: 0 },
});

describe("a mode's samples as frames", () => {
  it("carry the mode's id", () => {
    const built = modeFrames("replay", [
      { topic: "vessel.orbit", validAt: 1000, payload: orbit(700_000) },
    ]);
    if (!("frames" in built)) throw new Error(built.refused);
    expect(JSON.parse(built.frames[0] ?? "").meta.mode).toBe("replay");
  });

  it("are refused, naming the field, when a sample lacks one its contract gives it", () => {
    const { horizon: _horizon, ...partial } = orbit(700_000);
    expect(missingTopicField("vessel.orbit", partial)).toBe("horizon");
    expect(
      modeFrames("replay", [
        { topic: "vessel.orbit", validAt: 1000, payload: partial },
      ]),
    ).toEqual({
      refused:
        "a vessel.orbit sample has no horizon, which its contract gives it",
    });
  });

  it("are refused for one of the dashboard's own Topics, which no mode answers", () => {
    expect(
      modeFrames("replay", [
        { topic: "mode.state", validAt: 1000, payload: {} },
      ]),
    ).toEqual({
      refused: "mode.state is the dashboard's own, which no mode answers",
    });
  });
});

describe("a mode's store", () => {
  const built = modeFrames("replay", [
    { topic: "vessel.orbit", validAt: 2000, payload: orbit(900_000) },
    { topic: "vessel.orbit", validAt: 1000, payload: orbit(700_000) },
  ]);
  if (!("frames" in built)) throw new Error(built.refused);
  const overlay = buildModeLayer({
    mode: "replay",
    entry: 1,
    modelled: false,
    frames: built.frames,
  });
  if (!overlay) throw new Error("a layer with samples built no store");
  const readAt = (ut: number) => {
    overlay.store.clock.scrubTo(ut);
    overlay.store.beginFrame();
    return overlay.store.sampleReading<{ sma: unknown }>("vessel.orbit");
  };

  it("answers with the newest sample at or before the moment on screen", () => {
    const early = readAt(1500);
    const late = readAt(2500);
    if (early.state !== "observed" || late.state !== "observed") {
      throw new Error(`states were ${early.state} and ${late.state}`);
    }
    expect(Number(early.value.sma)).toBe(700_000);
    expect(Number(late.value.sma)).toBe(900_000);
  });

  it("says which mode supplied the reading and that it is modelled", () => {
    const reading = readAt(1500);
    expect("from" in reading ? reading.from : undefined).toEqual({
      mode: "replay",
      modelled: false,
    });
  });

  it("is not built for a layer with no sample, so the Topic stays the live game's", () => {
    expect(
      buildModeLayer({ mode: "replay", entry: 1, modelled: false, frames: [] }),
    ).toBeUndefined();
  });

  it("answers for the whole craft, and for none of the dashboard's own Topics", () => {
    expect(overlayCovers(overlay, "vessel.orbit")).toBe(true);
    // A Topic about the game the layer has no sample for is the mode's to answer as not known.
    expect(overlayCovers(overlay, "vessel.flight.altitudeAsl")).toBe(true);
    expect(overlayCovers(overlay, "mode.state")).toBe(false);
    expect(overlayCovers(overlay, "system.uplinks")).toBe(false);
  });
});
