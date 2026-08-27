import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import {
  render,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { DescentEnvelopeAeroOverlay } from "./index";

const TOPIC = "aero.state";

/**
 * A stand-in for the host plot's own geometry.
 *
 * Deliberately the real contract rather than a loose bag: the whole point of
 * the slot is that the host hands over its axes and its integrator, so an
 * overlay test that invented its own projection would be testing the invention.
 * The numbers describe a Kerbin entry at 28 km with the plot's terminal-velocity
 * curve anchored at 300 m/s and touching down at 95.
 */
function hostContext(
  overrides: Partial<SlotProps<"landing-status.envelope">> = {},
): SlotProps<"landing-status.envelope"> {
  const size = 160;
  const alt0 = 28_000;
  const vtNow = 300;
  const vtGround = 95;
  const altTop = alt0 * 1.12;
  const maxSpeed = 2200 * 1.12;
  const terminalVelocityAt = (alt: number) =>
    vtGround * (vtNow / vtGround) ** (alt / alt0);
  return {
    size,
    project: (speed, alt) => ({
      x: (speed / maxSpeed) * size,
      y: (1 - alt / altTop) * size,
    }),
    currentSpeed: 2200,
    currentAltitude: alt0,
    terminalVelocityAt,
    relativeDensity: (alt) => {
      const vt = terminalVelocityAt(alt);
      return vt > 0 ? Math.min(1, (vtGround / vt) ** 2) : 0;
    },
    projectDescent: () => ({
      points: [
        { speed: 2200, altitude: alt0 },
        { speed: 320, altitude: 17_000 },
        { speed: 95, altitude: 0 },
      ],
      settleAltitude: 17_000,
      touchdownSpeed: 95,
    }),
    urgencyColor: "var(--color-status-warning-bg)",
    mach: 7.1,
    ...overrides,
  };
}

/** A reading from a lifting entry: high alpha, a wing partly separated. */
function entryReading(overrides: Record<string, unknown> = {}) {
  return {
    angleOfAttack: 40.2,
    sideslip: 0.3,
    stallFraction: 0.18,
    liftToDragRatio: 0.91,
    terminalVelocity: 180,
    ballisticCoefficient: 391,
    aeroModelValid: true,
    ...overrides,
  };
}

function mount(ctx = hostContext()) {
  const fixture = setupStreamFixture({ carriedChannels: [TOPIC] });
  const view = render(
    <fixture.Provider>
      <DescentEnvelopeAeroOverlay {...ctx} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

function paths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("path")).map(
    (p) => p.getAttribute("d") ?? "",
  );
}

function words(container: HTMLElement): string {
  return Array.from(container.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .join(" | ");
}

describe("DescentEnvelope aero overlay", () => {
  it("tilts the vessel wedge by the angle of attack", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, entryReading());

    await waitFor(() => {
      expect(view.container.querySelectorAll("path").length).toBeGreaterThan(0);
    });
    const group = view.container.querySelector("g[transform]");
    // Negated, because the plot's height grows upward while SVG's grows down,
    // so a nose-up alpha has to rotate the other way to read as nose-up.
    expect(group?.getAttribute("transform")).toContain("rotate(-40.2)");
  });

  it("frays the trailing edge in proportion to the stall fraction", async () => {
    const clean = mount();
    clean.fixture.emit(TOPIC, entryReading({ stallFraction: 0 }));
    const torn = mount();
    torn.fixture.emit(TOPIC, entryReading({ stallFraction: 0.45 }));

    await waitFor(() => {
      expect(paths(torn.view.container).length).toBe(2);
    });
    const spread = (container: HTMLElement) => {
      const edge = paths(container)[1];
      const xs = [...edge.matchAll(/-?\d+(?:\.\d+)?(?=\s+-?\d)/g)].map(Number);
      return Math.max(...xs) - Math.min(...xs);
    };
    // At zero stall the trailing edge is a straight line, so its points share
    // one x; as the fraction rises the teeth open up.
    expect(spread(clean.view.container)).toBeCloseTo(0, 5);
    expect(spread(torn.view.container)).toBeGreaterThan(2);
  });

  it("draws an OPEN wedge on a craft with no stall fraction at all", async () => {
    // A rocket has no wing to separate, and that is not a stall reading of
    // nought: the trailing edge simply is not drawn.
    const { fixture, view } = mount();
    fixture.emit(TOPIC, entryReading({ stallFraction: undefined }));

    await waitFor(() => {
      expect(paths(view.container).length).toBeGreaterThan(0);
    });
    expect(paths(view.container)).toHaveLength(1);
  });

  it("says NO AERO DATA rather than drawing marks, with no reading", async () => {
    const { view } = mount();
    await waitFor(() => {
      expect(words(view.container)).toContain("NO AERO DATA");
    });
    expect(paths(view.container)).toHaveLength(0);
  });

  it("ghosts every mark and says MODEL STALE when the model is invalid", async () => {
    const { fixture, view } = mount();
    fixture.emit(TOPIC, entryReading({ aeroModelValid: false }));

    await waitFor(() => {
      expect(words(view.container)).toContain("MODEL STALE");
    });
    const group = view.container.querySelector("g[transform]");
    expect(Number(group?.getAttribute("opacity"))).toBeLessThan(1);
  });

  it("draws its own terminal curve only where it disagrees with the plot's", async () => {
    const agreeing = mount();
    // Scaled from the plot's own curve, so the two land on the same line.
    agreeing.fixture.emit(TOPIC, entryReading({ terminalVelocity: 300 }));
    const disagreeing = mount();
    disagreeing.fixture.emit(TOPIC, entryReading({ terminalVelocity: 180 }));

    await waitFor(() => {
      expect(
        disagreeing.view.container.querySelectorAll("polyline"),
      ).toHaveLength(1);
    });
    expect(agreeing.view.container.querySelectorAll("polyline")).toHaveLength(
      0,
    );
  });

  it("names the ballistic coefficient on its own settle tick", async () => {
    const { fixture, view } = mount(
      hostContext({
        // The plot settles low; the model, with more drag, settles far higher,
        // which is the disagreement worth a second tick.
        projectDescent: (terminalVelocityAt) => ({
          points: [],
          settleAltitude: terminalVelocityAt(0) < 70 ? 2_000 : 20_000,
          touchdownSpeed: 95,
        }),
      }),
    );
    fixture.emit(TOPIC, entryReading());

    await waitFor(() => {
      expect(words(view.container)).toContain("391");
    });
    expect(words(view.container)).toContain("kg/m²");
  });
});
