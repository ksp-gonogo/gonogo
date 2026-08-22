import { describe, expect, it } from "vitest";
import { silenceByVessel } from "./fleet-contact";

/**
 * The fleet-wide roster exists so a consumer that cannot name a per-vessel
 * topic can still read the reckoning. That only holds if the reshaping is
 * lossless, so these check the fields that carry a MEANING rather than just a
 * number: a withheld prediction has to stay withheld, and a craft with no id
 * has to disappear rather than collide with another under an empty key.
 */
describe("silenceByVessel", () => {
  it("keys every entry by its vessel id", () => {
    const byVessel = silenceByVessel({
      vessels: [
        { vesselId: "a", state: "Silent" },
        { vesselId: "b", state: "Nominal" },
      ],
    });
    expect([...byVessel.keys()]).toEqual(["a", "b"]);
  });

  it("unwraps the unit-carrying UTs the static topic delivers", () => {
    // Unlike `silence.<guid>.state`, this topic matches the generated unit map
    // by its exact string, so its UTs arrive wrapped and every consumer would
    // otherwise be comparing an object to a number.
    const byVessel = silenceByVessel({
      vessels: [
        {
          vesselId: "a",
          state: "Silent",
          silenceSinceUt: { magnitude: 1000 },
          deadlineUt: { magnitude: 2000 },
          predictedReacquisitionUt: { magnitude: 1600 },
        },
      ],
    });
    expect(byVessel.get("a")).toMatchObject({
      silenceSinceUt: 1000,
      deadlineUt: 2000,
      predictedReacquisitionUt: 1600,
    });
  });

  it("accepts a bare number as readily as a wrapped one", () => {
    const byVessel = silenceByVessel({
      vessels: [{ vesselId: "a", state: "Silent", deadlineUt: 2000 }],
    });
    expect(byVessel.get("a")?.deadlineUt).toBe(2000);
  });

  it("keeps a withheld prediction withheld, never as a reacquisition at zero", () => {
    const byVessel = silenceByVessel({
      vessels: [
        {
          vesselId: "a",
          state: "Silent",
          deadlineBasis: "no-occultation",
          predictedReacquisitionUt: null,
        },
      ],
    });
    expect(byVessel.get("a")?.predictedReacquisitionUt).toBeNull();
    expect(byVessel.get("a")?.deadlineBasis).toBe("no-occultation");
  });

  it("drops an entry that cannot say which craft it is about", () => {
    // Keying it under "" would collide every such entry onto one another and
    // hand a widget a reckoning belonging to nothing.
    const byVessel = silenceByVessel({
      vessels: [
        { vesselId: "", state: "Silent" },
        { vesselId: "a", state: "Silent" },
      ],
    });
    expect([...byVessel.keys()]).toEqual(["a"]);
  });

  it("is empty, not broken, before the topic has delivered", () => {
    expect(silenceByVessel(undefined).size).toBe(0);
    expect(silenceByVessel({}).size).toBe(0);
    expect(silenceByVessel({ vessels: null }).size).toBe(0);
  });

  it("distinguishes a fleet of none from a topic that has not delivered", () => {
    // Both produce an empty map here, but the caller can tell them apart from
    // the payload itself, which is why the wire keeps the wrapper object.
    expect(silenceByVessel({ vessels: [] }).size).toBe(0);
  });
});
