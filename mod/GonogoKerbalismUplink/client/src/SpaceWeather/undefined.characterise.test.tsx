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
 * What SpaceWeather DOES today when its telemetry reads are `undefined`,
 * recorded before `useTelemetry` becomes a `Reading`.
 *
 * `useSpaceWeather` has no absence gate at all. Every one of its reads is
 * coerced at the point of use:
 *  - `magnitudeOr(t?.radiationRadPerSecond, 0)` and
 *    `magnitudeOr(flight?.altitudeAsl, 0)`: absent becomes ZERO
 *  - `t?.innerBelt ?? false`, `outerBelt`, `magnetosphere`, `blackout`: absent
 *    becomes FALSE
 *  - `magnitudeOr(t?.shieldingCapacity, 1)`: absent becomes ONE
 *  - `t?.stormInProgress ? ... : t?.stormIncoming ? ... : "none"`: absent falls
 *    through to "no storm"
 *
 * So the widget renders a full, confident board from nothing at all, and every
 * assertion here records a fabricated number rather than a placeholder. There is
 * no `undefined`-shaped branch anywhere in the file for the migration to
 * preserve, which is exactly the risk: nothing will look different afterwards
 * either.
 *
 * It does look different afterwards. Three of the cases below record the
 * migrated behaviour instead, each keeping the sentence it replaced: the board is
 * withheld when the weather record cannot be judged, and the belt diagram's
 * "you are here" dot is withheld when nothing can place it.
 *
 * The cases about a FIELD missing from a delivered record went the same way
 * later, and separately: a `Reading` says how current the record is and says
 * nothing about which fields the subject filled in, so per-field absence needed
 * its own pass. The dose rate, the shielding pair and the storm flags now say so
 * rather than reading as a clean, quiet, fully-shielded craft. Two things had to
 * move together for that, which is why it took a second pass: the mod fed those
 * fields a substituted zero, so the honest half could never fire, and Ship
 * Systems' RadiationSection and the kit's `Meter` were both already written for
 * an absence that could not arrive.
 */

/**
 * Read off the widget's own registration rather than repeated here. The test then
 * cannot subscribe to a topic the widget has stopped reading, and this file does
 * not have to name a domain topic that belongs to an Uplink (`uplink-boundary`).
 */
const SW = getComponent("space-weather");
if (!SW) throw new Error("space-weather is not registered");
const TOPIC = SW.channels?.[0];
if (!TOPIC) throw new Error("space-weather declares no primary channel");
const CARRIED = [...(SW.channels ?? []), ...(SW.optionalChannels ?? [])];

let stream: ReturnType<typeof setupStreamFixture>;

function mount() {
  return renderWidget("space-weather", {
    instanceId: "sw-undef",
    w: 8,
    h: 11,
    wrapper: stream.Provider,
  });
}

/** The "you are here" dot: r=3, the only circle in the rings SVG at that radius. */
function vesselDotCx(container: HTMLElement): string | null {
  const rings = container.querySelector(
    'svg[aria-label="Radiation belt position"]',
  );
  const dot = rings?.querySelector('circle[r="3"]');
  return dot?.getAttribute("cx") ?? null;
}

