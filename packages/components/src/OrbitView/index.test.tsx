import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrbitBadgesContext, OrbitOverlayContext } from "./index";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView behavioural unit tests. The widget reads
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

/**
 * Augment-slot exposure (Uplink architecture). OrbitView exposes an
 * `orbit-view.overlay` slot over the diagram and an `orbit-view.badges`
 * escape-hatch in the header. No first-party augment fills them, so these tests
 * register throwaway augments (cleared each test) to prove the slots compose,
 * and that the empty slots are inert when nothing is registered.
 */
describe("OrbitView augment slots", () => {
  // Unmount the rendered trees synchronously before clearAugments() notifies
  // the still-mounted AugmentSlot subscribers — that notification is a state
  // update, so firing it against a live tree is the act() anti-pattern. RTL
  // auto-cleanup runs after this hook, too late to rely on for ordering.
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
        <div data-testid="overlay-probe">apo={Math.round(ctx.apoapsis)}</div>
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
    // The overlay received the body-centric projection (apoapsis, in the
    // diagram's distance units) as slot props.
    expect(
      container.querySelector('[data-testid="overlay-probe"]')?.textContent,
    ).toMatch(/apo=\d+/);
  });

  it("renders a badges augment in the header, passed the body name", async () => {
    registerAugment({
      id: "test-orbit-badge",
      augments: "orbit-view.badges",
      component: (ctx: OrbitBadgesContext) => (
        <span>badge:{ctx.bodyName ?? "?"}</span>
      ),
    });

    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 }, LKO);
    trees.push(unmount);

    await waitFor(() => {
      if (!container.textContent?.includes("badge:Kerbin")) {
        throw new Error(
          "badge augment has not rendered with the body name yet",
        );
      }
    });
    expect(container.textContent).toContain("badge:Kerbin");
  });

  it("renders the diagram with both slots empty when no augment is registered", async () => {
    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 }, LKO);
    trees.push(unmount);

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    // No augment registered → nothing composes into either slot.
    expect(container.querySelector('[data-testid="overlay-probe"]')).toBeNull();
    expect(container.textContent).not.toContain("badge:");
  });
});
