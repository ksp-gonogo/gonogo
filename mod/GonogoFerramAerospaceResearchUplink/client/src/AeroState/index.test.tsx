import {
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { AeroStateComponent } from "./index";

const TOPIC = "aero.state";

/** A reading in steady flight, with nothing degenerate about it. */
function flying(overrides: Record<string, unknown> = {}) {
  return {
    angleOfAttack: 4.5,
    sideslip: -0.25,
    stallFraction: 0,
    liftCoefficient: 0.42,
    dragCoefficient: 0.09,
    liftToDragRatio: 4.63,
    referenceArea: 18,
    liftForce: 61,
    dragForce: 13.2,
    indicatedAirspeed: 140,
    equivalentAirspeed: 138,
    terminalVelocity: 310,
    ballisticCoefficient: 420,
    specificExcessPower: 22,
    aeroModelValid: true,
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: [TOPIC] });
  const view = render(
    <fixture.Provider>
      <AeroStateComponent id="aero" config={{}} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("AeroState", () => {
  it("shows the attitude to the airflow and what it is costing", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying());

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("4.5");
    });

    const text = visibleText(view.container);
    expect(text).toContain("Angle of attack");
    expect(text).toContain("Lift / drag");
    expect(text).toContain("4.63");
    expect(text).toContain("ATTACHED");
  });

  it("names the stall band as a word, not only as a colour", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying({ stallFraction: 0.7 }));

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("STALLED");
    });
  });

  it("says a partial stall is a partial one", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying({ stallFraction: 0.15 }));

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("PARTIAL STALL");
    });
  });

  /**
   * The reason this widget exists in the shape it does. A launch vehicle has no
   * wing area to be a fraction of, so the mod half publishes no stall fraction,
   * and a widget that substituted zero would tell an ascent it was flying
   * attached wings it does not have.
   */
  it("draws an absent stall fraction as absent rather than as attached", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying({ stallFraction: null }));

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("4.5");
    });

    const text = visibleText(view.container);
    expect(text).not.toContain("ATTACHED");
    expect(text).toContain("NO AERO DATA");
  });

  /**
   * The tick after a separation: every coefficient still describes the previous
   * shape, and the operator has to be told before reading any of them.
   */
  it("flags a stale aerodynamic model", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying({ aeroModelValid: false }));

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("MODEL STALE");
    });
  });

  it("does not flag a current one", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying());

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("ATTACHED");
    });
    expect(visibleText(view.container)).not.toContain("MODEL STALE");
  });

  it("announces the aerodynamic state politely", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying());

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("ATTACHED");
    });
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("has no accessibility violations", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, flying());

    await waitFor(() => {
      expect(visibleText(view.container)).toContain("ATTACHED");
    });
    await expectNoA11yViolations(view.container);
  });
});
