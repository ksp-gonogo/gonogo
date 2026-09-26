import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/** A stable LKO at 4 cols renders the "Stable orbit" pill rather than the diagram, giving a concrete string to assert on. */

describe("OrbitView: stream render (LKO, delay=0)", () => {
  it("renders the 'Stable orbit' pill off the stream for a stable low-Kerbin orbit", async () => {
    const { container } = renderOrbitViewStream(
      { w: 4, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    );

    await waitFor(() => {
      if (!visibleText(container).includes("Stable orbit")) {
        throw new Error("stream leg has not rendered the orbit pill yet");
      }
    });

    // Pill mode (no SVG at 4 cols) and the body-name subtitle both resolve purely off the stream.
    expect(container.querySelector("svg")).toBeNull();
    expect(visibleText(container)).toContain("Kerbin");
  });
});
