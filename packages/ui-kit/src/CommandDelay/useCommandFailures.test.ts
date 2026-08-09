import { describe, expect, it, vi } from "vitest";
import type { CommandDelayHandle } from "./CommandDelay";
import type { InFlightCommandLike } from "./toInFlightListItems";
import { useCommandFailures } from "./useCommandFailures";

function cmd(
  id: string,
  predictedPhase: InFlightCommandLike["predictedPhase"],
): InFlightCommandLike {
  return {
    id,
    label: `Cmd ${id}`,
    command: "vessel.control.setSasMode",
    reachEtaSeconds: 1,
    replyEtaSeconds: 2,
    predictedPhase,
  };
}

function handle(
  inFlight: InFlightCommandLike[],
  dismiss?: (id: string) => void,
): CommandDelayHandle {
  return {
    id: "h",
    inFlight,
    shape: "discrete",
    effectiveDelaySeconds: 1,
    dismiss,
  };
}

describe("useCommandFailures", () => {
  it("selects only overdue and lost commands as failed", () => {
    const { failed, hasFailure } = useCommandFailures(
      handle([
        cmd("a", "in-transit"),
        cmd("b", "overdue"),
        cmd("c", "lost"),
        cmd("d", "awaiting-reply"),
      ]),
    );
    expect(failed.map((f) => f.id)).toEqual(["b", "c"]);
    expect(hasFailure).toBe(true);
  });

  it("reports no failure when nothing is overdue/lost", () => {
    const { failed, hasFailure } = useCommandFailures(
      handle([cmd("a", "in-transit")]),
    );
    expect(failed).toHaveLength(0);
    expect(hasFailure).toBe(false);
  });

  it("passes the handle's dismiss straight through", () => {
    const dismiss = vi.fn();
    const result = useCommandFailures(handle([cmd("b", "lost")], dismiss));
    result.dismiss("b");
    expect(dismiss).toHaveBeenCalledWith("b");
  });

  it("returns a safe no-op dismiss when the handle carries none", () => {
    const { dismiss } = useCommandFailures(handle([cmd("b", "overdue")]));
    expect(() => dismiss("b")).not.toThrow();
  });
});
