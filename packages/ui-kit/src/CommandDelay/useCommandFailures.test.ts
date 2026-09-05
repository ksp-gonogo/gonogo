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

  it("keeps the failed tint when a loss is promoted to undelivered", () => {
    // The promotion MOVES the entry out of `losses`. A flag that counted only
    // those would go quiet at the moment the news got worse: the command did
    // not merely go unanswered, it never left this machine.
    const promoted: CommandDelayHandle = {
      ...handle([]),
      losses: [],
      undelivered: [{ id: "u0", command: "vessel.control.setSas", label: "" }],
    };
    expect(useCommandFailures(promoted).hasFailure).toBe(true);
    // Still no in-flight ROW: an undelivered dispatch has none, the same way a
    // loss has none.
    expect(useCommandFailures(promoted).failed).toHaveLength(0);
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
