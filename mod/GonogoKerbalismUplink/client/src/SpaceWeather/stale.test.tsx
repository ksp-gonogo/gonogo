import { getComponent } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerComponent(...), which
// is what the registry lookup below and `renderWidget` both read.
import "./index";

/**
 * What SpaceWeather does when its readings stop being current.
 *
 * The decision: it stops drawing the board. Every field on
 * the space-weather Topic becomes a verdict here (a dose tone, a storm
 * headline, lit belt rings, a "Sheltered" pill, a toned shielding meter), and a
 * verdict cannot be dated: the operator reads a green "Sheltered" as a statement
 * about the habitat now. A craft that has since flown into a belt would keep
 * showing "Sheltered" for as long as the link stayed down.
 *
 * The assertions that earn this file are the ones about the REASON. A widget that
 * draws nothing satisfies almost every test ever written about it, so each case
 * below checks that the withholding is visible and says which of the three
 * reasons it is: not current, confirmed to have no data, or not yet arrived. All
 * three used to render the same fabricated board, and the first two must not now
 * render each other's wording.
 */

/**
 * The registered widget and its primary channel, both read through a function
 * so their "it is there" checks reach the emit calls below: a module-level
 * guard narrows the module body only, and every use here is inside a closure.
 */
function spaceWeather() {
  const def = getComponent("space-weather");
  if (!def) throw new Error("space-weather is not registered");
  const topic = def.channels?.[0];
  if (!topic) throw new Error("space-weather declares no primary channel");
  return { def, topic };
}
const { def: SW, topic: TOPIC } = spaceWeather();
const CARRIED = [...(SW.channels ?? []), ...(SW.optionalChannels ?? [])];

const NOT_CURRENT = "Space weather no longer current";
const AWAITING = "Awaiting space weather";
const CONFIRMED_NONE = "No space-weather data reported";

let stream: ReturnType<typeof setupStreamFixture>;

function mount() {
  return renderWidget("space-weather", {
    instanceId: "sw-stale",
    w: 8,
    h: 11,
    wrapper: stream.Provider,
  });
}

/** A sheltered vessel in low orbit: a live board with every verdict on it. */
function emitSheltered(): void {
  act(() => {
    stream.emit(TOPIC, {
      radiationRadPerSecond: 0.0143 / 3600,
      magnetosphere: true,
      innerBelt: false,
      outerBelt: false,
      stormIncoming: false,
      stormInProgress: false,
      blackout: false,
      inSunlight: true,
      shieldingAmount: 3.308,
      shieldingCapacity: 3.308,
    });
    stream.emit("vessel.flight", {
      altitudeAsl: 100_000,
      altitudeTerrain: 100_000,
    });
  });
}

/** Miss the updates the store expects, which is what makes a reading stale. */
function loseContact(): void {
  act(() => {
    stream.store.setTransportConnected(false);
    stream.store.beginFrame();
  });
}

describe("SpaceWeather when its readings are not current", () => {
  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 149_489,
    });
  });

  it("draws the board while the readings are current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that never draws a board at all.
    const { container } = mount();
    emitSheltered();
    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sheltered");
    expect(visibleText(container)).not.toContain(NOT_CURRENT);
  });

  it("withholds the whole board and says the readings are no longer current", async () => {
    const { container } = mount();
    emitSheltered();
    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );

    loseContact();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    // The reason is announced, not just drawn: the live region the verdict pill
    // used to hold now carries the withholding.
    expect(screen.getByRole("status")).toHaveTextContent(NOT_CURRENT);
  });

  it("withholds the verdict rather than holding the last one", async () => {
    // The failure this widget is most exposed to: "Sheltered" is a green pill
    // about a habitat, and a craft that flew into a belt while the link was down
    // would still be wearing it.
    const { container } = mount();
    emitSheltered();
    await waitFor(() => expect(visibleText(container)).toContain("Sheltered"));

    loseContact();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    expect(visibleText(container)).not.toContain("Sheltered");
    // Nor any of the other verdicts built from the same record.
    expect(visibleText(container)).not.toContain("rad/h");
    expect(visibleText(container)).not.toContain("No storm activity");
    expect(screen.queryByRole("meter", { name: "Shielding" })).toBeNull();
  });

  it("does not accuse the link of dropping before anything has arrived", async () => {
    // A cold start is not a loss of contact. This is the mistake `notCurrent`
    // exists to prevent, and it would fire on every page load.
    const { container } = mount();
    await waitFor(() => expect(visibleText(container)).toContain(AWAITING));
    expect(visibleText(container)).not.toContain(NOT_CURRENT);
  });

  it("distinguishes a link that dropped from a subject with no weather record", async () => {
    // Both hide the board; they send the operator to different places. One is a
    // comms problem, the other is a vessel (or an install) that has no space
    // weather to report.
    const { container } = mount();
    emitSheltered();
    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );

    act(() => {
      stream.emit(TOPIC, null);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain(CONFIRMED_NONE),
    );
    expect(visibleText(container)).not.toContain(NOT_CURRENT);
    expect(visibleText(container)).not.toContain(AWAITING);
  });

  it("withholds the vessel dot, and says so, when only the altitude goes", async () => {
    // The belt diagram survives a missing altitude (the belt bools place the dot
    // when either is set), so the withholding here is one marker rather than the
    // board. It still has to be legible as a withholding.
    const { container } = mount();
    act(() => {
      stream.emit(TOPIC, {
        radiationRadPerSecond: 0.0143 / 3600,
        magnetosphere: true,
        innerBelt: false,
        outerBelt: false,
        stormIncoming: false,
        stormInProgress: false,
        blackout: false,
        inSunlight: true,
        shieldingAmount: 3.308,
        shieldingCapacity: 3.308,
      });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );
    expect(visibleText(container)).toContain("Position unknown");
    const rings = screen.getByRole("img", {
      name: "Radiation belts, vessel position unknown",
    });
    expect(rings.querySelector('circle[r="3"]')).toBeNull();
  });
});
