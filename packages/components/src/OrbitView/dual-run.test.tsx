import { waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView stream render check. This was previously a
 * behaviour-preservation golden DUAL-run — the same orbit state rendered once
 * off the legacy `DataSource` and once off the stream, asserted byte-identical.
 * With the fork gone the legacy leg is moot, so it collapses to a single
 * stream-only render that still exercises the same low-Kerbin-orbit state.
 *
 * A stable LKO is chosen because `hasOrbit` is true and `isOrbiting` resolves
 * true (`vessel.state.periapsisAlt` clears Kerbin's 70 km atmosphere ceiling),
 * landing the `StatusPill` "Stable orbit" text. Mode `4×18` keeps
 * `showDiagram` false (`cols < 5`) so the pill text renders directly instead
 * of the SVG diagram, giving a concrete DOM string to assert on.
 */

describe("OrbitView — stream render (LKO, delay=0)", () => {
  it("renders the 'Stable orbit' pill off the stream for a stable low-Kerbin orbit", async () => {
    const { container } = renderOrbitViewStream(
      { w: 4, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    );

    await waitFor(() => {
      if (!container.textContent?.includes("Stable orbit")) {
        throw new Error("stream leg has not rendered the orbit pill yet");
      }
    });

    // Pill mode (no SVG at 4 cols) and the body-name subtitle both resolve
    // purely off the stream.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toContain("Kerbin");
  });
});
