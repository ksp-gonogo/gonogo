import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import rotatingControlFrame from "./__fixtures__/rotating-control-frame.json";
import { CurrentOrbitConfigForm } from "./CurrentOrbitConfigForm";
import type { CurrentOrbitConfig } from "./config";

/**
 * "Follow the in-game view" is offered only when following would read in a
 * different frame from the reference-body pin. A centreless Control Frame is
 * read as the pin, so it earns no second entry with the same behaviour.
 */

const KERBOL_SYSTEM = rotatingControlFrame._stream.emits.find(
  (e) => e.channel === "system.bodies",
)?.value;

function mount(config: CurrentOrbitConfig = {}) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <CurrentOrbitConfigForm config={config} onSave={vi.fn()} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", KERBOL_SYSTEM);
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 3_000_000,
      ecc: 0.1,
      inc: 0,
      argPe: 0,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    });
  });
  return { fixture, view };
}

function frameSelect() {
  return screen.getByRole("combobox", { name: "Read the orbit in" });
}

describe("CurrentOrbitConfigForm", () => {
  it("offers only the reference-body frame on a stock-shaped Control Frame", async () => {
    const { fixture, view } = mount();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Kerbin-Centred Inertial" }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("Follow the in-game view"),
    ).not.toBeInTheDocument();
    expect(frameSelect()).toHaveDisplayValue("Kerbin-Centred Inertial");
    await expectNoA11yViolations(view.container);
  });

  it("does not offer following a rotating pair, which it would read as the same frame", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbin",
        secondaryBody: "Mun",
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Kerbin-Centred Inertial" }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("Follow the in-game view"),
    ).not.toBeInTheDocument();
  });

  it("offers following a centred Control Frame that reads differently, and keeps a pin selected", async () => {
    const { fixture, view } = mount({
      frame: { kind: "body-centred-inertial" },
    });
    act(() => {
      fixture.emit("system.frame", { kind: 2, centreBody: "Kerbin" });
    });

    await waitFor(() =>
      expect(screen.getByText("Follow the in-game view")).toBeTruthy(),
    );
    expect(frameSelect()).toHaveDisplayValue("Kerbin-Centred Inertial");
    await expectNoA11yViolations(view.container);
  });
});
