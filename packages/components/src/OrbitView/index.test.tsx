import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { OrbitOverlayContext } from "./index";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/** Reads settle a frame after the emit, so data-present assertions wait for the diagram or pill. */
const LKO: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
  argPe: 0,
};

describe("OrbitViewComponent", () => {
  it("shows the 'No orbital data' fallback before telemetry arrives", () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 });
    expect(visibleText(container)).toContain("No orbital data");
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
    // Subtitle shows the body name resolved off vessel.identity.parentBodyIndex.
    expect(visibleText(container)).toContain("Kerbin");
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
    // Landscape: cols >= 8 && rows >= 3 is enough.
    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
  });

  it("still collapses to a pill when landscape is too narrow (7×3)", async () => {
    const { container } = renderOrbitViewStream({ w: 7, h: 3 }, LKO);
    // Below both the landscape (8 cols) and the standard (5x5) thresholds.
    await waitFor(() => {
      if (!/orbit|orbital|escape/i.test(container.textContent ?? "")) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
  });
});

/** Throwaway augments prove the overlay slot composes, and that an empty slot is inert. */
describe("OrbitView augment slots", () => {
  // Unmount before clearAugments() notifies the mounted AugmentSlot subscribers; RTL auto-cleanup runs too late for that ordering.
  const trees: Array<() => void> = [];
  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    clearAugments();
  });

  it("renders an overlay augment over the diagram, passed the diagram's projection", async () => {
    registerAugment({
      id: "test-orbit-overlay",
      augments: "orbit-view.overlay",
      component: (ctx: OrbitOverlayContext) => (
        // LKO is elliptical, so `apoapsis` is real; `?? Number.NaN` only satisfies the type.
        <div data-testid="overlay-probe">
          apo={Math.round(ctx.apoapsis ?? Number.NaN)}
        </div>
      ),
    });

    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 }, LKO);
    trees.push(unmount);

    await waitFor(() => {
      if (container.querySelector('[data-testid="overlay-probe"]') === null) {
        throw new Error("overlay augment has not rendered yet");
      }
    });
    // The diagram still renders beneath the overlay layer.
    expect(container.querySelector("svg")).not.toBeNull();
    // The overlay received the body-centric projection (apoapsis, in the diagram's distance units) as slot props.
    expect(
      container.querySelector('[data-testid="overlay-probe"]')?.textContent,
    ).toMatch(/apo=\d+/);
  });

  it("renders the diagram with both slots empty when no augment is registered", async () => {
    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 }, LKO);
    trees.push(unmount);

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(container.querySelector('[data-testid="overlay-probe"]')).toBeNull();
    expect(container.textContent).not.toContain("badge:");
  });
});
