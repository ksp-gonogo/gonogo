import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";
import { useClearOutcomesOnNewFlight } from "./useClearOutcomesOnNewFlight";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const REFUSAL = "the experiment has already been run";

const INSTRUMENT = {
  partId: "77",
  partName: "Presmat Barometer",
  experimentId: "barometerScan",
  title: "Atmospheric Pressure Scan",
  deployed: false,
  inoperable: false,
  rerunnable: true,
  resettable: false,
  holdsData: false,
};

const flight = (flightId: string) => ({
  flightId,
  vesselId: "vessel-1",
  vesselName: "Probe",
  phase: 5,
});

function railText(): string {
  return document.querySelector("[data-panel-rail-frame]")?.textContent ?? "";
}

describe("Experiments: what a refused command said belongs to its flight", () => {
  it("clears a refusal when a revert starts a new flight, and keeps it while the flight stands", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: 9,
      detail: REFUSAL,
    }));
    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "exp-stale" }}>
          <ExperimentsComponent id="exp-stale" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit("flight.current", flight("flight-1"));
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [INSTRUMENT]);
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Deploy" }),
    );
    await waitFor(() => expect(railText()).toContain(`refused: ${REFUSAL}`));

    act(() => {
      fixture.emit("flight.current", flight("flight-1"));
    });
    expect(railText()).toContain(`refused: ${REFUSAL}`);

    act(() => {
      fixture.emit("flight.current", flight("flight-2"));
    });
    await waitFor(() => expect(railText()).not.toContain(REFUSAL));
    expect(railText()).not.toContain("command failed");
  });
});

describe("useClearOutcomesOnNewFlight", () => {
  const handle = () => ({
    dismiss: vi.fn(),
    refusals: [{ id: "r1" }],
    losses: [{ id: "l1" }],
    founds: [{ id: "f1" }],
    undelivered: [{ id: "u1" }],
    failures: [{ id: "x1" }],
  });

  it("dismisses every outcome of every handle when the flight id changes", () => {
    const a = handle();
    const b = handle();
    const { rerender } = renderHook(
      ({ id }) => useClearOutcomesOnNewFlight(id, [a, b]),
      { initialProps: { id: "flight-1" as string | undefined } },
    );

    rerender({ id: "flight-2" });

    expect(a.dismiss.mock.calls.map(([id]) => id).sort()).toEqual([
      "f1",
      "l1",
      "r1",
      "u1",
      "x1",
    ]);
    expect(b.dismiss).toHaveBeenCalledTimes(5);
  });

  it("clears nothing for the first flight it sees, an unchanged one, or no flight at all", () => {
    const a = handle();
    const { rerender } = renderHook(
      ({ id }) => useClearOutcomesOnNewFlight(id, [a]),
      { initialProps: { id: undefined as string | undefined } },
    );

    rerender({ id: "flight-1" });
    rerender({ id: "flight-1" });
    rerender({ id: undefined });

    expect(a.dismiss).not.toHaveBeenCalled();
  });
});
