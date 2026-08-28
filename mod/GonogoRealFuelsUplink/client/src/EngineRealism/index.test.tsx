import { getAugmentsForSlot } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerAugment(...).
import { EngineRealismSection } from "./index";

const CARRIED = ["realfuels.engines", "realfuels.boiloff"];

const renderedTrees: Array<() => void> = [];

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  for (const topic of CARRIED) fixture.subscribe(topic);
  return fixture;
}

function renderSection(fixture: ReturnType<typeof newFixture>) {
  const result = render(
    <fixture.Provider>
      <EngineRealismSection />
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/** One engine, with only the fields a case is actually about. */
function engines(
  rows: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    ignitionsLimited: true,
    ullageSimulated: true,
    engines: rows,
    ...extra,
  };
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("registration", () => {
  it("takes the fuel-status sections seat and gates on the RealFuels domain", () => {
    const augment = getAugmentsForSlot("fuel-status.sections").find(
      (a) => a.id === "realfuels-fuel-status-section",
    );
    expect(augment).toBeDefined();
    expect(augment?.requires).toBe("realfuels");
    expect(augment?.owner?.id).toBe("realfuels");
  });
});

describe("EngineRealismSection", () => {
  it("draws nothing at all before RealFuels has reported any engine", () => {
    const fixture = newFixture();
    const { container } = renderSection(fixture);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * A vessel RealFuels has looked at and found no engines on is still nothing to
   * draw. A heading over an empty grid would be a claim, and it is the shape an
   * absent reading gets mistaken for.
   */
  it("draws nothing for a reported but empty engine list", async () => {
    const fixture = newFixture();
    const { container } = renderSection(fixture);
    act(() => {
      fixture.emit("realfuels.engines", engines([]));
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("names the count for a finite budget", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-58",
            ignitionsRemaining: 2,
            ignitionsUnlimited: false,
            groundIgnitionOnly: false,
          },
        ]),
      );
    });
    const row = await screen.findByText("RD-58");
    expect(row.parentElement).toHaveTextContent("2");
    expect(row.parentElement).toHaveTextContent("LEFT");
  });

  /**
   * A count is only readable once the regime around it is known. With the
   * game-wide ignition switch unreadable, the Uplink withholds both derived
   * flags, and drawing "0 LEFT" or "2 LEFT" under an unknown regime is the exact
   * failure the derivation exists to prevent.
   */
  it("dashes a count whose regime the Uplink could not establish", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([{ partName: "RD-58", ignitionsRemaining: 0 }], {
          ignitionsLimited: null,
        }),
      );
    });
    const row = await screen.findByText("RD-58");
    expect(row.parentElement).toHaveTextContent(NULL_DISPLAY);
    expect(screen.queryByText(/LEFT/)).not.toBeInTheDocument();
  });

  it("says UNLIMITED rather than showing the sentinel count", async () => {
    const fixture = newFixture();
    const { container } = renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "AJ10-137",
            ignitionsRemaining: -1,
            ignitionsUnlimited: true,
          },
        ]),
      );
    });
    await screen.findByText("UNLIMITED");
    // No count reaches the operator at all. The raw sentinel rendered as
    // "-1 LEFT" is exactly what the derived flag exists to prevent, and a
    // rendered count is a <Unit>, so its absence is the assertion.
    expect(container.querySelector("[data-unit]")).toBeNull();
  });

  /**
   * The reading a plain count renders as a lie. Zero ignitions is a pad-only
   * restriction, not a spent budget, and the two want opposite decisions.
   */
  it("says GROUND ONLY for a zero budget, never a bare zero", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-107A",
            ignitionsRemaining: 0,
            groundIgnitionOnly: true,
            literalZeroIgnitions: true,
          },
        ]),
      );
    });
    await screen.findByText("GROUND ONLY");
    expect(screen.queryByText(/0 LEFT/)).not.toBeInTheDocument();
  });

  it("dashes an engine whose budget could not be read", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit("realfuels.engines", engines([{ partName: "RD-0110" }]));
    });
    const row = await screen.findByText("RD-0110");
    expect(row.parentElement).toHaveTextContent(NULL_DISPLAY);
  });

  it.each([
    [0.99, "STABLE"],
    [0.82, "RISKY"],
    [0.5, "VERY RISKY"],
    [0.2, "UNSTABLE"],
  ])("bands a stability of %s as %s", async (stability, band) => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-58",
            ignitionsRemaining: 1,
            ullageModelled: true,
            ullageStability: stability,
          },
        ]),
      );
    });
    await screen.findByText(new RegExp(`^${band}$`));
  });

  /**
   * An engine RealFuels does not model ullage for has no settling to report, and
   * saying so is not the same as reporting settled propellant. A band here would
   * look identical to a good reading.
   */
  it("says an unmodelled engine is not subject rather than showing it settled", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "AJ10-137",
            ignitionsUnlimited: true,
            ullageModelled: false,
          },
        ]),
      );
    });
    await screen.findByText("not subject");
  });

  it("says so when the game is not simulating ullage at all", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines(
          [
            {
              partName: "RD-58",
              ignitionsRemaining: 1,
              ullageModelled: true,
              ullageStability: 0.2,
            },
          ],
          { ullageSimulated: false },
        ),
      );
    });
    await screen.findByText("not simulated");
  });

  it("shows the boiloff rate through the canonical Unit renderer", async () => {
    const fixture = newFixture();
    const { container } = renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-58",
            ignitionsRemaining: 2,
            groundIgnitionOnly: false,
          },
        ]),
      );
      fixture.emit("realfuels.boiloff", {
        boiloffRate: 0.31,
        cryogenicTankCount: 2,
      });
    });
    const label = await screen.findByText("Boiloff");
    expect(label.parentElement).toHaveTextContent("2 cryo tanks");
    expect(container.querySelector("[data-unit]")).not.toBeNull();
  });

  /**
   * A vessel with no cryogenic tanks has nothing to lose, which is a different
   * answer from a measurement that failed. Reporting a dash beside "0 cryo
   * tanks" would invite an operator to wonder what went wrong.
   */
  it("omits the boiloff row entirely when no tank can boil off", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([{ partName: "AJ10-137", ignitionsUnlimited: true }]),
      );
      fixture.emit("realfuels.boiloff", {
        boiloffRate: null,
        cryogenicTankCount: 0,
      });
    });
    await screen.findByText("AJ10-137");
    expect(screen.queryByText("Boiloff")).not.toBeInTheDocument();
  });

  it("dashes a boiloff rate that could not be measured with tanks present", async () => {
    const fixture = newFixture();
    renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-58",
            ignitionsRemaining: 2,
            groundIgnitionOnly: false,
          },
        ]),
      );
      fixture.emit("realfuels.boiloff", {
        boiloffRate: null,
        cryogenicTankCount: 3,
      });
    });
    const label = await screen.findByText("Boiloff");
    expect(label.parentElement).toHaveTextContent(NULL_DISPLAY);
    expect(label.parentElement).toHaveTextContent("3 cryo tanks");
  });

  it("has no accessibility violations", async () => {
    const fixture = newFixture();
    const { container } = renderSection(fixture);
    act(() => {
      fixture.emit(
        "realfuels.engines",
        engines([
          {
            partName: "RD-58",
            ignitionsRemaining: 2,
            ullageModelled: true,
            ullageStability: 0.82,
            ignitionProbability: 0.9941,
          },
        ]),
      );
      fixture.emit("realfuels.boiloff", {
        boiloffRate: 0.31,
        cryogenicTankCount: 2,
      });
    });
    await screen.findByText("RD-58");
    await expectNoA11yViolations(container);
  });
});
