import {
  clearRegistry,
  DashboardItemContext,
  getComponent,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceWeatherComponent } from "./index";

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
 * It does look different afterwards. Three of the cases below now record the
 * migrated behaviour instead, each keeping the sentence it replaced: the board is
 * withheld when the weather record cannot be judged, and the belt diagram's
 * "you are here" dot is withheld when nothing can place it. The two cases about
 * a FIELD missing from a delivered record still record the old coercions, because
 * a `Reading` says how current the record is and says nothing about which fields
 * the subject filled in.
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

function renderWidget() {
  return render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sw-undef" }}>
        <SpaceWeatherComponent config={{}} id="sw-undef" w={8} h={11} />
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );
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
    clearRegistry();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 149_489,
    });
  });

  afterEach(() => {
    clearRegistry();
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
    const { container } = renderWidget();

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
    const { container } = renderWidget();

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

  it("reports a zero dose rate when the weather record arrives without a radiation field", async () => {
    const { container } = renderWidget();

    act(() => {
      // The topic delivered, the field did not. `magnitudeOr(undefined, 0)`
      // makes this identical to a genuinely quiet vessel.
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

    await waitFor(() => expect(screen.getByText("Sheltered")).toBeTruthy());
    // The dose readout reads a hard zero in the "go" tone, the same as a real
    // 0 rad/h observation would.
    expect(visibleText(container)).toContain("0.000 rad/h");
  });

  it("drives the shielding meter over full when the capacity field is missing", async () => {
    const { container } = renderWidget();

    act(() => {
      // `shieldingAmount` present, `shieldingCapacity` absent, so the capacity
      // falls back to 1 and the ratio is read against a unit that was never
      // measured.
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

    await waitFor(() => expect(visibleText(container)).toContain("3.3 / 1.0"));
    // Clamped at the top of the meter and coloured as fully shielded: an absent
    // capacity reads as the healthiest possible state.
    const meter = screen.getByRole("meter", { name: "Shielding" });
    expect(meter).toHaveAttribute("aria-valuenow", "100");
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
    const { container } = renderWidget();

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
