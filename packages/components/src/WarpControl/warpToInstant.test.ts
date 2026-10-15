import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { instantAfterWait } from "./WarpToRow";

describe("instantAfterWait", () => {
  it("starts the wait from the game's clock, a one-way delay ahead of the view clock", () => {
    expect(instantAfterWait(value("ut", 1000), 600, value("s", 300))).toBe(
      1900,
    );
  });

  it("is the view clock plus the wait when there is no delay", () => {
    expect(instantAfterWait(value("ut", 1000), 0, value("s", 300))).toBe(1300);
  });
});
