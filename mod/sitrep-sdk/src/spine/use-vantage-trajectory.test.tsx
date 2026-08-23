// @vitest-environment jsdom

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, setupStreamFixture } from "../testing";
import {
  refusalFromError,
  useVantageTrajectory,
  VANTAGE_TRAJECTORY_COMMAND,
} from "./use-vantage-trajectory";

function mount() {
  const stream = setupStreamFixture({ carriedChannels: [] });
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
    const request = { topic: "vessel.orbit", toUt: 2000, maxPoints: 128 };

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
