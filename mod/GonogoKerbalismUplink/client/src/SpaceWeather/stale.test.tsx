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
 * The decision: it keeps the board and withholds the VERDICTS on it. A green
 * "Sheltered" pill is a statement about the habitat now, and a craft that has
 * since flown into a belt would keep wearing it for as long as the link stayed
 * down, so the pill, the storm reassurance, the lit belt rings and the "you are
 * here" dot all go. The dose rate, the shielding pair, the stars and the CMEs
 * are measurements and timeline facts, so they stay, dated.
 *
 * This file previously asserted the opposite, that the whole board was
 * withheld. That half is rewritten rather than deleted, and the case that
 * earned it survives intact one test down: the verdict must still not persist.
 *
 * The other assertions that earn this file are the ones about the REASON, since
 * a widget that draws nothing satisfies almost every test ever written about
 * it. Each case below checks which of the reasons it is: dated, confirmed to
 * have no data, or not yet arrived. All three used to render the same fabricated
 * board, and none may render another's wording.
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

  it("holds every measurement on the board and says they are dated", async () => {
    /* REWRITTEN DELIBERATELY. This case used to assert the opposite, that the
       whole board was withheld. That was a ratchet holding an answer the
       operator has since overruled: a widget that collapses to a sentence
       rather than marking the figures it still has is the stale style. The
       verdict half of the old behaviour is still asserted, one case below. */
    const { container } = mount();
    emitSheltered();
    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );

    loseContact();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    // The dose survives, which is the figure an operator on a dropped link most
    // wants: it is the rate their crew is still accumulating.
    expect(visibleText(container)).toContain("0.014 rad/h");
    // So does the shielding meter, both halves off the same held delivery, so
    // the ratio is dated rather than assembled from one known and one unknown.
    expect(screen.queryByRole("meter", { name: "Shielding" })).not.toBeNull();
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
    /* "No storm activity" is the other reassurance on this board, and a dated
       one is worth nothing: `stormState` goes to `unknown` rather than keeping
       a promise nobody can still vouch for. */
    expect(visibleText(container)).not.toContain("No storm activity");
    /* The MEASUREMENTS are deliberately NOT asserted absent here any more. This
       case used to require "rad/h" and the shielding meter to disappear too,
       which is the over-reach the sweep removed: withholding a verdict is not a
       reason to discard the figures it was computed from. */
  });

  it("withholds the verdict even when a held FIGURE would fire an arm on its own", async () => {
    /* THE CASE FOR RENDERING, written at the site because this is the evidence
       for it.

       This file was 7-for-7 green on a build that drew a red "STORM IN PROGRESS"
       badge over a dead link. `statusFor`'s FIRST arm fires on a dose of
       3 rad/h alone, independent of the storm state, so holding the dose kept
       the verdict alive: a board whose belts had gone dark and whose storm state
       had gone unknown still wore the badge. No amount of withholding inside the
       record could reach it, because the arm does not consult the fields that
       were withheld. The badge is gated on the reading itself instead.

       The suite could not have caught it. Every case above emits
       `emitSheltered`, a vessel at 0.014 rad/h, which never reaches that arm, so
       the tests were exercising the "Sheltered" branch and proving it withheld
       correctly while the branch beside it did not. The defect was found by
       opening the picture. That is why a render is required evidence here and
       not a courtesy: a green suite is a statement about the cases someone
       thought to write, and a render is a statement about what is on screen. */
    const { container } = mount();
    act(() => {
      stream.emit(TOPIC, {
        radiationRadPerSecond: 10.38 / 3600,
        magnetosphere: false,
        innerBelt: true,
        outerBelt: false,
        stormIncoming: false,
        stormInProgress: false,
        blackout: false,
        inSunlight: true,
        shieldingAmount: 1.2,
        shieldingCapacity: 3.308,
      });
    });
    await waitFor(() =>
      expect(visibleText(container)).toContain("Storm in progress"),
    );

    loseContact();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    expect(visibleText(container)).not.toContain("Storm in progress");
    // And the figure that would have fired it is still on screen, dated.
    expect(visibleText(container)).toContain("10.38 rad/h");
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
