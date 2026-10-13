import { waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { emitScenario, renderOrbitStream } from "../test/orbitScenario";
import { CurrentOrbitComponent } from "./index";

/** The diagram's orbit line carries no orbiting or sub-orbital colour until the parent body's data says where the atmosphere ends. */
describe("CurrentOrbit before the parent body arrives", () => {
  it("draws the orbit with no verdict, then gives it one once the body lands", async () => {
    const { container, fixture } = renderOrbitStream(
      <CurrentOrbitComponent id="co-undetermined" w={9} h={18} />,
      { sma: 681500, ecc: 0.005 },
      "co-undetermined",
    );
    const diagram = () => container.querySelector("[data-orbiting]");
    await waitFor(() => {
      if (diagram() === null) throw new Error("diagram has not rendered yet");
    });
    expect(diagram()?.getAttribute("data-orbiting")).toBe("unknown");

    emitScenario(fixture, { bodyName: "Kerbin", sma: 681500, ecc: 0.005 });
    await waitFor(() =>
      expect(diagram()?.getAttribute("data-orbiting")).toBe("yes"),
    );
  });
});
