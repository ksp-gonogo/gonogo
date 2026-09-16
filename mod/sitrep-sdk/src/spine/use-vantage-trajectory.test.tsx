// @vitest-environment jsdom

import type { ReactNode } from "react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import type { VantagePlanRequest } from "../__generated__/contract";
import { act, render, renderHook, setupStreamFixture } from "../testing";
import { value } from "../unit-system/value";
import {
  refusalFromError,
  useVantageTrajectory,
  VANTAGE_TRAJECTORY_COMMAND,
} from "./use-vantage-trajectory";

function mount(carriedChannels: string[] = []) {
  const stream = setupStreamFixture({ carriedChannels });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <stream.Provider>{children}</stream.Provider>
  );
  const hook = renderHook(() => useVantageTrajectory(), { wrapper });
  return { ...stream, hook };
}

describe("asking where a craft goes from this command centre", () => {
  it("does not solve anything until it is asked to", async () => {
    // A trajectory solve reads an archive and integrates. A hook that ran one
    // every render would do it at animation rate, and nothing at the call site
    // would say so.
    const { hook } = mount();

    expect(hook.result.current.reply).toBeNull();
    expect(hook.result.current.pending).toBe(false);
  });

  it("sends the request under the engine's own command name", () => {
    // The name is the contract. A widget that guessed it would dispatch into
    // nothing and get a silence indistinguishable from a refusal.
    expect(VANTAGE_TRAJECTORY_COMMAND).toBe("vessel.trajectory.forVantage");
  });

  it("carries no vantage in the request type", () => {
    // The property that must not exist. A client able to name its own vantage
    // could name somebody else's and be shown what they can see, which is the
    // whole delay model defeated by a string field.
    const request: VantagePlanRequest = {
      topic: "vessel.orbit",
      toUt: value("ut", 2000),
      maxPoints: value("count", 128),
    };

    expect(Object.keys(request)).not.toContain("vantage");
  });

  it("keeps a message that never left apart from a vantage that cannot see", () => {
    // One is a network fact and the other a mission fact. A widget showing the
    // second for the first would have an operator believe something untrue about
    // their spacecraft. Tested on the mapping directly, because producing a real
    // transport failure here would mean mocking the transport.
    const failed = refusalFromError(new Error("socket closed"));

    expect(failed.solved).toBe(false);
    expect(failed.refusal).toMatch(/did not reach the game/i);
    expect(failed.refusal).toMatch(/socket closed/);
  });

  it("says something useful even when the failure is not an Error", () => {
    const failed = refusalFromError("just a string");

    expect(failed.solved).toBe(false);
    expect(failed.refusal).toBeTruthy();
  });
});

describe("solve is safe to call from an effect", () => {
  it("keeps the same identity across a re-render with nothing changed", () => {
    // The identity IS the contract here. `useCommand` returns a fresh handle
    // object every render, so a `useCallback` keyed on the handle is a new
    // function every render, and an effect depending on it re-runs forever.
    const { hook } = mount();
    const first = hook.result.current.solve;

    hook.rerender();

    expect(hook.result.current.solve).toBe(first);
  });

  it("dispatches once from an effect, not once per render", async () => {
    const stream = setupStreamFixture({
      carriedChannels: [VANTAGE_TRAJECTORY_COMMAND],
    });

    // The effect's own tripwire, rather than waiting for the run to hang. The
    // loop this guards against never lets `act` see an empty queue, so the
    // regression's natural failure is a timeout thirty seconds later, and a
    // vitest timeout does not cancel the body it timed out on.
    let runs = 0;
    const ONE_TOO_MANY = 5;

    function AsksOnMount() {
      const { solve, handle } = useVantageTrajectory();
      /*
       * What `usePanelDelay(handle)` does in a widget body, done by hand: that
       * hook lives in ui-kit, which sits above the spine, and `useCommand`
       * throws on a dispatch whose handle never reached the delay rail.
       */
      if (handle._output) handle._output.consumed = true;
      useEffect(() => {
        runs++;
        if (runs > ONE_TOO_MANY) {
          throw new Error(
            `the effect ran ${runs} times from one mount: solve's identity is ` +
              "changing across renders, so an effect depending on it dispatches forever",
          );
        }
        void solve({
          topic: "vessel.orbit",
          toUt: value("ut", 2000),
          maxPoints: value("count", 128),
        });
      }, [solve]);
      return null;
    }

    render(
      <stream.Provider>
        <AsksOnMount />
      </stream.Provider>,
    );
    // The solve's own `setPending` is what drives the next render, so the loop
    // needs a settled microtask to show itself rather than a second mount.
    await act(async () => {});

    expect(runs).toBe(1);
    expect(stream.transport.sentCommands).toHaveLength(1);
    // The typed args, as the mod will actually read them. A `Value` here is a
    // `{magnitude, unit}` bag to `BindCommandArgs`, which refuses it for a
    // `double` and fail-softs the handler, so the command answers null having
    // never run.
    expect(
      JSON.parse(JSON.stringify(stream.transport.sentCommands[0].args)),
    ).toEqual({ topic: "vessel.orbit", toUt: 2000, maxPoints: 128 });
  });
});