describe("SpaceWeather: what undefined means today", () => {
  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 149_489,
    });
  });

  /**
   * Recorded prior behaviour: "renders a complete, confident board when nothing
   * has arrived at all".
   *
   * The board was assembled entirely from coercions: a 0.000 rad/h dose, an
   * "Unshielded" verdict, a positive "No storm activity", a 0.0 / 1.0 shielding
   * ratio against a capacity nobody had measured, and the vessel dot on the
   * body's surface. Every one of those is a judgement, so none of them survives a
   * record that has never arrived.
   */
  it("says it is awaiting space weather before anything has arrived", () => {
    const { container } = mount();

    expect(visibleText(container)).toContain("Awaiting space weather");

    // None of the fabricated board: no dose, no verdict, no storm claim, no
    // shielding ratio, no environment tags.
    expect(visibleText(container)).not.toContain("rad/h");
    expect(screen.queryByText("habitat dose rate")).toBeNull();
    expect(screen.queryByText("Unshielded")).toBeNull();
    expect(screen.queryByText("No storm activity")).toBeNull();
    expect(screen.queryByRole("meter", { name: "Shielding" })).toBeNull();
    expect(screen.queryByText("Magnetosphere")).toBeNull();
    expect(screen.queryByText("Inner belt")).toBeNull();
    expect(screen.queryByText("Outer belt")).toBeNull();
    expect(screen.queryByText("Comms blackout")).toBeNull();
    expect(vesselDotCx(container)).toBeNull();

    // The wait is still announced, in the live region the verdict badge used to
    // occupy: withheld, and audibly so.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Awaiting space weather",
    );
  });

  /**
   * Recorded prior behaviour: "keeps drawing the vessel on the surface when the
   * flight record has no altitude".
   *
   * The dot sat at cx=62 (the body's own radius), so a vessel whose altitude was
   * unknown was drawn as landed, on the same diagram whose lit rings were live.
   * The dot is a positional claim, so it is withheld and the diagram says so.
   */
  it("withholds the vessel dot when the flight record has no altitude", async () => {
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
      // Partial payload: the flight record exists, `altitudeAsl` within it does
      // not, and neither belt bool can place the craft instead.
      stream.emit("vessel.flight", { altitudeTerrain: 100_000 });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );
    expect(vesselDotCx(container)).toBeNull();
    // Named on screen, so a missing dot cannot read as a diagram that failed to
    // draw one.
    expect(visibleText(container)).toContain("Position unknown");
    expect(
      screen.getByRole("img", {
        name: "Radiation belts, vessel position unknown",
      }),
    ).toBeInTheDocument();
    // The rest of the board is live and stays live: only the dot depended on the
    // altitude.
    expect(screen.getByRole("status")).toHaveTextContent("Sheltered");
  });

  /**
   * Recorded prior behaviour: "reports a zero dose rate when the weather record
   * arrives without a radiation field".
   *
   * `magnitudeOr(t.radiationRadPerSecond, 0)` made a record with no dose in it
   * identical on screen to a genuinely quiet vessel: "0.000 rad/h" in the go
   * tone, under a live caption reading "habitat dose rate", with a "Sheltered"
   * badge over it. Ship Systems' own RadiationSection had already refused to do
   * that with the same field; this widget was the one still coercing, and the
   * mod fed it a fabricated zero so the honest half could never fire.
   */
  it("withholds the dose readout when the weather record arrives without a radiation field", async () => {
    const { container } = mount();

    act(() => {
      // The topic delivered, the field did not.
      stream.emit(TOPIC, {
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

    // A clause only `statusFor` produces, so this cannot pass on some other
    // component's wording for the same absence.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Storm watch unread",
      ),
    );
    // No dose number anywhere: the readout is the only "rad/h" on the board.
    expect(visibleText(container)).not.toContain("rad/h");
    expect(visibleText(container)).not.toContain("0.000");
    // The rest of the board is live and stays live: only the dose depended on
    // the field.
    expect(visibleText(container)).toContain("habitat dose rate");
    // ...including the flux trace, whose amplitude IS the dose rate.
    expect(visibleText(container)).toContain("Flux needs a dose rate");
  });

  /**
   * Recorded prior behaviour: "drives the shielding meter over full when the
   * capacity field is missing".
   *
   * `magnitudeOr(t.shieldingCapacity, 1)` read the amount against a unit nobody
   * measured, so 3.308 units of shielding clamped the bar at 100% and coloured
   * it as the healthiest possible state. The kit's `Meter` has taken
   * `value: null` and drawn absence for it all along, and its doc comment gives
   * this exact reason; nothing could reach it while the field arrived filled.
   */
  it("withholds the shielding meter when the capacity field is missing", async () => {
    const { container } = mount();

    act(() => {
      // `shieldingAmount` present, `shieldingCapacity` absent.
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
      });
    });

    // Wait for the BOARD first. Asserting the meter is gone straight after the
    // emit would pass on the absence board that precedes it, which has no meter
    // because it has nothing at all.
    await waitFor(() =>
      expect(visibleText(container)).toContain("0.014 rad/h"),
    );
    // `role="meter"` goes with the fraction: a meter asserts an
    // `aria-valuenow`, and there is none to assert. The Shielding meter is this
    // widget's only one, so nothing else can satisfy this.
    expect(screen.queryByRole("meter", { name: "Shielding" })).toBeNull();
    // No ratio built from the one number that did arrive.
    expect(visibleText(container)).not.toContain("3.3 /");
  });

  /**
   * The storm flags are the one bool pair where the coercion reassured: false
   * is what the board says when it is telling an operator no CME is inbound.
   */
  it("does not promise a quiet forecast when the storm flags are missing", async () => {
    const { container } = mount();

    act(() => {
      stream.emit(TOPIC, {
        radiationRadPerSecond: 0.0143 / 3600,
        magnetosphere: true,
        innerBelt: false,
        outerBelt: false,
        blackout: false,
        inSunlight: true,
        shieldingAmount: 3.308,
        shieldingCapacity: 3.308,
      });
    });

    // The timeline's own wording, distinct from the badge's, so neither
    // assertion can be satisfied by the other surface.
    await waitFor(() =>
      expect(visibleText(container)).toContain("Storm state unread"),
    );
    expect(visibleText(container)).not.toContain("No storm activity");
    expect(screen.getByRole("status")).toHaveTextContent("Storm watch unread");
  });

  /**
   * The CME tracker's own version of the same coercion, one level down.
   *
   * `stormState` is 0/1/2 and ZERO IS THE ALL-CLEAR, so every reader here
   * filters state-0 slots out. `magnitudeOf(...) ?? 0` (and the mod-side
   * `Convert.ToInt32(... ?? 0)` feeding it) therefore did not merely mislabel an
   * unread slot, it DELETED it: the card vanished, the star's ring stayed calm,
   * and the board read exactly as it does when Kerbalism has positively said
   * there is no CME on that slot.
   */
  it("draws an unread CME slot rather than filtering it out as no storm", async () => {
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
        stars: [{ star: "Kerbol", inSunlight: true }],
        // The slot was read; its state was not.
        storms: [{ star: "Kerbol", targetKind: "body", targetName: "Kerbin" }],
      });
    });

    await waitFor(() => expect(visibleText(container)).toContain("Unread"));
    expect(visibleText(container)).toContain("CME state unread for Kerbin");
    // Not promoted to a threat either: an unread slot is no evidence of one.
    expect(visibleText(container)).not.toContain("Impacting");
    expect(visibleText(container)).not.toContain("Inbound to");
  });

  /**
   * Recorded prior behaviour: "collapses the whole board to its zero state on a
   * confirmed weather tombstone".
   *
   * A tombstone read exactly like a quiet vessel: storm gone, blackout gone, dose
   * 0.000 rad/h, "Unshielded". It now reports the absence, in wording distinct
   * from the never-arrived case above, because "the subject has no space-weather
   * record" and "we are waiting for one" send the operator to different places.
   */
  it("reports a confirmed weather tombstone as no data, not as a quiet vessel", async () => {
    const { container } = mount();

    act(() => {
      stream.emit(TOPIC, {
        radiationRadPerSecond: 5 / 3600,
        magnetosphere: false,
        innerBelt: false,
        outerBelt: false,
        stormIncoming: false,
        stormInProgress: true,
        blackout: true,
        inSunlight: true,
        shieldingAmount: 0.8,
        shieldingCapacity: 3.308,
      });
    });
    await waitFor(() => expect(visibleText(container)).toContain("5.00 rad/h"));
    expect(screen.getByText("Comms blackout")).toBeInTheDocument();

    act(() => {
      // A whole-topic tombstone: the subject says there is no space-weather
      // record, which the reading reports as `absent`.
      stream.emit(TOPIC, null);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain(
        "No space-weather data reported",
      ),
    );
    // The absence wording is its own, not the cold-start one.
    expect(visibleText(container)).not.toContain("Awaiting space weather");
    // And no residue of the storm board it replaced.
    expect(visibleText(container)).not.toContain("rad/h");
    expect(screen.queryByText("Comms blackout")).toBeNull();
    expect(screen.queryByText("No storm activity")).toBeNull();
    expect(screen.queryByText("Unshielded")).toBeNull();
  });
});
