import { describe, expect, it } from "vitest";
import { isAwaitingFirstSignal, readNoRoute } from "./useAwaitingFirstSignal";

describe("isAwaitingFirstSignal", () => {
  it("is true for a link report that has not arrived yet", () => {
    expect(isAwaitingFirstSignal({ state: "pending" })).toBe(true);
    expect(isAwaitingFirstSignal({ state: "absent" })).toBe(false);
    expect(isAwaitingFirstSignal({ state: "observed" })).toBe(false);
  });

  it("is true for a link left behind by a time jump, whose next report is still crossing", () => {
    expect(isAwaitingFirstSignal({ state: "held", grade: "held" })).toBe(true);
  });

  it("is true for a link held while the game loads a scene", () => {
    expect(isAwaitingFirstSignal({ state: "held", grade: "loading" })).toBe(
      true,
    );
  });

  it("is false for a hold with another stated cause", () => {
    for (const grade of [
      "disconnected",
      "last-before-blackout",
      "recorded",
      "no-game",
    ]) {
      expect(isAwaitingFirstSignal({ state: "held", grade })).toBe(false);
    }
  });
});

describe("readNoRoute", () => {
  it("is true only when the centre's own delay list says it has no route", () => {
    expect(
      readNoRoute({ state: "observed", value: { centres: [], noRoute: true } }),
    ).toBe(true);
    expect(
      readNoRoute({ state: "held", value: { centres: [], noRoute: true } }),
    ).toBe(true);
  });

  it("is false while the centre has a route, including the first delay after a switch", () => {
    expect(
      readNoRoute({
        state: "observed",
        value: { centres: [], noRoute: false },
      }),
    ).toBe(false);
  });

  it("is false before the list has arrived or when it is absent", () => {
    expect(readNoRoute({ state: "pending" })).toBe(false);
    expect(readNoRoute({ state: "absent" })).toBe(false);
    expect(readNoRoute(undefined)).toBe(false);
  });
});
