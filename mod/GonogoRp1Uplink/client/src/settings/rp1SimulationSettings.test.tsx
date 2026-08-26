import { isReadOnlySetting, settingTypeOf } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  RP1_SIMULATION_DELAY_ROW,
  rp1SimulationDelayPolicy,
} from "./rp1SimulationSettings";

/*
 * The one row an operator can change about RP-1's simulations, driven through
 * the real spine rather than a stand-in: the value it shows arrives on
 * `flight.simulation` and the value it writes leaves as a command, and either
 * half being wrong leaves a switch that appears to work and changes nothing.
 *
 * The row is asserted through the same two predicates the renderer asks,
 * `isReadOnlySetting` and `settingTypeOf`, rather than by reading its literals
 * back.
 */

const TOPIC = "flight.simulation";
const COMMAND = "comms.setSimulationDelayPolicy";

/**
 * A mounted provider, because `getActiveTelemetryClient` answers with the most
 * recently MOUNTED one. The empty child is enough: this row's binding reaches
 * the client imperatively, the way a settings row's does.
 */
function mountedFixture() {
  const fixture = setupStreamFixture({ carriedChannels: [TOPIC, COMMAND] });
  render(
    <fixture.Provider>
      <span />
    </fixture.Provider>,
  );
  return fixture;
}

/** Subscribe the way the settings modal does, and hand back the detach. */
function watch(): () => void {
  return rp1SimulationDelayPolicy.subscribe(() => {});
}

afterEach(() => {
  // Module state on a singleton handle: leak a subscription and the next case
  // reads the last one's payload.
  rp1SimulationDelayPolicy.write(false);
});

describe("the RP-1 simulation delay row", () => {
  it("is a writable boolean, because the operator decides this one", () => {
    expect(settingTypeOf(RP1_SIMULATION_DELAY_ROW)).toBe("boolean");
    expect(isReadOnlySetting(RP1_SIMULATION_DELAY_ROW)).toBe(false);
    expect(RP1_SIMULATION_DELAY_ROW.category).toBe("RP-1");
  });

  it("reads off nothing as delay-cut, which is the default the mod ships", () => {
    expect(rp1SimulationDelayPolicy.read()).toBe(false);
  });

  it("shows what the MOD says, not what this console remembers", () => {
    const fixture = mountedFixture();
    const detach = watch();
    try {
      act(() => {
        fixture.emit(TOPIC, {
          simulated: true,
          delayApplied: true,
          delayInSimulation: true,
        });
      });

      expect(rp1SimulationDelayPolicy.read()).toBe(true);
    } finally {
      detach();
    }
  });

  it("sends the change as a command rather than persisting it here", () => {
    const fixture = mountedFixture();
    const detach = watch();
    try {
      act(() => {
        rp1SimulationDelayPolicy.write(true);
      });

      const sent = fixture.transport.sentCommands.filter(
        (c) => c.command === COMMAND,
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].args).toEqual({ applyDuringSimulation: true });
    } finally {
      detach();
    }
  });

  /**
   * The switch has to move on the click. Without the held value it sits at its
   * old position until the next tick carries the mod's answer back, which reads
   * as a control that does not work.
   */
  it("moves immediately, then defers to the mod's own answer", () => {
    const fixture = mountedFixture();
    const detach = watch();
    try {
      act(() => {
        rp1SimulationDelayPolicy.write(true);
      });
      expect(rp1SimulationDelayPolicy.read()).toBe(true);

      act(() => {
        fixture.emit(TOPIC, {
          simulated: true,
          delayApplied: true,
          delayInSimulation: true,
        });
      });
      expect(rp1SimulationDelayPolicy.read()).toBe(true);

      // The mod changed its mind, or somebody else's console did. The wire
      // wins.
      act(() => {
        fixture.emit(TOPIC, {
          simulated: true,
          delayApplied: false,
          delayInSimulation: false,
        });
      });
      expect(rp1SimulationDelayPolicy.read()).toBe(false);
    } finally {
      detach();
    }
  });

  /**
   * Nothing is connected, so nothing can enforce the change either. Showing it
   * as applied would be a switch wired to nothing.
   */
  it("drops the change when no stream is mounted", () => {
    act(() => {
      rp1SimulationDelayPolicy.write(true);
    });

    expect(rp1SimulationDelayPolicy.read()).toBe(false);
  });
});
