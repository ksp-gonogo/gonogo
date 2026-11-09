import { describe, expect, it } from "vitest";
import { adviceFor } from "./adviceFor";

describe("adviceFor", () => {
  it("says nothing without a reason", () => {
    expect(adviceFor({ gateStopsPress: false }, null)).toMatchObject({
      disabled: false,
      predictedOutcome: undefined,
      tip: undefined,
    });
  });

  it("stops the press with the reason when the command goes through within a few seconds", () => {
    expect(
      adviceFor({ gateStopsPress: true }, "the vessel is not controllable"),
    ).toEqual({
      disabled: true,
      disabledReason: "The vessel is not controllable",
      predictedOutcome: undefined,
      tip: undefined,
    });
  });

  it("advises and leaves the press live when the command is held longer, or the delay is not known", () => {
    for (const handle of [{ gateStopsPress: false }, {}]) {
      expect(adviceFor(handle, "the vessel is not controllable")).toMatchObject(
        {
          disabled: false,
          predictedOutcome: "at-risk",
          tip: "Likely to be refused: the vessel is not controllable.",
        },
      );
    }
  });
});
