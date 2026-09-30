import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * Characterisation of what OrbitView does when its telemetry reads are absent, not what it should do.
 * `hasOrbit` gates the diagram, the overlay slot and the pill; `bodyName` gates the caption and the rotation subscription.
 */

const LKO: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
  argPe: 0,
};

/** Same orbit, no `vessel.identity`/`system.bodies`: parent body unresolved. */
const LKO_NO_BODY: OrbitScenario = { sma: 681500, ecc: 0.005, argPe: 0 };

describe("OrbitView: nothing has arrived at all", () => {
  it("renders the 'No orbital data' sentence, no diagram, no body caption", () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 });

    // No `vessel.orbit` point means no decline to name, so the generic sentence renders.
    expect(visibleText(container)).toContain("No orbital data");
    expect(visibleText(container)).not.toContain("packed");
    // `hasOrbit` fires, so nothing that reads `sma.magnitude` is reached.
    expect(container.querySelector("svg")).toBeNull();
    // `bodyName === undefined` suppresses the caption outright: no placeholder, no dash, no body row.
    expect(visibleText(container)).not.toContain("Kerbin");
    expect(visibleText(container)).toBe("ORBIT VIEWNo orbital data");
  });

  it("shows the sentence rather than the pill placeholder in a tiny 3x3 cell", () => {
    const { container } = renderOrbitViewStream({ w: 3, h: 3 });

    // `!hasOrbit` is tested before the size branch, so tiny mode never shows the pill without telemetry.
    expect(visibleText(container)).toContain("No orbital data");
    expect(screen.queryByText(NULL_DISPLAY)).toBeNull();
  });
});

describe("OrbitView: absence gates on the augment slots", () => {
  const trees: Array<() => void> = [];
  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    clearAugments();
  });

  it("does not mount the overlay slot while the elements are absent", () => {
    registerAugment({
      id: "characterise-orbit-overlay",
      augments: "orbit-view.overlay",
      component: () => <div data-testid="overlay-probe">overlay</div>,
    });

    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 });
    trees.push(unmount);

    // No diagram, so the overlay is not rendered at all rather than rendered with zeroed elements.
    expect(container.querySelector('[data-testid="overlay-probe"]')).toBeNull();
  });
});

describe("OrbitView: null (tombstone) versus undefined (nothing yet)", () => {
  it("draws a loaded craft's orbit and names its body", async () => {
    // Under physics the conic will not ADVANCE the elements, but the apsides need no advancing, so a current reading still has an orbit to draw.
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, quality: Quality.Loaded },
    );

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(visibleText(container)).not.toContain("No osculating orbit");
    // The body name still resolves: the caption is gated on `bodyName`, not on the orbit, so this branch is not the nothing-arrived render.
    expect(visibleText(container)).toContain("Kerbin");
  });
});

describe("OrbitView: a partial payload, the orbit without its body", () => {
  it("draws the diagram but suppresses the body caption entirely", async () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 }, LKO_NO_BODY);

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    // Without the body the name, colour and rotation marker drop out; the frame caption does not need the body.
    // Inlaid on the frame rather than a preceding sibling, so it now reads after the diagram's own SVG text.
    expect(visibleText(container)).toBe("ORBIT VIEWApPeorbit plane");
  });

  it("reads a real orbit as 'Sub-orbital' when the apsis ALTITUDES are absent", async () => {
    // 7x3 is the pill branch; `useIsOrbiting` reads absent apsis altitudes as not orbiting, so absence shows as SUB-O.
    const { container } = renderOrbitViewStream({ w: 7, h: 3 }, LKO_NO_BODY);

    await waitFor(() => {
      if (!visibleText(container).includes("SUB-O")) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
  });

  it("reads the same orbit as an orbit once the body telemetry lands", async () => {
    // The control for the previous case: identical elements, plus the body, flips the same pill from SUB-O to ORBIT.
    const { container } = renderOrbitViewStream({ w: 7, h: 3 }, LKO);

    await waitFor(() => {
      if (!/ORBIT|SUB-O|ESC/.test(visibleText(container))) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(visibleText(container)).toContain("ORBIT");
    expect(visibleText(container)).not.toContain("SUB-O");
  });
});
