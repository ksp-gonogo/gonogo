import { type Reading, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { craftOnOrbit } from "./craftOnOrbit";

/** A circular low orbit observed at periapsis, so the observation's own place is a true anomaly of zero. */
const ORBIT = {
  sma: value("m", 682_500),
  ecc: value("1", 0),
  inc: value("°", 0),
  lan: value("°", 0),
  argPe: value("°", 0),
  meanAnomalyAtEpoch: value("rad", 0),
  epoch: value("ut", 100),
  mu: value("m³/s²", 3.5316e12),
};

/** Only the true anomaly is read off the solve. */
const SOLVED_AT_90 = { trueAnomaly: 90 };

const MODEL = {
  status: "available" as const,
  atUt: value("ut", 500),
  beyondReceived: true,
  modelled: ORBIT,
  basis: "kepler-propagation" as const,
};

function reading(
  state: "observed" | "held",
  reckoning: Reading<typeof ORBIT>["reckoning"],
): Reading<typeof ORBIT> {
  return state === "observed"
    ? { state, value: ORBIT, atUt: value("ut", 100), reckoning }
    : {
        state,
        value: ORBIT,
        asOfUt: value("ut", 100),
        grade: "held",
        reckoning,
      };
}

describe("craftOnOrbit", () => {
  it("draws a current reading as the craft's place now", () => {
    expect(
      craftOnOrbit(
        reading("observed", { status: "none" }),
        ORBIT,
        SOLVED_AT_90,
      ),
    ).toEqual({ current: 90 });
  });

  it("draws a held reading no model carries at its last place, held", () => {
    const craft = craftOnOrbit(
      reading("held", { status: "none" }),
      ORBIT,
      null,
    );
    expect(Object.keys(craft ?? {})).toEqual(["held"]);
    expect(craft?.held).toBeCloseTo(0, 6);
  });

  it("draws a held reading a model carries at both places: where it was last seen and where the model puts it", () => {
    const craft = craftOnOrbit(reading("held", MODEL), ORBIT, SOLVED_AT_90);
    expect(craft?.held).toBeCloseTo(0, 6);
    expect(craft?.modelled).toBe(90);
    expect(craft?.current).toBeUndefined();
  });

  it("draws a current reading a model carries past the received edge as current and modelled", () => {
    const craft = craftOnOrbit(reading("observed", MODEL), ORBIT, SOLVED_AT_90);
    expect(craft?.current).toBeCloseTo(0, 6);
    expect(craft?.modelled).toBe(90);
    expect(craft?.held).toBeUndefined();
  });

  it("draws nothing before any elements have arrived", () => {
    expect(
      craftOnOrbit(
        { state: "pending", reckoning: { status: "none" } },
        undefined,
        null,
      ),
    ).toBeNull();
  });
});
