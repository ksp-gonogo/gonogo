import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { OrbitBadgesContext } from "./index";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * Characterisation of what OrbitView DOES today when its telemetry reads are
 * `undefined`. Not what it should do.
 *
 * The widget's absence gates, every one of which reads a value that is
 * `undefined` today and becomes an always-truthy `Reading` after the
 * migration:
 *
 *   - `hasOrbit = sma != null && eccentricity != null && periapsisR != null`
 *     gates the whole diagram, the overlay slot, and the status pill
 *   - `bodyName === undefined` gates `getBody`, the body-name caption, and
 *     the live rotation subscription
 *   - `basis === "measured"` picks WHICH empty-state sentence renders, and is
 *     the only thing that distinguishes "no osculating elements exist" from
 *     "nothing has arrived yet"
 *
 * `renderOrbitViewStream` with no scenario is the genuine nothing-arrived
 * case: a real `TelemetryProvider`/`TimelineStore` is mounted and subscribed,
 * no wire point is ever emitted.
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

    // `basis` is undefined (no `vessel.state` point at all), so the ternary
    // falls to its else arm: the pending case is rendered with the same
    // sentence the widget uses for every other non-measured absence.
    expect(visibleText(container)).toContain("No orbital data");
    expect(visibleText(container)).not.toContain("packed");
    // `hasOrbit` fires: nothing that reads `sma.magnitude` is reached. If the
    // gate stopped gating, this render would throw on `.magnitude` of a
    // Reading rather than merely draw a wrong ellipse.
    expect(container.querySelector("svg")).toBeNull();
    // `bodyName === undefined` suppresses the caption outright: no
    // placeholder, no dash, no body row.
    expect(visibleText(container)).not.toContain("Kerbin");
    expect(visibleText(container)).toBe("ORBIT VIEWNo orbital data");
  });

  it("shows the sentence rather than the pill placeholder in a tiny 3x3 cell", () => {
    const { container } = renderOrbitViewStream({ w: 3, h: 3 });

    // The `!hasOrbit` branch is tested BEFORE the size branch, so tiny mode
    // never reaches the pill while telemetry is absent. `pillLabel`'s
    // NULL_DISPLAY initial value is therefore unreachable today, and this
    // assertion is what will notice if the gate stops firing and the pill
    // starts rendering a confident tone instead.
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

  it("does not mount the overlay slot while the elements are absent, but does mount badges", () => {
    registerAugment({
      id: "characterise-orbit-overlay",
      augments: "orbit-view.overlay",
      component: () => <div data-testid="overlay-probe">overlay</div>,
    });
    registerAugment({
      id: "characterise-orbit-badges",
      augments: "orbit-view.badges",
      component: (ctx: OrbitBadgesContext) => (
        <div data-testid="badges-probe">body={String(ctx.bodyName)}</div>
      ),
    });

    const { container, unmount } = renderOrbitViewStream({ w: 9, h: 18 });
    trees.push(unmount);

    // `overlayContext` is null (same three-way absence check as `hasOrbit`),
    // and the slot is only mounted when there is a diagram beneath it: an
    // overlay augment is not rendered at all, rather than rendered with
    // zeroed elements.
    expect(container.querySelector('[data-testid="overlay-probe"]')).toBeNull();
    // The badges slot is UNgated: it mounts with `bodyName: undefined`, so an
    // augment there sees the absence itself.
    expect(
      container.querySelector('[data-testid="badges-probe"]'),
    ).not.toBeNull();
    expect(visibleText(container)).toContain("body=undefined");
  });
});

describe("OrbitView: null (tombstone) versus undefined (nothing yet)", () => {
  it("renders a DIFFERENT sentence when the apsis radii are null in the measured basis", async () => {
    // Quality.Loaded makes `deriveVesselState` take its measured branch: the
    // orbit exists and `vessel.state` HAS arrived, but both apsis radii are
    // null (no osculating elements to solve). `hasOrbit` uses `!= null`, so
    // the tombstone gates the diagram exactly like nothing-arrived does, and
    // only `basis` tells the two apart in the copy.
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, quality: Quality.Loaded },
    );

    await waitFor(() => {
      if (!visibleText(container).includes("No osculating orbit (packed)")) {
        throw new Error("measured-basis empty state has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
    // The body name still resolves: the caption is gated on `bodyName`, not
    // on the orbit, so this branch is not the nothing-arrived render.
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
    // `parentBodyName` needs `vessel.identity` + `system.bodies`, neither
    // emitted here. The name, the body colour and the rotation marker all
    // drop out silently; the only visible trace is a caption that isn't
    // there: the panel title and the diagram's own Ap/Pe markers are all the
    // text this render carries.
    expect(visibleText(container)).toBe("ORBIT VIEWApPe");
  });

  it("reads a real orbit as 'Sub-orbital' when the apsis ALTITUDES are absent", async () => {
    // 7x3 is below both diagram thresholds, so this is the pill branch with
    // `hasOrbit` true. `useIsOrbiting` coerces undefined apsis altitudes
    // (they need `system.bodies`, unemitted here) to `isOrbiting: false`, and
    // the pill states SUB-O with an alert tone: absence rendered as a
    // confident negative claim, not as a placeholder.
    const { container } = renderOrbitViewStream({ w: 7, h: 3 }, LKO_NO_BODY);

    await waitFor(() => {
      if (!visibleText(container).includes("SUB-O")) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(container.querySelector("svg")).toBeNull();
  });

  it("reads the same orbit as an orbit once the body telemetry lands", async () => {
    // The control for the previous case: identical elements, plus the body,
    // flips the same pill from SUB-O to ORBIT.
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
