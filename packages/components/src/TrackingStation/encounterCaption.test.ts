import { describe, expect, it } from "vitest";
import { placeEncounterCaption } from "./encounterCaption";

const base = { x: 100, y: 100, zoom: 1, widthPx: 60, heightPx: 8 };

describe("placeEncounterCaption", () => {
  it("draws the caption to the right of the ring when nothing is there", () => {
    expect(placeEncounterCaption({ ...base, avoid: [] })).toEqual({
      dx: 7,
      dy: 3,
      anchor: "start",
    });
  });

  it("moves the caption to the left of the ring when a body's name is on its right", () => {
    const name = { x0: 105, y0: 94, x1: 135, y1: 104 };
    expect(placeEncounterCaption({ ...base, avoid: [name] })).toEqual({
      dx: -7,
      dy: 3,
      anchor: "end",
    });
  });

  it("moves it above or below when both sides hold a name", () => {
    const right = { x0: 105, y0: 94, x1: 165, y1: 104 };
    const left = { x0: 35, y0: 94, x1: 95, y1: 104 };
    const place = placeEncounterCaption({ ...base, avoid: [right, left] });
    expect(place.dy).not.toBe(3);
  });

  it("keeps the right-hand spot when every spot is taken", () => {
    const everywhere = { x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
    expect(placeEncounterCaption({ ...base, avoid: [everywhere] }).dx).toBe(7);
  });
});
