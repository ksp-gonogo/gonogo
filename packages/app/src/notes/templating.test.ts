import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "./templating";

describe("renderTemplate", () => {
  it("prints a Value tag through Unit formatting, not its wire shape", () => {
    const resolve = () => value("ratio", 0.75);

    const text = renderTemplate(
      "Throttle {{vessel.control.throttle}}",
      resolve,
    );

    expect(text).toBe("Throttle 75 %");
    expect(text).not.toContain("magnitude");
  });

  it("formats a Value on a non-ratio unit the same as the ladder every readout climbs", () => {
    const resolve = () => value("m", 12_400);

    expect(renderTemplate("Alt {{vessel.flight.altitude}}", resolve)).toBe(
      "Alt 12.4 km",
    );
  });

  it("renders a non-finite Value as the null token, same as a bare NaN", () => {
    const resolve = () => value("m/s", Number.NaN);

    expect(renderTemplate("Rate {{v}}", resolve)).toBe(`Rate ${NULL_DISPLAY}`);
  });
});
