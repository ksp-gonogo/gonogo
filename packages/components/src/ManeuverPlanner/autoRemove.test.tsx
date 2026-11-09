import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@ksp-gonogo/test-utils";
import { Button } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { COMPLETED_HOLD_MS } from "./BurnCompletionTracker";
import { type BurnContext, orbitShape } from "./burnFlown";
import { useNodeCommands } from "./useNodeCommands";

const BEFORE = orbitShape(700_000, 0.01, 0);
const AFTER = orbitShape(900_000, 0.2, 0);

const NODE: ParsedManeuverNode = {
  id: "n1",
  UT: 1000,
  deltaV: [0, 0, 30],
  frame: null,
  deltaVMagnitude: 30,
  ignitionUt: 990,
  cutoffUt: 1010,
  orbitPatches: [{ sma: AFTER.sma, ecc: AFTER.ecc, inc: AFTER.inc }] as never,
};

const ctx = (over: Partial<BurnContext>): BurnContext => ({
  nowUt: 500,
  current: BEFORE,
  thrust: { thrusting: false, lastThrustEndUt: null },
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a flown burn's node under signal delay", () => {
  it("is removed once even when the operator deleted it during the hold", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fixture = setupStreamFixture({
      delaySeconds: 240,
      suspendFrames: true,
    });
    const nodes = [NODE];
    const view = renderHook(
      ({ c }: { c: BurnContext }) => useNodeCommands(nodes, null, c),
      { wrapper: fixture.Provider, initialProps: { c: ctx({}) } },
    );
    act(() => {
      view.rerender({
        c: ctx({
          nowUt: 995,
          thrust: { thrusting: true, lastThrustEndUt: null },
        }),
      });
    });
    act(() => {
      view.rerender({
        c: ctx({
          nowUt: 1012,
          current: AFTER,
          thrust: { thrusting: false, lastThrustEndUt: 1009 },
        }),
      });
    });
    expect(view.result.current.completedNodes.size).toBe(1);

    const remove = view.result.current.removeCommand("n1");
    render(
      <fixture.Provider>
        <Button command={remove} aria-label="Delete node">
          x
        </Button>
      </fixture.Provider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(COMPLETED_HOLD_MS + 1);
    });

    const removes = fixture.transport.sentCommands.filter(
      (c) => c.command === "vessel.maneuver.remove",
    );
    expect(removes).toHaveLength(1);
  });
});
