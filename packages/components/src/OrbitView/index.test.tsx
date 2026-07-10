import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView behavioural unit tests. R6 de-Telemachus: the widget reads
 * exclusively off the SDK stream (`vessel.orbit` + the `vessel.state` derived
 * channel), so these render through a real `TelemetryProvider` via the shared
 * `renderOrbitViewStream` harness — there is no legacy `MockDataSource`
 * anywhere in this file. Reads settle a frame after the emit, so the
 * data-present assertions wait for the diagram/pill rather than reading
 * synchronously.
 */
const LKO: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
  argPe: 0,
};

describe("OrbitViewComponent", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the 'No orbital data' fallback before telemetry arrives", () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 });
    expect(container.textContent).toContain("No orbital data");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the SVG diagram once orbital state lands", async () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 }, LKO);

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(container.textContent).not.toContain("No orbital data");
    // Subtitle shows the body name resolved off vessel.state.parentBodyName.
    expect(container.textContent).toContain("Kerbin");
  });

  it("collapses to a status pill in tiny cells (3×3)", async () => {
    const { container } = renderOrbitViewStream({ w: 3, h: 3 }, LKO);
    // No diagram, but the pill renders Stable orbit / Sub-orbital / Escape.
    await waitFor(() => {
      if (!/orbit|orbital|escape/i.test(container.textContent ?? "")) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the diagram in a wide-short landscape cell (12×3)", async () => {
    const { container } = renderOrbitViewStream({ w: 12, h: 3 }, LKO);
    // Landscape relaxation: cols ≥ 8 && rows ≥ 3 is now enough.
    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
  });

  it("still collapses to a pill when landscape is too narrow (7×3)", async () => {
    const { container } = renderOrbitViewStream({ w: 7, h: 3 }, LKO);
    // 7 cols is below the landscape threshold (8) and the standard
    // threshold (5×5 needs h≥5 too). Pill mode wins even once data lands.
    await waitFor(() => {
      if (!/orbit|orbital|escape/i.test(container.textContent ?? "")) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
  });
});
