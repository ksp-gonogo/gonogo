import { render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Metres } from "./readouts";

describe("an altitude as the widget writes it", () => {
  it.each([
    [0.0003, "0 m"],
    [-0.0003, "0 m"],
    [0.4, "0 m"],
    [0.6, "1 m"],
    [1200, "1.20 km"],
  ])("writes %f m as %s, never in scientific notation", (m, text) => {
    render(<Metres m={m} />);
    expect(visibleText()).toBe(text);
  });
});
